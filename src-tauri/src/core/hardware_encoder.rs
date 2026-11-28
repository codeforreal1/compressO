//! Encoding videos on the graphics card (Settings -> Output -> Use hardware acceleration): faster,
//! with slightly larger files. Only H.264 & HEVC; other codecs (VP9, AV1), GIFs, audio & lossless
//! compression stay on the CPU.
//!
//! Which encoders work is found by encoding a single frame with each (the GPU, its driver & the
//! ffmpeg build all have to support it), once per run of the app. If an encode on the graphics card
//! fails anyway, the video is compressed on the CPU instead (see `FFMPEG::compress_video`).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::OnceCell;
use tokio::task::JoinSet;

/// Whether to use the graphics card, as set in the settings (off by default)
static IS_ENABLED: AtomicBool = AtomicBool::new(false);

/// The encoders that work on this computer, found once (see `available_encoders`)
static AVAILABLE_ENCODERS: OnceCell<Vec<HardwareEncoder>> = OnceCell::const_new();

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Codec {
    H264,
    Hevc,
}

/// The graphics card's encoding API, each with its own quality options (each platform uses some)
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Api {
    /// macOS (Apple Silicon & Intel Macs)
    VideoToolbox,
    /// NVIDIA
    Nvenc,
    /// Intel Quick Sync Video
    Qsv,
    /// AMD
    Amf,
}

#[derive(Clone, Debug)]
pub struct HardwareEncoder {
    /// The ffmpeg encoder, e.g. `h264_videotoolbox`
    pub name: &'static str,
    pub codec: Codec,
    pub api: Api,
}

const fn encoder(name: &'static str, codec: Codec, api: Api) -> HardwareEncoder {
    HardwareEncoder { name, codec, api }
}

/// The encoders to try on this platform, the preferred first (a dedicated NVIDIA card over Intel's
/// integrated graphics, which is usually also present)
fn candidates() -> Vec<HardwareEncoder> {
    #[cfg(target_os = "macos")]
    {
        vec![
            encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox),
            encoder("hevc_videotoolbox", Codec::Hevc, Api::VideoToolbox),
        ]
    }
    #[cfg(windows)]
    {
        vec![
            encoder("h264_nvenc", Codec::H264, Api::Nvenc),
            encoder("hevc_nvenc", Codec::Hevc, Api::Nvenc),
            encoder("h264_amf", Codec::H264, Api::Amf),
            encoder("hevc_amf", Codec::Hevc, Api::Amf),
            encoder("h264_qsv", Codec::H264, Api::Qsv),
            encoder("hevc_qsv", Codec::Hevc, Api::Qsv),
        ]
    }
    #[cfg(target_os = "linux")]
    {
        vec![
            encoder("h264_nvenc", Codec::H264, Api::Nvenc),
            encoder("hevc_nvenc", Codec::Hevc, Api::Nvenc),
            encoder("h264_qsv", Codec::H264, Api::Qsv),
            encoder("hevc_qsv", Codec::Hevc, Api::Qsv),
        ]
    }
}

pub fn set_enabled(enabled: bool) {
    IS_ENABLED.store(enabled, Ordering::SeqCst);
}

pub fn is_enabled() -> bool {
    IS_ENABLED.load(Ordering::SeqCst)
}

const CACHE_FILE_NAME: &str = "hardware-encoders-cache.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncoderCache {
    cache_key: String,
    encoders: Vec<String>,
}

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(CACHE_FILE_NAME))
}

fn current_cache_key(app: &AppHandle, candidate_list: &[HardwareEncoder]) -> String {
    let ffmpeg_stamp = super::tool_bundle::command(app, "ffmpeg")
        .ok()
        .and_then(|cmd| std::fs::metadata(cmd.get_program()).ok())
        .map(|meta| {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|dur| dur.as_secs())
                .unwrap_or(0);
            format!("{}:{}", meta.len(), modified)
        })
        .unwrap_or_else(|| "unknown".to_string());
    let candidate_names: Vec<&str> = candidate_list.iter().map(|c| c.name).collect();
    format!(
        "v1:{}:{}:{}:{}",
        app.package_info().version,
        std::env::consts::OS,
        ffmpeg_stamp,
        candidate_names.join(",")
    )
}

