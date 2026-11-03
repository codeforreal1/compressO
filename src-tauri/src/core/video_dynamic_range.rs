//! HDR in videos (see `docs/video-dynamic-range.md`), with the bundled ffmpeg on every platform:
//! HDR sources stay HDR (10-bit) when the output codec can hold it, or are converted to SDR (tone
//! mapped, not only retagged); SDR sources can be brightened into HDR10 ("HDR Boost").
//!
//! The operation is decided here from the source itself, so every way of compressing (the main
//! window, the menu bar's queue, watched folders, estimates) does the same.

use serde::Serialize;

use super::domain::VideoStream;

use super::image_dynamic_range::{
    DynamicRange, MAX_BOOST_INTENSITY, ImageDynamicRangeConfig as DynamicRangeConfig,
    ImageDynamicRangeMode as DynamicRangeMode,
};

/// The colour of a video stream, as ffprobe gives it (`None` when untagged)
#[derive(Clone, Debug, Default)]
pub struct VideoColor {
    pub pix_fmt: String,
    pub transfer: Option<String>,
    pub primaries: Option<String>,
    pub matrix: Option<String>,
    pub range: Option<String>,
    pub height: u32,
    /// Dolby Vision profile, when the stream has a Dolby Vision configuration
    pub dolby_vision_profile: Option<u32>,
}

