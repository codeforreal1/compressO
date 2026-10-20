pub fn build_video_encoding_args(
    codec: &str,
    preset_name: Option<&str>,
    quality: u16,
    container: &str,
) -> Vec<String> {
    let is_gif_target = container == "gif";
    let is_nvenc = !is_gif_target && matches!(codec, "h264_nvenc" | "hevc_nvenc");
    let compression_quality = if preset_name.is_some() && !is_gif_target {
        match quality {
            0..=100 => 36 - (12 * quality) / 100,
            _ => 28,
        }
    } else {
        18
    }
    .to_string();

    let mut args = Vec::new();

    if is_nvenc {
        let preset = if preset_name == Some("thunderbolt") {
            "p1"
        } else {
            "p5"
        };
        args.extend_from_slice(&[
            "-pix_fmt:v:0",
            "yuv420p",
            "-b:v:0",
            "0",
            "-preset:v:0",
            preset,
            "-rc:v:0",
            "vbr",
        ]);
        if matches!(container, "mp4" | "mov") {
            args.extend_from_slice(&["-movflags", "+faststart"]);
        }
    } else if is_gif_target {
        args.extend_from_slice(&["-preset", "ultrafast"]);
    } else if let Some(preset) = preset_name {
        if preset != "thunderbolt" {
            args.extend_from_slice(&[
                "-pix_fmt:v:0",
                "yuv420p",
                "-b:v:0",
                "0",
                "-movflags",
                "+faststart",
                "-preset",
                "slow",
            ]);
        }
    }

    args.extend_from_slice(&[
        "-c:v:0",
        codec,
        if is_nvenc { "-cq:v:0" } else { "-crf" },
        compression_quality.as_str(),
    ]);
    args.into_iter().map(String::from).collect()
}

#[cfg(test)]
mod tests {
    use super::build_video_encoding_args;

    fn option<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
        args.windows(2)
            .find(|pair| pair[0] == name)
            .map(|pair| pair[1].as_str())
    }

    #[test]
    fn software_encoding_keeps_existing_presets_and_quality() {
        for codec in ["libx264", "libx265", "libvpx-vp9", "libaom-av1", "mpeg4"] {
            let args = build_video_encoding_args(codec, Some("ironclad"), 50, "mp4");
            assert_eq!(option(&args, "-c:v:0"), Some(codec));
            assert_eq!(option(&args, "-preset"), Some("slow"));
            assert_eq!(option(&args, "-crf"), Some("30"));
            assert_eq!(option(&args, "-cq:v:0"), None);
        }

        let args = build_video_encoding_args("libx264", Some("thunderbolt"), 100, "mp4");
        assert_eq!(option(&args, "-preset"), None);
        assert_eq!(option(&args, "-crf"), Some("24"));

        let args = build_video_encoding_args("libx264", None, 0, "mp4");
        assert_eq!(option(&args, "-preset"), None);
        assert_eq!(option(&args, "-crf"), Some("18"));

        let args = build_video_encoding_args("libx264", Some("ironclad"), 0, "gif");
        assert_eq!(option(&args, "-preset"), Some("ultrafast"));
        assert_eq!(option(&args, "-crf"), Some("18"));
    }

    #[test]
    fn nvenc_uses_stream_scoped_quality_and_speed_options() {
        for codec in ["h264_nvenc", "hevc_nvenc"] {
            for (preset, speed) in [
                (None, "p5"),
                (Some("ironclad"), "p5"),
                (Some("thunderbolt"), "p1"),
            ] {
                let args = build_video_encoding_args(codec, preset, 50, "mp4");
                assert_eq!(option(&args, "-c:v:0"), Some(codec));
                assert_eq!(option(&args, "-preset:v:0"), Some(speed));
                assert_eq!(option(&args, "-rc:v:0"), Some("vbr"));
                assert_eq!(option(&args, "-b:v:0"), Some("0"));
                assert_eq!(option(&args, "-pix_fmt:v:0"), Some("yuv420p"));
                assert_eq!(
                    option(&args, "-cq:v:0"),
                    Some(if preset.is_some() { "30" } else { "18" })
                );
                assert_eq!(option(&args, "-crf"), None);
                assert_eq!(option(&args, "-preset"), None);
            }
        }
    }

    #[test]
    fn higher_quality_lowers_quantization_and_invalid_quality_uses_default() {
        for (quality, expected) in [
            (0, "36"),
            (50, "30"),
            (100, "24"),
            (101, "28"),
            (u16::MAX, "28"),
        ] {
            let args = build_video_encoding_args("h264_nvenc", Some("ironclad"), quality, "mp4");
            assert_eq!(option(&args, "-cq:v:0"), Some(expected));
        }
    }

    #[test]
    fn nvenc_faststart_is_only_used_for_mov_containers() {
        for (container, faststart) in [
            ("mp4", Some("+faststart")),
            ("mov", Some("+faststart")),
            ("mkv", None),
            ("avi", None),
        ] {
            let args = build_video_encoding_args("h264_nvenc", Some("ironclad"), 50, container);
            assert_eq!(option(&args, "-movflags"), faststart);
        }
    }

    #[test]
    #[ignore = "Requires COMPRESSO_TEST_FFMPEG and a compatible NVIDIA GPU"]
    fn nvenc_encodes_video() {
        let ffmpeg = std::env::var_os("COMPRESSO_TEST_FFMPEG")
            .expect("Set COMPRESSO_TEST_FFMPEG to the bundled FFmpeg executable");

        for codec in ["h264_nvenc", "hevc_nvenc"] {
            for preset in [None, Some("ironclad"), Some("thunderbolt")] {
                let output = std::process::Command::new(&ffmpeg)
                    .args([
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        "testsrc2=size=320x180:rate=24",
                    ])
                    .args(build_video_encoding_args(codec, preset, 50, "mkv"))
                    .args(["-frames:v", "4", "-f", "matroska", "pipe:1"])
                    .output()
                    .expect("Failed to run FFmpeg");
                assert!(
                    output.status.success(),
                    "{codec} ({preset:?}): {}",
                    String::from_utf8_lossy(&output.stderr)
                );
                assert!(!output.stdout.is_empty());
            }
        }
    }
}