fn read_cached_encoders(
    app: &AppHandle,
    cache_key: &str,
    candidate_list: &[HardwareEncoder],
) -> Option<Vec<HardwareEncoder>> {
    let path = cache_path(app)?;
    let text = std::fs::read_to_string(path).ok()?;
    let cached: EncoderCache = serde_json::from_str(&text).ok()?;
    if cached.cache_key != cache_key {
        return None;
    }
    let available = candidate_list
        .iter()
        .filter(|candidate| cached.encoders.iter().any(|name| name == candidate.name))
        .cloned()
        .collect();
    Some(available)
}

fn write_cached_encoders(app: &AppHandle, cache_key: &str, available: &[HardwareEncoder]) {
    let Some(path) = cache_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = EncoderCache {
        cache_key: cache_key.to_string(),
        encoders: available.iter().map(|e| e.name.to_string()).collect(),
    };
    if let Ok(text) = serde_json::to_string(&payload) {
        let _ = std::fs::write(path, text);
    }
}

/// Probes all platform encoder candidates concurrently and preserves priority order.
async fn probe_candidates_parallel(
    app: &AppHandle,
    candidate_list: Vec<HardwareEncoder>,
) -> Vec<HardwareEncoder> {
    let mut set = JoinSet::new();
    for (index, candidate) in candidate_list.iter().cloned().enumerate() {
        let app = app.clone();
        set.spawn(async move { (index, works(&app, &candidate).await) });
    }
    let mut ok_flags = vec![false; candidate_list.len()];
    while let Some(joined) = set.join_next().await {
        if let Ok((index, supported)) = joined {
            if index < ok_flags.len() {
                ok_flags[index] = supported;
            }
        }
    }
    candidate_list
        .into_iter()
        .zip(ok_flags)
        .filter_map(|(candidate, ok)| ok.then_some(candidate))
        .collect()
}

/// The encoders that work on this computer. Read from the disk cache when valid, otherwise probed
/// in parallel on first use (call at startup so the first compression does not wait).
pub async fn available_encoders(app: &AppHandle) -> &'static [HardwareEncoder] {
    AVAILABLE_ENCODERS
        .get_or_init(|| async {
            let candidate_list = candidates();
            let cache_key = current_cache_key(app, &candidate_list);
            if let Some(cached) = read_cached_encoders(app, &cache_key, &candidate_list) {
                log::info!(
                    "[hardware encoder] cached: {:?}",
                    cached.iter().map(|e| e.name).collect::<Vec<_>>()
                );
                return cached;
            }
            let available = probe_candidates_parallel(app, candidate_list).await;
            write_cached_encoders(app, &cache_key, &available);
            log::info!(
                "[hardware encoder] available: {:?}",
                available.iter().map(|e| e.name).collect::<Vec<_>>()
            );
            available
        })
        .await
}

/// Whether an encoder can encode a single frame here
async fn works(app: &AppHandle, candidate: &HardwareEncoder) -> bool {
    let Ok(mut command) = super::tool_bundle::command(app, "ffmpeg").map(tokio::process::Command::from) else {
        return false;
    };
    let pixel_format = if candidate.api == Api::Qsv { "nv12" } else { "yuv420p" };
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=black:size=320x240:rate=30",
            "-frames:v",
            "1",
            "-pix_fmt",
            pixel_format,
            "-c:v",
            candidate.name,
            "-f",
            "null",
            "-",
        ])
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// The hardware encoder for a CPU codec (e.g. `libx264`, or a source's `h264`), if the graphics
/// card is used & one works here. `enabled` overrides the setting for one compression (e.g. from
/// the command line).
pub async fn encoder_for(
    app: &AppHandle,
    codec: &str,
    enabled: Option<bool>,
) -> Option<HardwareEncoder> {
    if !enabled.unwrap_or_else(is_enabled) {
        return None;
    }
    let codec = if codec.contains("264") {
        Codec::H264
    } else if codec.contains("265") || codec.contains("hevc") {
        Codec::Hevc
    } else {
        return None;
    };
    available_encoders(app)
        .await
        .iter()
        .find(|encoder| encoder.codec == codec)
        .cloned()
}

