//! Encoding videos on the graphics card (Settings -> Output -> Use hardware acceleration): faster,
//! with slightly larger files. Only H.264 & HEVC; other codecs (VP9, AV1), GIFs, audio & lossless
//! compression stay on the CPU.
//!
//! Which encoders work is found by encoding a single frame with each (the GPU, its driver & the
//! ffmpeg build all have to support it), once per run of the app. If an encode on the graphics card
//! fails anyway, the video is compressed on the CPU instead (see `FFMPEG::compress_video`).

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::sync::OnceCell;

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

/// The encoders that work on this computer. Found on first use (call it at startup, so the first
/// compression does not wait), then remembered.
pub async fn available_encoders(app: &AppHandle) -> &'static [HardwareEncoder] {
    AVAILABLE_ENCODERS
        .get_or_init(|| async {
            let mut available = Vec::new();
            for candidate in candidates() {
                if works(app, &candidate).await {
                    available.push(candidate);
                }
            }
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
    let Ok(command) = app.shell().sidecar("compresso_ffmpeg") else {
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
/// card is used & one works here
pub async fn encoder_for(app: &AppHandle, codec: &str) -> Option<HardwareEncoder> {
    if !is_enabled() {
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
pub fn to_hardware_args(cpu_args: &[String], encoder: &HardwareEncoder) -> Vec<String> {
    let mut args = Vec::with_capacity(cpu_args.len() + 8);
    let mut index = 0;
    while index < cpu_args.len() {
        let arg = cpu_args[index].as_str();
        let value = cpu_args.get(index + 1).map(String::as_str);
        match (arg, value) {
            ("-c:v:0", Some(_)) => {
                args.extend(["-c:v:0".to_string(), encoder.name.to_string()]);
                index += 2;
            }
            // x264's speed preset
            ("-preset", Some(_)) => index += 2,
            ("-crf", Some(crf)) => {
                let crf = crf.parse::<f32>().unwrap_or(28.0);
                args.extend(quality_args(encoder, crf));
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
        // A quality of 1 to 100 (higher is better), measured against x264: CRF 28 is about 57, & each
        // CRF step about 1.75
        Api::VideoToolbox => {
            let quality = (57.0 - (crf - 28.0) * 1.75).round().clamp(1.0, 100.0) as u32;
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
            to_hardware_args(&args(&CPU_ARGS), &encoder),
            args(&[
                "-i", "in.mp4", "-c:v:0", "h264_videotoolbox", "-pix_fmt:v:0", "yuv420p", "-b:v:0",
                "0", "-q:v:0", "57", "-y", "out.mp4",
            ])
        );
    }

    #[test]
    fn hevc_keeps_its_hvc1_tag() {
        let encoder = encoder("hevc_videotoolbox", Codec::Hevc, Api::VideoToolbox);
        let mut cpu_args = args(&CPU_ARGS);
        cpu_args[3] = "libx265".to_string();
        cpu_args.splice(4..4, args(&["-tag:v:0", "hvc1"]));
        let hardware = to_hardware_args(&cpu_args, &encoder);
        assert!(hardware.windows(2).any(|pair| pair == ["-c:v:0", "hevc_videotoolbox"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-tag:v:0", "hvc1"]));
    }

    #[test]
    fn videotoolbox_quality_follows_the_crf() {
        let encoder = encoder("h264_videotoolbox", Codec::H264, Api::VideoToolbox);
        assert_eq!(quality_args(&encoder, 24.0), args(&["-q:v:0", "64"]));
        assert_eq!(quality_args(&encoder, 36.0), args(&["-q:v:0", "43"]));
    }

    #[test]
    fn qsv_uses_nv12_and_global_quality() {
        let encoder = encoder("h264_qsv", Codec::H264, Api::Qsv);
        let hardware = to_hardware_args(&args(&CPU_ARGS), &encoder);
        assert!(hardware.windows(2).any(|pair| pair == ["-pix_fmt:v:0", "nv12"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-global_quality:v:0", "28"]));
        // x264's `-preset slow` is gone; Intel's own `-preset:v:0` is set instead
        assert!(!hardware.iter().any(|arg| arg == "-crf" || arg == "-preset"));
    }

    #[test]
    fn nvenc_uses_constant_quality() {
        let encoder = encoder("hevc_nvenc", Codec::Hevc, Api::Nvenc);
        let hardware = to_hardware_args(&args(&CPU_ARGS), &encoder);
        assert!(hardware.windows(2).any(|pair| pair == ["-c:v:0", "hevc_nvenc"]));
        assert!(hardware.windows(2).any(|pair| pair == ["-cq:v:0", "28"]));
        assert!(!hardware.iter().any(|arg| arg == "-crf" || arg == "-preset"));
    }
}