impl From<&VideoStream> for VideoColor {
    /// Without its Dolby Vision profile, which `get_video_streams` does not read
    fn from(stream: &VideoStream) -> Self {
        VideoColor {
            pix_fmt: stream.pix_fmt.clone(),
            transfer: stream.color_transfer.clone(),
            primaries: stream.color_primaries.clone(),
            matrix: stream.color_space.clone(),
            range: stream.color_range.clone(),
            height: stream.height,
            dolby_vision_profile: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HdrFormat {
    Hdr10,
    Hlg,
    DolbyVision,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoDynamicRangeInfo {
    pub dynamic_range: DynamicRange,
    pub format: Option<HdrFormat>,
}

/// What is done to a video's dynamic range when it is compressed
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Operation {
    /// Nothing changes (SDR output from an SDR source, or no video is encoded)
    None,
    /// Stays HDR: encoded in 10 bits with its HDR signaling
    Keep,
    /// Tone mapped to SDR (BT.709)
    ToSdr,
    /// Brightened into HDR10 (PQ, BT.2020), by this factor (1 to `MAX_BOOST_INTENSITY`)
    Boost(f32),
}

impl Operation {
    pub fn is_hdr_output(&self) -> bool {
        matches!(self, Operation::Keep | Operation::Boost(_))
    }
}

/// The source's reference white is placed at this many nits (ITU-R BT.2408), for HDR Boost
const REFERENCE_WHITE_NITS: u32 = 203;

/// SDR white is this many nits when tone mapping to SDR
const SDR_WHITE_NITS: u32 = 100;

fn is_tagged(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .filter(|value| !matches!(*value, "" | "unknown" | "unspecified" | "reserved"))
}

/// Whether a pixel format holds more than 8 bits per component (e.g. `yuv420p10le`, `p010le`)
fn is_high_bit_depth(pix_fmt: &str) -> bool {
    let base = pix_fmt.trim_end_matches("le").trim_end_matches("be");
    // Semi-planar, e.g. p010, p216
    if matches!(base.get(..2), Some("p0" | "p2" | "p4")) {
        return true;
    }
    // e.g. yuv420p10, gbrp12, gray10 (not nv12 or rgb24, whose digits are not a bit depth)
    let prefix = base.trim_end_matches(|c: char| c.is_ascii_digit());
    (prefix.ends_with('p') || prefix == "gray")
        && base[prefix.len()..]
            .parse::<u32>()
            .is_ok_and(|bits| (9..=16).contains(&bits))
}

pub fn classify(color: &VideoColor) -> VideoDynamicRangeInfo {
    let transfer = is_tagged(&color.transfer);
    let hdr_transfer = match transfer {
        Some("smpte2084") => Some(HdrFormat::Hdr10),
        Some("arib-std-b67") => Some(HdrFormat::Hlg),
        _ => None,
    };
    let info = |dynamic_range, format| VideoDynamicRangeInfo {
        dynamic_range,
        format,
    };
    if color.dolby_vision_profile.is_some() {
        // A Dolby Vision stream with an HDR10/HLG base (e.g. profile 8 from an iPhone) is that
        // HDR; one without (profile 5) cannot be converted without Dolby Vision processing
        return match hdr_transfer {
            Some(_) if color.dolby_vision_profile != Some(5) => {
                info(DynamicRange::Hdr, Some(HdrFormat::DolbyVision))
            }
            _ => info(DynamicRange::Unknown, Some(HdrFormat::DolbyVision)),
        };
    }
    if let Some(format) = hdr_transfer {
        return info(DynamicRange::Hdr, Some(format));
    }
    match transfer {
        Some(_) => info(DynamicRange::Sdr, None),
        // Untagged 8-bit video is SDR; an untagged 10-bit one could be either
        None if !is_high_bit_depth(&color.pix_fmt) => info(DynamicRange::Sdr, None),
        None => info(DynamicRange::Unknown, None),
    }
}

/// Whether an output codec in a container can hold HDR: HEVC, AV1 & VP9 in containers that
/// carry their colour signaling (not H.264, MPEG-4, GIF or AVI)
pub fn carries_hdr(codec: &str, container: &str) -> bool {
    let codec_supports = ["265", "hevc", "av1", "vp9"]
        .iter()
        .any(|name| codec.contains(name));
    codec_supports && matches!(container, "mp4" | "mov" | "mkv" | "webm" | "ts")
}

/// Whether the source would be HDR in the output when its codec can hold it: an HDR source that is
/// not converted to SDR, or an SDR source brightened (used to pick HEVC instead of H.264)
pub fn wants_hdr_output(info: &VideoDynamicRangeInfo, config: Option<&DynamicRangeConfig>) -> bool {
    let mode = config.map(|config| config.mode).unwrap_or_default();
    match info.dynamic_range {
        DynamicRange::Hdr => mode != DynamicRangeMode::Sdr,
        DynamicRange::Sdr => mode == DynamicRangeMode::Boost,
        DynamicRange::Unknown => false,
    }
}

/// The operation for a source, its settings & its output.
/// - `is_reencoded`: compressed (or converted to a GIF), not kept as close as possible to the
///   source (lossless), where an HDR source is converted to SDR only when asked & SDR is never
///   brightened
pub fn operation(
    info: &VideoDynamicRangeInfo,
    config: Option<&DynamicRangeConfig>,
    carries_hdr: bool,
    is_reencoded: bool,
) -> Operation {
    let mode = config.map(|config| config.mode).unwrap_or_default();
    match info.dynamic_range {
        DynamicRange::Hdr if mode == DynamicRangeMode::Sdr => Operation::ToSdr,
        DynamicRange::Hdr if !carries_hdr && is_reencoded => Operation::ToSdr,
        DynamicRange::Hdr if carries_hdr => Operation::Keep,
        // Brightening changes every pixel, so it is not done when compressing losslessly
        DynamicRange::Sdr if mode == DynamicRangeMode::Boost && carries_hdr && is_reencoded => {
            let intensity = config.map(|config| config.intensity).unwrap_or(2.0);
            Operation::Boost(if intensity.is_finite() {
                intensity.clamp(1.0, MAX_BOOST_INTENSITY)
            } else {
                2.0
            })
        }
        _ => Operation::None,
    }
}

/// The source's colour as `zscale` input options: each is passed explicitly, as zscale cannot
/// convert HLG (or untagged video) from the frames' own tags
fn zscale_input(color: &VideoColor, is_hdr: bool) -> String {
    let transfer = is_tagged(&color.transfer).unwrap_or("bt709");
    let primaries = is_tagged(&color.primaries).unwrap_or(if is_hdr {
        "bt2020"
    } else if color.height >= 720 {
        "bt709"
    } else {
        "smpte170m"
    });
    let matrix = is_tagged(&color.matrix).unwrap_or(if is_hdr {
        "bt2020nc"
    } else if color.height >= 720 {
        "bt709"
    } else {
        "smpte170m"
    });
    let range = match is_tagged(&color.range) {
        Some("pc") => "pc",
        _ => "tv",
    };
    format!("tin={transfer}:pin={primaries}:min={matrix}:rin={range}:p={primaries}:m={matrix}")
}

/// HDR metadata that no longer applies to an SDR picture
const HDR_SIDE_DATA: [&str; 4] = [
    "MASTERING_DISPLAY_METADATA",
    "CONTENT_LIGHT_LEVEL",
    "DOVI_RPU_BUFFER",
    "DOVI_METADATA",
];

/// The filters of an operation (`None` when nothing is converted): to linear light, the change,
/// & to the output's colour
pub fn filter(operation: Operation, color: &VideoColor) -> Option<String> {
    match operation {
        Operation::None | Operation::Keep => None,
        Operation::ToSdr => {
            let remove_side_data = HDR_SIDE_DATA
                .iter()
                .map(|kind| format!("sidedata=mode=delete:type={kind}"))
                .collect::<Vec<_>>()
                .join(",");
            Some(format!(
                "zscale={}:t=linear:npl={SDR_WHITE_NITS},format=gbrpf32le,zscale=p=bt709,\
                 tonemap=tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,\
                 {remove_side_data}",
                zscale_input(color, true)
            ))
        }
        Operation::Boost(intensity) => Some(format!(
            "zscale={}:t=linear:npl={REFERENCE_WHITE_NITS},format=gbrpf32le,\
             exposure=exposure={:.4}:black=0,\
             zscale=p=bt2020:t=smpte2084:m=bt2020nc:r=tv:npl={REFERENCE_WHITE_NITS},\
             format=yuv420p10le",
            zscale_input(color, false),
            intensity.log2()
        )),
    }
}

/// The output's colour signaling (`-color_*` options), for a converted or kept HDR video
pub fn color_args(operation: Operation, color: &VideoColor) -> Vec<String> {
    let (primaries, transfer, matrix) = match operation {
        Operation::None => return Vec::new(),
        Operation::ToSdr => ("bt709", "bt709", "bt709"),
        Operation::Boost(_) => ("bt2020", "smpte2084", "bt2020nc"),
        Operation::Keep => (
            is_tagged(&color.primaries).unwrap_or("bt2020"),
            is_tagged(&color.transfer).unwrap_or("smpte2084"),
            is_tagged(&color.matrix).unwrap_or("bt2020nc"),
        ),
    };
    let mut args = vec![
        "-color_primaries:v:0".to_string(),
        primaries.to_string(),
        "-color_trc:v:0".to_string(),
        transfer.to_string(),
        "-colorspace:v:0".to_string(),
        matrix.to_string(),
    ];
    if operation != Operation::Keep {
        args.extend(["-color_range:v:0".to_string(), "tv".to_string()]);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn color(pix_fmt: &str, transfer: Option<&str>) -> VideoColor {
        VideoColor {
            pix_fmt: pix_fmt.to_string(),
            transfer: transfer.map(str::to_string),
            height: 1080,
            ..Default::default()
        }
    }

    fn config(mode: DynamicRangeMode, intensity: f32) -> DynamicRangeConfig {
        DynamicRangeConfig { mode, intensity }
    }

    #[test]
    fn classifies_sources() {
        let range = |c: &VideoColor| classify(c).dynamic_range;
        assert_eq!(range(&color("yuv420p10le", Some("smpte2084"))), DynamicRange::Hdr);
        assert_eq!(range(&color("yuv420p10le", Some("arib-std-b67"))), DynamicRange::Hdr);
        assert_eq!(range(&color("yuv420p", Some("bt709"))), DynamicRange::Sdr);
        assert_eq!(range(&color("yuv420p10le", Some("bt2020-10"))), DynamicRange::Sdr);
        assert_eq!(range(&color("yuv420p", None)), DynamicRange::Sdr);
        assert_eq!(range(&color("nv12", Some("unknown"))), DynamicRange::Sdr);
        assert_eq!(range(&color("yuv420p10le", None)), DynamicRange::Unknown);
        assert_eq!(range(&color("p010le", None)), DynamicRange::Unknown);

        let mut iphone = color("yuv420p10le", Some("arib-std-b67"));
        iphone.dolby_vision_profile = Some(8);
        assert_eq!(
            classify(&iphone).format,
            Some(HdrFormat::DolbyVision)
        );
        assert_eq!(classify(&iphone).dynamic_range, DynamicRange::Hdr);
        let mut profile_5 = color("yuv420p10le", None);
        profile_5.dolby_vision_profile = Some(5);
        assert_eq!(classify(&profile_5).dynamic_range, DynamicRange::Unknown);
    }

    #[test]
    fn only_hevc_av1_and_vp9_carry_hdr() {
        assert!(carries_hdr("libx265", "mp4"));
        assert!(carries_hdr("hevc", "mov"));
        assert!(carries_hdr("libsvtav1", "mkv"));
        assert!(carries_hdr("libvpx-vp9", "webm"));
        assert!(!carries_hdr("libx264", "mp4"));
        assert!(!carries_hdr("mpeg4", "mkv"));
        assert!(!carries_hdr("libx265", "avi"));
    }

    #[test]
    fn decides_the_operation() {
        let hdr = classify(&color("yuv420p10le", Some("smpte2084")));
        let sdr = classify(&color("yuv420p", Some("bt709")));
        let unknown = classify(&color("yuv420p10le", None));
        let remove = config(DynamicRangeMode::Sdr, 2.0);
        let boost = config(DynamicRangeMode::Boost, 3.0);

        assert_eq!(operation(&hdr, None, true, true), Operation::Keep);
        assert_eq!(operation(&hdr, Some(&remove), true, true), Operation::ToSdr);
        // H.264, GIF...: converted to SDR instead of an 8-bit picture tagged as HDR
        assert_eq!(operation(&hdr, None, false, true), Operation::ToSdr);
        // Lossless keeps the source as it is unless asked
        assert_eq!(operation(&hdr, None, false, false), Operation::None);
        assert_eq!(operation(&sdr, Some(&boost), true, true), Operation::Boost(3.0));
        assert_eq!(operation(&sdr, Some(&boost), false, true), Operation::None);
        assert_eq!(operation(&sdr, Some(&boost), true, false), Operation::None);
        assert_eq!(operation(&sdr, Some(&remove), true, true), Operation::None);
        assert_eq!(operation(&hdr, Some(&boost), true, true), Operation::Keep);
        assert_eq!(operation(&unknown, Some(&boost), true, true), Operation::None);
        assert_eq!(
            operation(&sdr, Some(&config(DynamicRangeMode::Boost, 9.0)), true, true),
            Operation::Boost(8.0)
        );
        assert!(wants_hdr_output(&hdr, None));
        assert!(!wants_hdr_output(&hdr, Some(&remove)));
        assert!(wants_hdr_output(&sdr, Some(&boost)));
    }

    #[test]
    fn filters_pass_the_source_colour_explicitly() {
        let mut hlg = color("yuv420p10le", Some("arib-std-b67"));
        hlg.primaries = Some("bt2020".into());
        let to_sdr = filter(Operation::ToSdr, &hlg).unwrap();
        assert!(to_sdr.starts_with(
            "zscale=tin=arib-std-b67:pin=bt2020:min=bt2020nc:rin=tv:p=bt2020:m=bt2020nc:t=linear"
        ));
        assert!(to_sdr.contains("format=yuv420p,"));
        assert!(to_sdr.contains("type=MASTERING_DISPLAY_METADATA"));

        let mut sd = color("yuv420p", None);
        sd.height = 480;
        let boost = filter(Operation::Boost(2.0), &sd).unwrap();
        assert!(boost.starts_with("zscale=tin=bt709:pin=smpte170m:min=smpte170m"));
        assert!(boost.contains("exposure=exposure=1.0000"));
        assert!(boost.ends_with("format=yuv420p10le"));
        assert_eq!(filter(Operation::Keep, &hlg), None);
    }

    /// The filters with the bundled ffmpeg: synthetic white at the SDR reference level
    #[test]
    fn bundled_ffmpeg_converts_and_keeps_dynamic_range() {
        use std::path::PathBuf;
        use std::process::Command;

        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let tool = |name: &str| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join(format!(
                "compresso_{name}-{}{suffix}",
                env!("COMPRESSO_TARGET")
            ))
        };
        let (ffmpeg, ffprobe) = (tool("ffmpeg"), tool("ffprobe"));
        struct Work(PathBuf);
        impl Drop for Work {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let work = Work(std::env::temp_dir().join(format!(
            "compresso-video-hdr-{}",
            std::process::id()
        )));
        std::fs::create_dir_all(&work.0).unwrap();
        let run = |args: &[&str]| {
            let output = Command::new(&ffmpeg)
                .args(["-v", "error", "-y"])
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            output.stdout
        };
        // White at 203 nits, the reference level, in a transfer
        let source = |transfer: &str| {
            let path = work.0.join(format!("{transfer}.mkv"));
            let filter = format!(
                "format=gbrpf32le,setparams=color_primaries=bt709:color_trc=linear:colorspace=gbr,\
                 zscale=tin=linear:pin=709:t={transfer}:p=2020:m=2020_ncl:r=tv:npl=203,\
                 format=yuv420p10le"
            );
            run(&[
                "-f", "lavfi", "-i", "color=white:s=64x64:d=0.2", "-vf", &filter, "-c:v",
                "libx265", "-x265-params", "log-level=error", "-color_primaries", "bt2020",
                "-color_trc", transfer, "-colorspace", "bt2020nc", path.to_str().unwrap(),
            ]);
            path
        };
        let first_luma = |input: &PathBuf, filter: &str, ten_bit: bool| {
            let pixels = run(&[
                "-i", input.to_str().unwrap(), "-vf", filter, "-frames:v", "1", "-f",
                "rawvideo", "-",
            ]);
            if ten_bit {
                u16::from_le_bytes([pixels[0], pixels[1]]) as i32
            } else {
                pixels[0] as i32
            }
        };
        let probe = |path: &PathBuf| {
            let output = Command::new(&ffprobe)
                .args([
                    "-v", "error", "-select_streams", "v:0", "-show_entries",
                    "stream=pix_fmt,color_transfer,color_primaries:stream_side_data=side_data_type",
                    "-of", "compact", path.to_str().unwrap(),
                ])
                .output()
                .unwrap();
            String::from_utf8_lossy(&output.stdout).to_string()
        };

        for (transfer, format) in [("smpte2084", HdrFormat::Hdr10), ("arib-std-b67", HdrFormat::Hlg)] {
            let input = source(transfer);
            let color = VideoColor {
                pix_fmt: "yuv420p10le".into(),
                transfer: Some(transfer.into()),
                primaries: Some("bt2020".into()),
                matrix: Some("bt2020nc".into()),
                range: Some("tv".into()),
                height: 64,
                dolby_vision_profile: None,
            };
            assert_eq!(classify(&color).format, Some(format));
            // Reference white comes out near SDR white (235), not dim or clipped
            let filter = filter(Operation::ToSdr, &color).unwrap();
            let luma = first_luma(&input, &filter, false);
            assert!((205..=228).contains(&luma), "{transfer} to SDR: {luma}");

            let output = work.0.join(format!("{transfer}-sdr.mp4"));
            let mut args = vec!["-i".to_string(), input.to_str().unwrap().into(), "-vf".into(), filter];
            args.extend(color_args(Operation::ToSdr, &color));
            args.extend(["-c:v".into(), "libx264".into(), output.to_str().unwrap().into()]);
            run(&args.iter().map(String::as_str).collect::<Vec<_>>());
            let probed = probe(&output);
            assert!(probed.contains("pix_fmt=yuv420p|"), "{probed}");
            assert!(probed.contains("color_transfer=bt709"), "{probed}");
            assert!(!probed.contains("Mastering"), "{probed}");

            // Kept: 10 bits & its transfer
            let output = work.0.join(format!("{transfer}-kept.mp4"));
            let mut args = vec!["-i".to_string(), input.to_str().unwrap().into()];
            args.extend(color_args(Operation::Keep, &color));
            args.extend(
                ["-c:v", "libx265", "-x265-params", "log-level=error", "-pix_fmt", "yuv420p10le"]
                    .map(String::from),
            );
            args.push(output.to_str().unwrap().into());
            run(&args.iter().map(String::as_str).collect::<Vec<_>>());
            let probed = probe(&output);
            assert!(probed.contains("pix_fmt=yuv420p10le"), "{probed}");
            assert!(probed.contains(&format!("color_transfer={transfer}")), "{probed}");
        }

        // HDR Boost: SDR white at 203 nits × the intensity, in PQ (10-bit limited range codes)
        let sdr = work.0.join("sdr.mp4");
        run(&[
            "-f", "lavfi", "-i", "color=white:s=64x64:d=0.2", "-c:v", "libx264", "-pix_fmt",
            "yuv420p", sdr.to_str().unwrap(),
        ]);
        let color = VideoColor {
            pix_fmt: "yuv420p".into(),
            height: 64,
            ..Default::default()
        };
        assert_eq!(classify(&color).dynamic_range, DynamicRange::Sdr);
        for (intensity, expected) in [(1.0, 573), (2.0, 637), (4.0, 703), (8.0, 769)] {
            let filter = filter(Operation::Boost(intensity), &color).unwrap();
            let luma = first_luma(&sdr, &filter, true);
            assert!((luma - expected).abs() <= 4, "boost {intensity}: {luma}");
        }
    }
}