/// The arguments of a CPU encode (`libx264`/`libx265` with `-crf`), changed to encode on the
/// graphics card: its encoder & its quality options for the same CRF, without x264's `-preset`.
/// The rest is kept (e.g. HEVC's `hvc1` tag for Apple players).
///
/// On macOS (VideoToolbox), which needs far more bytes than x264 for the same quality (about twice
/// with H.264, see `quality_args`):
/// - by quality (`-crf`), the bitrate is kept under `quality_cap_kbps` (e.g. a part of the
///   source's), so the output does not come out larger than its original
/// - at a bitrate (a target size), HEVC's peaks are kept at the bitrate itself, as it keeps well
///   over an average bitrate otherwise (H.264 keeps to it, & would keep well under it so)
pub fn to_hardware_args(
    cpu_args: &[String],
    encoder: &HardwareEncoder,
    quality_cap_kbps: Option<u32>,
) -> Vec<String> {
    let mut args = Vec::with_capacity(cpu_args.len() + 8);
    let mut has_hwaccel = false;
    let is_videotoolbox = encoder.api == Api::VideoToolbox;
    // The average bitrate of a target size (not `0`, which encodes by quality)
    let target_bitrate = cpu_args
        .windows(2)
        .find(|pair| pair[0] == "-b:v:0" && pair[1] != "0")
        .map(|pair| pair[1].clone());
    let mut index = 0;
    while index < cpu_args.len() {
        let arg = cpu_args[index].as_str();
        let value = cpu_args.get(index + 1).map(String::as_str);
        match (arg, value) {
            // The video is also decoded on the graphics card (e.g. an iPhone's HEVC, which is
            // heavy for the CPU), & its frames are handed to the filters as usual
            ("-i", Some(_)) if encoder.api == Api::VideoToolbox && !has_hwaccel => {
                args.extend(["-hwaccel".to_string(), "videotoolbox".to_string()]);
                has_hwaccel = true;
                args.push(arg.to_string());
                index += 1;
            }
            ("-c:v:0", Some(_)) => {
                args.extend(["-c:v:0".to_string(), encoder.name.to_string()]);
                index += 2;
            }
            // x264's speed preset
            ("-preset", Some(_)) => index += 2,
            // The CPU encoder's thread limit does not apply to the graphics card
            ("-threads", Some(_)) => index += 2,
            ("-crf", Some(crf)) => {
                let crf = crf.parse::<f32>().unwrap_or(28.0);
                args.extend(quality_args(encoder, crf));
                if let Some(cap) = quality_cap_kbps.filter(|_| is_videotoolbox) {
                    args.extend([
                        "-maxrate:v:0".to_string(),
                        format!("{}k", cap),
                        "-bufsize:v:0".to_string(),
                        format!("{}k", cap.saturating_mul(2)),
                    ]);
                }
                index += 2;
            }
            ("-maxrate:v:0", Some(_))
                if is_videotoolbox && encoder.codec == Codec::Hevc && target_bitrate.is_some() =>
            {
                args.extend([
                    "-maxrate:v:0".to_string(),
                    target_bitrate.clone().unwrap_or_default(),
                ]);
                index += 2;
            }
            // 10-bit (HDR) frames are P010 on graphics cards; on macOS, HEVC is then Main 10
            ("-pix_fmt:v:0", Some("yuv420p10le")) => {
                args.extend(["-pix_fmt:v:0".to_string(), "p010le".to_string()]);
                if encoder.api == Api::VideoToolbox && encoder.codec == Codec::Hevc {
                    args.extend(["-profile:v:0".to_string(), "main10".to_string()]);
                }
                index += 2;
            }
            // Intel's encoder takes NV12 frames
            ("-pix_fmt:v:0", Some(_)) if encoder.api == Api::Qsv => {
                args.extend(["-pix_fmt:v:0".to_string(), "nv12".to_string()]);
                index += 2;
            }
            _ => {
                args.push(arg.to_string());
                index += 1;
            }
        }
    }
    args
}

/// Options giving about the quality & size of a CPU encode at a CRF (24 to 36 in the app)
fn quality_args(encoder: &HardwareEncoder, crf: f32) -> Vec<String> {
    let crf_value = crf.round() as u32;
    let args: Vec<String> = match encoder.api {
        // A quality of 1 to 100 (higher is better), each CRF step about 1.75. Measured against
        // x264 at CRF 28: HEVC matches its quality at about 57 (about 1.2 times its size), while
        // H.264 needs about twice its size to match it, so it is set to about x264's size instead
        // (45, a little lower quality)
        Api::VideoToolbox => {
            let base = if encoder.codec == Codec::Hevc { 57.0 } else { 45.0 };
            let quality = (base - (crf - 28.0) * 1.75).round().clamp(1.0, 100.0) as u32;
            vec!["-q:v:0".into(), quality.to_string()]
        }
        // Constant quality, on a scale like CRF
        Api::Nvenc => vec![
            "-preset:v:0".into(),
            "p5".into(),
            "-tune:v:0".into(),
            "hq".into(),
            "-rc:v:0".into(),
            "vbr".into(),
            "-cq:v:0".into(),
            crf_value.to_string(),
        ],
        Api::Qsv => vec![
            "-preset:v:0".into(),
            "slow".into(),
            "-global_quality:v:0".into(),
            crf_value.to_string(),
        ],
        // Constant quantizers, a little higher for the frames predicted from others
        Api::Amf => vec![
            "-quality:v:0".into(),
            "quality".into(),
            "-rc:v:0".into(),
            "cqp".into(),
            "-qp_i:v:0".into(),
            crf_value.to_string(),
            "-qp_p:v:0".into(),
            (crf_value + 2).to_string(),
        ],
    };
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|arg| arg.to_string()).collect()
    }

    const CPU_ARGS: [&str; 14] = [
        "-i", "in.mp4", "-c:v:0", "libx264", "-pix_fmt:v:0", "yuv420p", "-b:v:0", "0", "-preset",
        "slow", "-crf", "28", "-y", "out.mp4",
    ];

    #[test]
    fn videotoolbox_replaces_the_encoder_preset_and_crf() {
        let encoder = encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox);
        assert_eq!(
            to_hardware_args(&args(&CPU_ARGS), &encoder, None),
            args(&[
                "-hwaccel",
                "videotoolbox",
                "-i",
                "in.mp4",
                "-c:v:0",
                "h264_videotoolbox",
                "-pix_fmt:v:0",
                "yuv420p",
                "-b:v:0",
                "0",
                "-q:v:0",
                "45",
                "-y",
                "out.mp4",
            ])
        );
    }

    #[test]
    fn hevc_keeps_its_hvc1_tag() {
        let encoder = encoder("hevc_videotoolbox", Codec::Hevc, Api::VideoToolbox);
        let mut cpu_args = args(&CPU_ARGS);
        cpu_args[3] = "libx265".to_string();
        cpu_args.splice(4..4, args(&["-tag:v:0", "hvc1"]));
        let hardware = to_hardware_args(&cpu_args, &encoder, None);
        assert!(hardware.windows(2).any(|pair| pair == ["-c:v:0", "hevc_videotoolbox"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-tag:v:0", "hvc1"]));
    }

    #[test]
    fn hdr_is_encoded_from_p010_frames() {
        let mut cpu_args = args(&CPU_ARGS);
        cpu_args[3] = "libx265".to_string();
        cpu_args[5] = "yuv420p10le".to_string();
        for encoder in [
            encoder("hevc_videotoolbox", Codec::Hevc, Api::VideoToolbox),
            encoder("hevc_nvenc", Codec::Hevc, Api::Nvenc),
            encoder("hevc_qsv", Codec::Hevc, Api::Qsv),
        ] {
            let hardware = to_hardware_args(&cpu_args, &encoder, None);
            assert!(hardware.windows(2).any(|pair| pair == ["-pix_fmt:v:0", "p010le"]));
            assert_eq!(
                hardware.windows(2).any(|pair| pair == ["-profile:v:0", "main10"]),
                encoder.api == Api::VideoToolbox
            );
        }
    }

    #[test]
    fn videotoolbox_quality_follows_the_crf() {
        let h264 = encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox);
        assert_eq!(quality_args(&h264, 24.0), args(&["-q:v:0", "52"]));
        assert_eq!(quality_args(&h264, 36.0), args(&["-q:v:0", "31"]));
        let hevc = encoder("hevc_videotoolbox", Codec::Hevc, Api::VideoToolbox);
        assert_eq!(quality_args(&hevc, 24.0), args(&["-q:v:0", "64"]));
        assert_eq!(quality_args(&hevc, 36.0), args(&["-q:v:0", "43"]));
    }

    #[test]
    fn videotoolbox_quality_is_kept_under_its_cap() {
        let videotoolbox = encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox);
        let hardware = to_hardware_args(&args(&CPU_ARGS), &videotoolbox, Some(8000));
        assert!(hardware.windows(2).any(|pair| pair == ["-maxrate:v:0", "8000k"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-bufsize:v:0", "16000k"]));
        // Only on macOS, where it was measured
        let nvenc = encoder("h264_nvenc", Codec::H264, Api::Nvenc);
        let hardware = to_hardware_args(&args(&CPU_ARGS), &nvenc, Some(8000));
        assert!(!hardware.iter().any(|arg| arg == "-maxrate:v:0"));
    }

    #[test]
    fn videotoolbox_target_size_peaks_at_its_bitrate() {
        let cpu_args = args(&[
            "-i", "in.mp4", "-c:v:0", "libx265", "-b:v:0", "7000k", "-maxrate:v:0", "10500k",
            "-bufsize:v:0", "14000k", "-y", "out.mp4",
        ]);
        let videotoolbox = encoder("hevc_videotoolbox", Codec::Hevc, Api::VideoToolbox);
        let hardware = to_hardware_args(&cpu_args, &videotoolbox, Some(8000));
        assert!(hardware.windows(2).any(|pair| pair == ["-maxrate:v:0", "7000k"]));
        // Not by quality, so no cap of its own
        assert_eq!(
            hardware.iter().filter(|arg| *arg == "-maxrate:v:0").count(),
            1
        );
        // H.264 keeps to its bitrate, as do other graphics cards
        for other in [
            encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox),
            encoder("hevc_nvenc", Codec::Hevc, Api::Nvenc),
        ] {
            let hardware = to_hardware_args(&cpu_args, &other, None);
            assert!(hardware.windows(2).any(|pair| pair == ["-maxrate:v:0", "10500k"]));
        }
    }

    #[test]
    fn cpu_thread_limit_is_not_passed_to_the_graphics_card() {
        let cpu_args = args(&[
            "-i", "in.mp4", "-c:v:0", "libx264", "-threads", "4", "-y", "out.mp4",
        ]);
        let hardware = to_hardware_args(
            &cpu_args,
            &encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox),
            None,
        );
        assert!(!hardware.iter().any(|arg| arg == "-threads"));
    }

    #[test]
    fn qsv_uses_nv12_and_global_quality() {
        let encoder = encoder("h264_qsv", Codec::H264, Api::Qsv);
        let hardware = to_hardware_args(&args(&CPU_ARGS), &encoder, None);
        assert!(hardware.windows(2).any(|pair| pair == ["-pix_fmt:v:0", "nv12"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-global_quality:v:0", "28"]));
        // x264's `-preset slow` is gone; Intel's own `-preset:v:0` is set instead
        assert!(!hardware.iter().any(|arg| arg == "-crf" || arg == "-preset"));
    }

    #[test]
    fn nvenc_uses_constant_quality() {
        let encoder = encoder("hevc_nvenc", Codec::Hevc, Api::Nvenc);
        let hardware = to_hardware_args(&args(&CPU_ARGS), &encoder, None);
        assert!(hardware.windows(2).any(|pair| pair == ["-c:v:0", "hevc_nvenc"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-cq:v:0", "28"]));
        assert!(!hardware.iter().any(|arg| arg == "-crf" || arg == "-preset"));
    }
}
