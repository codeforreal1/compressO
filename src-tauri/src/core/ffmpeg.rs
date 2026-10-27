use crate::core::domain::{
    AudioConfig, BatchCompressionResult, BatchVideoCompressionProgress,
    BatchVideoIndividualCompressionResult, CustomEvents, MediaMetadataConfig, MediaTransform,
    MediaTransformCrop, MediaTransformHistory, OutputOption, SubtitleStream, SubtitlesConfig, TargetSize,
    VideoCompressionConfig, VideoCompressionProgress, VideoCompressionResult, VideoThumbnail,
    VideoTrimSegment,
};
use crate::core::ffprobe::FFPROBE;
use crate::core::hardware_encoder;
use crate::core::image::ImageCompressor;
use crate::core::media_process::{CancelCallback, MediaProcessExecutorBuilder};
use crate::sys::fs::{ensure_assets_dir, get_file_metadata};
use crate::utils;
use crate::utils::event::EventListenerGuard;
use nanoid::nanoid;
use regex::Regex;
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use tauri::{AppHandle, Emitter, Listener, Manager};

pub struct FFMPEG {
    app: AppHandle,
    assets_dir: PathBuf,
    owner_window: String,
    /// Only this part of the input is read (its start & length in seconds), see `with_input_range`
    input_range: Option<(f64, f64)>,
}

const EXTENSIONS: [&str; 10] = [
    "mp4", "mov", "webm", "avi", "mkv", "ts", "gif", "m4v", "mts", "m2ts",
];

/// Audio formats a video's audio can be extracted to
const AUDIO_EXTENSIONS: [&str; 6] = ["mp3", "m4a", "wav", "flac", "ogg", "opus"];

/// Audio codec for an audio-only output: the requested one when the format supports it, otherwise
/// the format's usual codec
fn audio_output_codec(extension: &str, requested_codec: Option<&str>) -> String {
    let supported_codecs: &[&str] = match extension {
        "mp3" => &["libmp3lame"],
        "m4a" => &["aac", "alac"],
        "wav" => &["pcm_s16le"],
        "flac" => &["flac"],
        "ogg" => &["libvorbis", "libopus", "flac"],
        "opus" => &["libopus"],
        _ => &[],
    };
    match requested_codec {
        Some(codec) if supported_codecs.contains(&codec) => codec.to_string(),
        _ => supported_codecs.first().copied().unwrap_or("copy").to_string(),
    }
}

/// Container whose capabilities (codecs, subtitles, thumbnails) apply to the extension.
fn output_container(extension: &str) -> &str {
    match extension {
        "m4v" => "mp4",
        "mts" | "m2ts" => "ts",
        _ => extension,
    }
}

/// The encoders of the bundled ffmpeg (`ffmpeg -encoders`), read once
static FFMPEG_ENCODERS: tokio::sync::OnceCell<String> = tokio::sync::OnceCell::const_new();

/// Whether the bundled ffmpeg has an encoder (builds differ, e.g. not all have SVT-AV1)
async fn has_encoder(app: &AppHandle, name: &str) -> bool {
    let encoders = FFMPEG_ENCODERS
        .get_or_init(|| async {
            let Ok(mut command) = super::tool_bundle::command(app, "ffmpeg").map(tokio::process::Command::from) else {
                return String::new();
            };
            command
                .args(["-hide_banner", "-encoders"])
                .output()
                .await
                .map(|output| String::from_utf8_lossy(&output.stdout).to_string())
                .unwrap_or_default()
        })
        .await;
    // Lines like ` V....D libsvtav1            SVT-AV1(...)`
    encoders
        .lines()
        .any(|line| line.split_whitespace().nth(1) == Some(name))
}

impl FFMPEG {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let assets_dir = ensure_assets_dir(app)?;

        Ok(Self {
            app: app.to_owned(),
            assets_dir,
            owner_window: String::from("main"),
            input_range: None,
        })
    }

    /// Window the processes belong to (the main window by default), see `MediaProcessExecutorBuilder`
    pub fn with_owner_window(mut self, label: &str) -> Self {
        self.owner_window = label.to_string();
        self
    }

    /// Compresses only a part of the input (its start & length in seconds), seeking to it instead
    /// of decoding up to it, e.g. for the samples of `estimate_video_size`
    pub fn with_input_range(mut self, range: Option<(f64, f64)>) -> Self {
        self.input_range = range;
        self
    }

    pub fn get_asset_dir(&self) -> String {
        self.assets_dir.display().to_string()
    }

    pub fn get_ffmpeg_command(&self) -> Result<Command, String> {
        super::tool_bundle::command(&self.app, "ffmpeg")
            .map_err(|e| format!("Failed to create ffmpeg command: {}", e))
    }

    /// Compresses a video from a path
    pub async fn compress_video(
        &mut self,
        video_path: &str,
        convert_to_extension: &str,
        preset_name: Option<&str>,
        video_id: &str,
        batch_id: Option<&str>,
        audio_config: &AudioConfig,
        quality: u16,
        dimensions: Option<(f64, f64)>,
        fps: Option<&str>,
        video_codec: Option<&str>,
        transform_history: Option<&MediaTransformHistory>,
        strip_metadata: Option<bool>,
        metadata_config: Option<&MediaMetadataConfig>,
        custom_thumbnail_path: Option<&str>,
        trim_segments: Option<&Vec<VideoTrimSegment>>,
        subtitles_config: Option<&SubtitlesConfig>,
        speed: Option<f32>,
        target_size: Option<&TargetSize>,
    ) -> Result<VideoCompressionResult, String> {
        let is_audio_target = AUDIO_EXTENSIONS.contains(&convert_to_extension);
        let requested_audio_codec = audio_config.audio_codec.as_deref();
        if !EXTENSIONS.contains(&convert_to_extension) && !is_audio_target {
            return Err(String::from("Invalid convert to extension."));
        }
        let container = output_container(convert_to_extension);

        let audio_streams = {
            let mut ffprobe = FFPROBE::new(&self.app)?.with_owner_window(&self.owner_window);
            ffprobe.get_audio_streams(video_path).await?
        };
        let has_audio_stream = !audio_streams.is_empty();

        if is_audio_target && !has_audio_stream {
            return Err(String::from("The video has no audio to extract."));
        }
        // Muted, an audio output (e.g. an audio file at 0%) keeps its audio & silences it: silence of
        // the same length, as there is nothing else to write. Muted videos drop their audio instead.
        let is_silent_audio = is_audio_target && audio_config.volume == 0;
        let keeps_audio = audio_config.volume > 0 || is_silent_audio;

        // Audio formats hold a single audio stream, so only the first selected track is extracted
        let selected_audio_tracks: Option<Vec<usize>> = if is_audio_target {
            Some(vec![audio_config
                .selected_audio_tracks
                .as_ref()
                .and_then(|tracks| tracks.first().copied())
                .unwrap_or(0)])
        } else {
            audio_config.selected_audio_tracks.clone()
        };

        let (existing_subtitle_count, existing_subtitle_streams): (usize, Vec<SubtitleStream>) = {
            if let Some(subs_config) = subtitles_config {
                let preserve = subs_config.preserve_existing_subtitles.unwrap_or(false);
                if preserve {
                    let mut ffprobe = FFPROBE::new(&self.app)?.with_owner_window(&self.owner_window);
                    let streams = ffprobe.get_subtitle_streams(video_path).await?;
                    let count = streams.len();
                    (count, streams)
                } else {
                    (0, Vec::new())
                }
            } else {
                (0, Vec::new())
            }
        };
        let has_existing_subtitles = existing_subtitle_count > 0;

        let batch_id = match batch_id {
            Some(id) => String::from(id),
            None => nanoid!(),
        };

        let is_gif_target = convert_to_extension == "gif";

        let file_name = if is_gif_target {
            format!("{}.mp4", video_id)
        } else {
            format!("{}.{}", video_id, convert_to_extension)
        };

        let output_file: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let input_range_args: Vec<String> = self
            .input_range
            .map(|(start, length)| {
                vec![
                    "-ss".to_string(),
                    format!("{:.3}", start),
                    "-t".to_string(),
                    format!("{:.3}", length),
                ]
            })
            .unwrap_or_default();

        let mut cmd_args: Vec<&str> = Vec::new();

        cmd_args.extend(input_range_args.iter().map(|arg| arg.as_str()));
        cmd_args.push("-i");
        cmd_args.push(video_path);

        // Track input indices for mapping
        let mut input_index: usize = 1; // 0 is video, 1+ are thumbnails/subtitles

        if !is_gif_target && !is_audio_target && container != "webm" && container != "ts" {
            if let Some(thumb_path) = custom_thumbnail_path {
                if thumb_path.len() > 0 {
                    cmd_args.extend_from_slice(&["-i", thumb_path]);
                    input_index += 1;
                }
            }
        }

        let subtitle_input_indices: Vec<(usize, String, Option<String>)> = if !is_gif_target
            && !is_audio_target
        {
            if let Some(subs_config) = subtitles_config {
                if subs_config.should_enable_subtitles.unwrap_or(false) {
                    let mut indices = Vec::new();
                    for sub in &subs_config.subtitles {
                        if let Some(ref sub_path) = sub.subtitle_path {
                            if sub_path.len() > 0 {
                                cmd_args.extend_from_slice(&["-i", sub_path]);
                                let lang = if sub.language == "und" {
                                    String::new()
                                } else {
                                    sub.language.clone()
                                };
                                let title = sub.title.as_ref().map(|t| t.trim().to_string());
                                indices.push((input_index, lang, title));
                                input_index += 1;
                            }
                        }
                    }
                    indices
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };

        let should_strip_metadata = strip_metadata.unwrap_or(false);
        if should_strip_metadata {
            cmd_args.extend_from_slice(&["-map_metadata", "-1"]);
        } else {
            cmd_args.extend_from_slice(&["-map_metadata", "0"]);
        }

        cmd_args.extend_from_slice(&[
            "-hide_banner",
            "-progress",
            "-",
            "-nostats",
            "-loglevel",
            "error",
        ]);

        // The GIF is converted from an intermediate video encoded as fast as possible
        if is_gif_target {
            cmd_args.extend_from_slice(&["-preset", "ultrafast"]);
        }

        let file_metadata = get_file_metadata(video_path).map_err(|err| err.to_string())?;
        let original_extension = &file_metadata.extension;

        // Codec
        let output_codec: String = {
            fn default_codec(convert_to_extension: &str) -> String {
                match convert_to_extension {
                    "webm" => "libvpx-vp9".to_string(),
                    _ => "libx264".to_string(),
                }
            }

            /// Check if a codec is compatible with the target container format
            fn is_codec_compatible(codec: &str, container: &str) -> bool {
                match container {
                    "webm" => {
                        codec.contains("vp8") || codec.contains("vp9") || codec.contains("av1")
                    }
                    "mkv" => true,
                    "ts" => {
                        codec.contains("264") || codec.contains("265") || codec.contains("mpeg2")
                    }
                    _ => codec.contains("264") || codec.contains("265") || codec.contains("av1"),
                }
            }

            if is_gif_target {
                default_codec(container)
            } else if let Some(codec) = video_codec {
                codec.to_string()
            } else {
                if preset_name.is_none() {
                    let source_streams = {
                        let mut ffprobe = FFPROBE::new(&self.app)?.with_owner_window(&self.owner_window);
                        ffprobe.get_video_streams(video_path).await?
                    };

                    match source_streams.first() {
                        Some(stream) => {
                            let source_codec = if stream.codec == "av1" {
                                "libsvtav1".to_string() // libsvtav1 is faster than original av1
                            } else {
                                stream.codec.clone()
                            };
                            if original_extension == convert_to_extension
                                || is_codec_compatible(&source_codec, container)
                            {
                                source_codec
                            } else {
                                default_codec(container)
                            }
                        }
                        None => default_codec(container),
                    }
                } else {
                    default_codec(container)
                }
            }
        };
        // AV1 (chosen, or kept from an AV1 source): SVT-AV1 when this ffmpeg build has it, as it is
        // many times faster than libaom-av1 for a similar quality
        let output_codec = if output_codec.contains("av1") {
            if has_encoder(&self.app, "libsvtav1").await {
                "libsvtav1".to_string()
            } else {
                "libaom-av1".to_string()
            }
        } else {
            output_codec
        };
        if is_audio_target {
            cmd_args.push("-vn");
        } else {
            cmd_args.extend_from_slice(&["-c:v:0", output_codec.as_str()]);

            // AV1 encoders are very slow at their defaults (minutes for seconds of video); these are
            // tens of times faster for about the same size & quality
            match output_codec.as_str() {
                "libsvtav1" => cmd_args.extend_from_slice(&["-preset", "6"]),
                "libaom-av1" => cmd_args.extend_from_slice(&["-cpu-used", "6", "-row-mt", "1"]),
                _ => {}
            }

            // ffmpeg tags HEVC as `hev1`, which macOS (Finder thumbnails, Quick Look, QuickTime)
            // does not play; `hvc1` plays everywhere. Only MP4/MOV (incl. M4V) use the tag.
            let is_hevc = output_codec.contains("265") || output_codec.contains("hevc");
            if is_hevc && matches!(container, "mp4" | "mov") {
                cmd_args.extend_from_slice(&["-tag:v:0", "hvc1"]);
            }
        }

        let audio_codec = audio_output_codec(convert_to_extension, requested_audio_codec);
        let source_audio = selected_audio_tracks
            .as_ref()
            .and_then(|tracks| tracks.first())
            .and_then(|index| audio_streams.get(*index));
        let source_sample_rate = source_audio
            .and_then(|stream| stream.sample_rate.parse::<u32>().ok())
            .unwrap_or(48000);
        let audio_channels = if audio_config
            .audio_channel_config
            .as_ref()
            .and_then(|config| config.channel_layout.as_deref())
            == Some("mono")
        {
            1
        } else {
            source_audio
                .and_then(|stream| stream.channels.parse::<u32>().ok())
                .unwrap_or(2)
                .max(1)
        };
        let (minimum_audio_bitrate, maximum_audio_bitrate) =
            audio_encoder_bitrate_limits(&audio_codec, source_sample_rate, audio_channels);
        let planned_audio_bitrate = target_size
            .filter(|_| is_audio_target)
            .and_then(|target| target.audio_bitrate)
            .map(|bitrate| bitrate.clamp(minimum_audio_bitrate, maximum_audio_bitrate));

        // Audio size targets preserve the selected container.
        if let Some(target) = target_size.filter(|_| is_audio_target) {
            let codec = audio_output_codec(convert_to_extension, requested_audio_codec);
            if matches!(requested_audio_codec, Some(requested) if requested != "-" && requested != codec)
            {
                return Err(
                    "The selected audio codec is incompatible with the output format.".into(),
                );
            }
            if !matches!(
                codec.as_str(),
                "libmp3lame" | "aac" | "libvorbis" | "libopus"
            ) {
                return Err("Target size requires a lossy audio codec; the selected format was not changed.".into());
            }
            if target.size_in_bytes == 0
                || !matches!(target.audio_bitrate, Some(bitrate) if bitrate > 0)
            {
                return Err("Invalid audio target size or bitrate.".into());
            }
        }
        let target_size = target_size.filter(|_| preset_name.is_some() && !is_gif_target);
        // Encoded at its bitrate from the start, unless the quality is tried first (it is encoded at
        // a bitrate only when that came out larger, see `TargetSize::quality_first`)
        let bitrate_target = target_size.filter(|target| !is_audio_target && !target.quality_first);
        let target_bitrate_args: Vec<String> = bitrate_target
            .map(|target| bitrate_args(target.video_bitrate))
            .unwrap_or_default();

        // Compression settings (`preset_name` is unset for lossless): constant quality via CRF (or
        // a bitrate, for a target size), and only the options the encoder & container support
        if preset_name.is_some() && !is_gif_target && !is_audio_target {
            cmd_args.extend_from_slice(&["-pix_fmt:v:0", "yuv420p"]);
            if bitrate_target.is_some() {
                cmd_args.extend(target_bitrate_args.iter().map(|arg| arg.as_str()));
            } else {
                cmd_args.extend_from_slice(&["-b:v:0", "0"]);
            }
            if matches!(output_codec.as_str(), "libx264" | "libx265") {
                cmd_args.extend_from_slice(&["-preset", "slow"]);
            }
            if matches!(container, "mp4" | "mov") {
                cmd_args.extend_from_slice(&["-movflags", "+faststart"]);
            }
        }

        // Quality
        let compression_quality: String = {
            let default_crf: u16 = 28;
            let max_crf: u16 = 36;
            let min_crf: u16 = 24;
            if (0..=100).contains(&quality) {
                let diff = (max_crf - min_crf) - ((max_crf - min_crf) * quality) / 100;
                format!("{}", min_crf + diff)
            } else {
                format!("{default_crf}")
            }
        };
        if is_audio_target {
            // No video is encoded
        } else if bitrate_target.is_some() {
            // The bitrate sets the quality
        } else if preset_name.is_some() && !is_gif_target {
            cmd_args.extend_from_slice(&["-crf", compression_quality.as_str()]);
        } else {
            cmd_args.extend_from_slice(&["-crf", "18"]);
        }

        // Build the post-processing chain for video (transforms + scale + pad)
        let video_post_process = build_ffmpeg_filters(transform_history, dimensions);

        let mut filter_complex_parts: Vec<String> = Vec::new();
        let mut map_video = false;
        let mut map_audio = false;

        let volume_filter_str = if is_silent_audio {
            "volume=0".to_string()
        } else if audio_config.volume > 0 && audio_config.volume != 100 {
            let volume_value = audio_config.volume as f32 / 100.0;
            format!("volume={}", volume_value)
        } else {
            "".to_string()
        };

        let channel_filter_str =
            if let Some(channel_config) = audio_config.audio_channel_config.as_ref() {
                if let Some(ref layout) = channel_config.channel_layout {
                    match layout.as_str() {
                        "mono" => {
                            if let Some(ref mono_source) = channel_config.mono_source {
                                match (mono_source.left, mono_source.right) {
                                    (true, true) => "aformat=channel_layouts=mono".to_string(),
                                    (true, false) => "pan=mono|c0=c0".to_string(),
                                    (false, true) => "pan=mono|c0=c1".to_string(),
                                    (false, false) => "aformat=channel_layouts=mono".to_string(),
                                }
                            } else {
                                "aformat=channel_layouts=mono".to_string()
                            }
                        }
                        "stereo" => {
                            if channel_config.stereo_swap_channels == Some(true) {
                                "pan=stereo|c0=c1|c1=c0".to_string()
                            } else {
                                "".to_string()
                            }
                        }
                        _ => "".to_string(),
                    }
                } else {
                    "".to_string()
                }
            } else {
                "".to_string()
            };

        let combined_audio_filter =
            if !channel_filter_str.is_empty() && !volume_filter_str.is_empty() {
                format!("{},{}", channel_filter_str, volume_filter_str)
            } else if !channel_filter_str.is_empty() {
                channel_filter_str
            } else if !volume_filter_str.is_empty() {
                volume_filter_str
            } else {
                "".to_string()
            };

        let clamped_speed = speed.map(|s| s.clamp(0.25, 4.0));
        let video_speed_filter = if let Some(speed_value) = clamped_speed {
            if speed_value != 1.0 {
                let pts_multiplier = 1.0 / speed_value;
                Some(format!("setpts={}*PTS", pts_multiplier))
            } else {
                None
            }
        } else {
            None
        };

        fn build_audio_speed_filter(speed: f32) -> String {
            if speed == 1.0 {
                return String::new();
            }
            if speed >= 0.5 && speed <= 2.0 {
                return format!("atempo={}", speed);
            }
            if speed < 0.5 {
                // For speeds < 0.5, chain multiple atempo=0.5 filters
                let mut filters = Vec::new();
                let mut remaining = speed;
                while remaining < 0.5 {
                    filters.push("atempo=0.5".to_string());
                    remaining /= 0.5;
                }
                if remaining > 0.0 && remaining != 1.0 {
                    filters.push(format!("atempo={}", remaining));
                }
                filters.join(",")
            } else {
                // For speeds > 2.0, chain multiple atempo=2.0 filters
                let mut filters = Vec::new();
                let mut remaining = speed;
                while remaining > 2.0 {
                    filters.push("atempo=2.0".to_string());
                    remaining /= 2.0;
                }
                if remaining > 0.0 && remaining != 1.0 {
                    filters.push(format!("atempo={}", remaining));
                }
                filters.join(",")
            }
        }

        let audio_speed_filter = if let Some(speed_value) = clamped_speed {
            build_audio_speed_filter(speed_value)
        } else {
            String::new()
        };

        if let Some(segments) = trim_segments.filter(|_| !is_audio_target) {
            if !segments.is_empty() {
                map_video = true;
                if segments.len() == 1 {
                    let seg = &segments[0];
                    // Single trim: trim -> speed -> post_process -> [outv]
                    let speed_part = video_speed_filter
                        .as_ref()
                        .map(|f| format!("{},", f))
                        .unwrap_or_default();
                    filter_complex_parts.push(format!(
                        "[0:v]trim={}:{},setpts=PTS-STARTPTS,{}{}[outv]",
                        seg.start, seg.end, speed_part, video_post_process
                    ));
                } else {
                    // Multi trim: trim segments -> concat -> speed -> post process -> [outv]
                    let mut video_parts = Vec::new();
                    let mut video_labels = Vec::new();
                    for (i, seg) in segments.iter().enumerate() {
                        let label = format!("v{}", i);
                        video_labels.push(format!("[{}]", label));
                        video_parts.push(format!(
                            "[0:v]trim={}:{},setpts=PTS-STARTPTS[{}]",
                            seg.start, seg.end, label
                        ));
                    }
                    filter_complex_parts.push(video_parts.join("; "));

                    let speed_part = video_speed_filter
                        .as_ref()
                        .map(|f| format!("{},", f))
                        .unwrap_or_default();
                    filter_complex_parts.push(format!(
                        "{} concat=n={}:v=1:a=0,{}{}[outv]",
                        video_labels.join(""),
                        segments.len(),
                        speed_part,
                        video_post_process
                    ));
                }
            }
        }

        // If no trimming, just apply post-processing to input
        if !map_video && !is_audio_target {
            let speed_part = video_speed_filter
                .as_ref()
                .map(|f| format!("{},", f))
                .unwrap_or_default();
            filter_complex_parts.push(format!("[0:v]{}{}[outv]", speed_part, video_post_process));
            map_video = true;
        }

        if keeps_audio && has_audio_stream {
            if let Some(segments) = trim_segments {
                if !segments.is_empty() {
                    map_audio = true;

                    let audio_tracks_to_process: Vec<usize> =
                        if let Some(ref selected_tracks) = selected_audio_tracks {
                            selected_tracks.clone()
                        } else {
                            (0..audio_streams.len()).collect()
                        };

                    for (track_idx, track_index) in audio_tracks_to_process.iter().enumerate() {
                        let out_label = if audio_tracks_to_process.len() == 1 {
                            "outa".to_string()
                        } else {
                            format!("outa{}", track_idx)
                        };

                        // Combine audio filters: volume/channel + speed
                        let audio_filters_with_speed = if !combined_audio_filter.is_empty()
                            && !audio_speed_filter.is_empty()
                        {
                            format!("{},{}", combined_audio_filter, audio_speed_filter)
                        } else if !combined_audio_filter.is_empty() {
                            combined_audio_filter.clone()
                        } else if !audio_speed_filter.is_empty() {
                            audio_speed_filter.clone()
                        } else {
                            String::new()
                        };

                        let audio_filters_with_speed_comma = if !audio_filters_with_speed.is_empty()
                        {
                            format!(",{}", audio_filters_with_speed)
                        } else {
                            "".to_string()
                        };

                        if segments.len() == 1 {
                            let seg = &segments[0];
                            filter_complex_parts.push(format!(
                                "[0:a:{}]atrim={}:{},asetpts=PTS-STARTPTS{}[{}]",
                                track_index,
                                seg.start,
                                seg.end,
                                audio_filters_with_speed_comma,
                                out_label
                            ));
                        } else {
                            let mut audio_parts = Vec::new();
                            let mut audio_labels = Vec::new();
                            for (i, seg) in segments.iter().enumerate() {
                                let label = format!("a{}t{}", track_idx, i);
                                audio_labels.push(format!("[{}]", label));
                                audio_parts.push(format!(
                                    "[0:a:{}]atrim={}:{},asetpts=PTS-STARTPTS[{}]",
                                    track_index, seg.start, seg.end, label
                                ));
                            }
                            filter_complex_parts.push(format!(
                                "{}; {} concat=n={}:v=0:a=1{}[{}]",
                                audio_parts.join("; "),
                                audio_labels.join(""),
                                segments.len(),
                                audio_filters_with_speed_comma,
                                out_label
                            ));
                        }
                    }
                }
            }
        }

        let fc = match filter_complex_parts.len() {
            0 => "".to_string(),
            _ => filter_complex_parts.join(";").to_string(),
        };

        if !fc.is_empty() {
            cmd_args.extend_from_slice(&["-filter_complex", &fc]);
        }

        // FPS
        if let Some(fps_val) = fps.filter(|_| !is_audio_target) {
            cmd_args.push("-r");
            cmd_args.push(fps_val);
        }

        // Map output video
        if map_video {
            cmd_args.extend_from_slice(&["-map", "[outv]"]);
        }

        let mut audio_args_owned: Vec<String> = Vec::new();

        // Map output audio
        if map_audio {
            let processed_tracks: Vec<usize> =
                if let Some(ref selected_tracks) = selected_audio_tracks {
                    selected_tracks.clone()
                } else {
                    (0..audio_streams.len()).collect()
                };

            for (track_idx, _) in processed_tracks.iter().enumerate() {
                audio_args_owned.push("-map".to_string());

                let out_label = if processed_tracks.len() == 1 {
                    "[outa]".to_string()
                } else {
                    format!("[outa{}]", track_idx)
                };

                audio_args_owned.push(out_label);
            }
        } else if keeps_audio && has_audio_stream {
            if let Some(ref selected_tracks) = selected_audio_tracks {
                for &track_index in selected_tracks {
                    audio_args_owned.push("-map".to_string());
                    audio_args_owned.push(format!("0:a:{}", track_index));
                }
            } else {
                cmd_args.extend_from_slice(&["-map", "0:a?"]);
            }
        }

        // Audio filter
        let audio_filter_args: Vec<String> = {
            if has_audio_stream
                && !map_audio
                && (!combined_audio_filter.is_empty()
                    || !audio_speed_filter.is_empty()
                    || (keeps_audio && audio_config.volume != 100))
            {
                let mut args = vec![];
                let audio_filters_with_speed =
                    if !combined_audio_filter.is_empty() && !audio_speed_filter.is_empty() {
                        format!("{},{}", combined_audio_filter, audio_speed_filter)
                    } else if !combined_audio_filter.is_empty() {
                        combined_audio_filter.clone()
                    } else if !audio_speed_filter.is_empty() {
                        audio_speed_filter.clone()
                    } else {
                        String::new()
                    };

                if let Some(ref selected_tracks) = selected_audio_tracks {
                    // `-filter:a:N` targets the Nth *output* audio stream (in mapping order), not
                    // the input track number
                    for output_index in 0..selected_tracks.len() {
                        args.push(format!("-filter:a:{}", output_index));
                        args.push(audio_filters_with_speed.clone());
                    }
                } else {
                    for track_index in 0..audio_streams.len() {
                        args.push(format!("-filter:a:{}", track_index));
                        args.push(audio_filters_with_speed.clone());
                    }
                }
                args
            } else {
                vec![]
            }
        };
        audio_args_owned.extend(audio_filter_args);

        // Audio-only outputs share compatibility handling in both Quality and Target Size modes.
        if is_audio_target {
            audio_args_owned.extend(audio_output_encoding_args(
                &audio_codec,
                source_sample_rate,
                audio_channels,
                planned_audio_bitrate.or(audio_config.bitrate),
                target_size.is_some(),
            ));
        } else if keeps_audio && has_audio_stream {
            if let Some(bitrate) = audio_config.bitrate {
                audio_args_owned.extend(["-b:a".into(), format!("{}k", bitrate)]);
            }
            if let Some(codec) = &audio_config.audio_codec {
                audio_args_owned.extend(["-c:a".into(), codec.clone()]);
            }
        }

        cmd_args.extend(audio_args_owned.iter().map(|s| s.as_str()));

        if !keeps_audio || is_gif_target {
            cmd_args.push("-an");
        }

        let mut metadata_args: Vec<String> = Vec::new();

        if !is_gif_target && !should_strip_metadata {
            if let Some(metadata) = metadata_config {
                if let Some(ref title) = metadata.title {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("title={}", title.trim()));
                }
                if let Some(ref artist) = metadata.artist {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("artist={}", artist.trim()));
                }
                if let Some(ref album) = metadata.album {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("album={}", album.trim()));
                }
                if let Some(ref year) = metadata.year {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("date={}", year.trim()));
                }
                if let Some(ref comment) = metadata.comment {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("comment={}", comment.trim()));
                }
                if let Some(ref description) = metadata.description {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("description={}", description.trim()));
                }
                if let Some(ref synopsis) = metadata.synopsis {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("synopsis={}", synopsis.trim()));
                }
                if let Some(ref genre) = metadata.genre {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("genre={}", genre.trim()));
                }
                if let Some(ref copyright) = metadata.copyright {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("copyright={}", copyright.trim()));
                }
                if let Some(ref creation_time) = metadata.creation_time {
                    metadata_args.push("-metadata".to_string());
                    metadata_args.push(format!("creation_time={}", creation_time.trim()));
                }
            }
        }

        // Remove the `Chapters` metadata forcefully if video has been trimmed
        if let Some(segments) = trim_segments {
            if !segments.is_empty() {
                metadata_args.extend_from_slice(&["-map_chapters".to_string(), "-1".to_string()]);
            }
        }

        for arg in metadata_args.iter().map(|s| s.as_str()) {
            cmd_args.push(arg);
        }

        let mut subtitle_args_owned: Vec<String> = Vec::new();
        let mut subtitle_index = 0usize;

        if !is_gif_target && !is_audio_target {
            if has_existing_subtitles {
                let bitmap_codecs = ["hdmv_pgs_subtitle", "dvd_subtitle", "xsub"];

                for (idx, stream) in existing_subtitle_streams.iter().enumerate() {
                    let is_bitmap = bitmap_codecs.contains(&stream.codec.as_str());
                    let output_container = container;

                    if is_bitmap && output_container != "mkv" {
                        log::warn!(
                            "[ffmpeg] Skipping bitmap subtitle stream {} (codec: {}) - not compatible with {} container",
                            idx,
                            stream.codec,
                            output_container
                        );
                        continue;
                    }

                    if output_container == "avi" || output_container == "ts" {
                        log::warn!("[ffmpeg] Skipping subtitle stream {} (codec: {}) - {} container has limited subtitle support", idx, stream.codec, output_container);
                        continue;
                    }

                    subtitle_args_owned.push("-map".to_string());
                    subtitle_args_owned.push(format!("0:s:{}", idx));

                    let subtitle_codec = match output_container {
                        "mkv" if is_bitmap => "copy",
                        "mkv" => "srt",
                        "webm" => "webvtt",
                        _ => "mov_text",
                    };

                    subtitle_args_owned.push(format!("-c:s:{}", subtitle_index));
                    subtitle_args_owned.push(subtitle_codec.to_string());

                    if let Some(ref lang) = stream.language {
                        subtitle_args_owned.push(format!("-metadata:s:s:{}", subtitle_index));
                        subtitle_args_owned.push(format!("language={}", lang));
                    }

                    if let Some(ref title) = stream.title {
                        subtitle_args_owned.push(format!("-metadata:s:s:{}", subtitle_index));
                        subtitle_args_owned.push(format!("title={}", title.trim()));
                    }

                    subtitle_index += 1;
                }
            }

            for (sub_input_idx, language, title) in subtitle_input_indices.iter() {
                if container == "avi" || container == "ts" {
                    log::warn!("[ffmpeg] Skipping external subtitle file - {} container has limited subtitle support", container);
                    continue;
                }

                subtitle_args_owned.push("-map".to_string());
                subtitle_args_owned.push(format!("{}:s", sub_input_idx));

                let subtitle_codec = match container {
                    "mkv" => "copy",
                    "webm" => "webvtt",
                    _ => "mov_text",
                };
                subtitle_args_owned.push(format!("-c:s:{}", subtitle_index));
                subtitle_args_owned.push(subtitle_codec.to_string());

                if !language.is_empty() {
                    subtitle_args_owned.push(format!("-metadata:s:s:{}", subtitle_index));
                    subtitle_args_owned.push(format!("language={}", language));
                }

                if let Some(ref t) = title {
                    subtitle_args_owned.push(format!("-metadata:s:s:{}", subtitle_index));
                    subtitle_args_owned.push(format!("title={}", t));
                }

                subtitle_index += 1;
            }
        }
        cmd_args.extend(subtitle_args_owned.iter().map(|s| s.as_str()));

        if !is_gif_target
            && !is_audio_target
            && custom_thumbnail_path.is_some()
            && container != "webm"
            && container != "ts"
        {
            if let Some(thumb_path) = custom_thumbnail_path {
                if thumb_path.len() > 0 {
                    cmd_args.push("-c:v:1");
                    if thumb_path.to_lowercase().ends_with(".webp") {
                        cmd_args.push("png");
                    } else {
                        cmd_args.push("copy");
                    }
                    cmd_args.extend_from_slice(&["-map", "1"]);
                    cmd_args.extend_from_slice(&["-disposition:v:1", "attached_pic"]);
                }
            }
        }

        let output_path = output_file.display().to_string();
        cmd_args.extend_from_slice(&["-y", &output_path]);

        // The parts compressed for an estimate are many & short, so they are not logged as usual
        let log_level = if self.input_range.is_some() {
            log::Level::Debug
        } else {
            log::Level::Info
        };
        log::log!(log_level, "[ffmpeg] final command{:?}", cmd_args);

        // On the graphics card first when it can encode the codec (not GIFs, audio or lossless), then
        // on the CPU if that fails, so a video is never lost to the graphics card (see
        // `hardware_encoder`)
        let cpu_args: Vec<String> = cmd_args.iter().map(|arg| arg.to_string()).collect();
        let hardware_encoder = if preset_name.is_some() && !is_gif_target && !is_audio_target {
            hardware_encoder::encoder_for(&self.app, &output_codec).await
        } else {
            None
        };
        if let Some(encoder) = &hardware_encoder {
            log::log!(
                log_level,
                "[ffmpeg] on the graphics card ({}): {:?}",
                encoder.name,
                hardware_encoder::to_hardware_args(&cpu_args, encoder)
            );
        }

        let output_file_clone = output_file.clone();
        let cancel_callback: CancelCallback = Arc::new(move || {
            std::fs::remove_file(&output_file_clone).ok();
            log::info!("Cleaned up partial output file: {:?}", output_file_clone);
        });

        let app_clone = self.app.clone();
        let video_id_for_progress = video_id.to_string();
        let batch_id_for_progress = batch_id.clone();
        let re = Regex::new(r"out_time=(?P<out_time>.*?)\n").unwrap();

        let stdout_callback = Arc::new(move |_process_index: usize, stdout_line: String| {
            if let Some(cap) = re.captures(&stdout_line) {
                if let Some(out_time) = cap.name("out_time") {
                    let duration = out_time.as_str();
                    if !duration.is_empty() {
                        let video_progress = VideoCompressionProgress {
                            video_id: video_id_for_progress.clone(),
                            batch_id: batch_id_for_progress.clone(),
                            current_duration: duration.to_string(),
                        };
                        {
                            // To the whole app (any window can be compressing)
                            let window = app_clone.clone();
                            window
                                .emit(
                                    CustomEvents::VideoCompressionProgress.as_ref(),
                                    video_progress,
                                )
                                .ok();
                        }
                    }
                }
            }
        });

        // With a target size, an output larger than it, or well under it (the encoder kept below
        // the bitrate, e.g. on still footage), is encoded again at a bitrate worked out from the
        // outputs so far (see `next_target_bitrate`). Every output is kept until the end & the best
        // is used: the largest within the size (the most quality for it), or else the smallest. A
        // retry that fails keeps the earlier outputs.
        let mut target_bitrate = target_size.map(|target| {
            if is_audio_target {
                planned_audio_bitrate.unwrap()
            } else {
                target.video_bitrate
            }
        });
        let mut size_attempt: u32 = 0;
        let mut candidates: Vec<(PathBuf, u64)> = Vec::new();
        let mut samples: Vec<SizeSample> = Vec::new();
        let remove_candidates = |candidates: &[(PathBuf, u64)]| {
            for (path, _) in candidates {
                std::fs::remove_file(path).ok();
            }
        };
        loop {
            let is_retry = size_attempt > 0;
            // The first encode is at the quality when its estimated size fits
            let is_quality_round = !is_retry && target_size.is_some_and(|t| t.quality_first);
            // "Reach target sizes without acceleration": retries skip the graphics card, as the CPU
            // keeps to a bitrate much more closely (the first encode is still on the graphics card)
            let retry_on_cpu = is_retry && target_size.is_some_and(|target| target.retry_on_cpu);
            let round_cpu_args = match target_bitrate {
                Some(bitrate) if is_retry && is_audio_target => {
                    with_audio_bitrate(&cpu_args, bitrate)
                }
                Some(bitrate) if is_retry => with_bitrate(&cpu_args, bitrate),
                _ => cpu_args.clone(),
            };
            let mut round_attempts: Vec<(Option<&'static str>, Vec<String>)> = Vec::new();
            if let Some(encoder) = hardware_encoder.as_ref().filter(|_| !retry_on_cpu) {
                round_attempts.push((
                    Some(encoder.name),
                    hardware_encoder::to_hardware_args(&round_cpu_args, encoder),
                ));
            }
            round_attempts.push((None, round_cpu_args));
            if is_retry {
                // Only when the retry leaves the graphics card; without hardware acceleration
                // (turned off, or none for the codec) every encode is on the CPU anyway
                let on_cpu = hardware_encoder.is_some() && retry_on_cpu;
                let _ = self.app.emit_to(
                    self.owner_window.as_str(),
                    TARGET_SIZE_RETRY_EVENT,
                    TargetSizeRetry {
                        video_id: video_id.to_string(),
                        pass: size_attempt + 1,
                        on_cpu,
                    },
                );
            }

            let mut round_error: Option<String> = None;
            // Whether the output was encoded on the graphics card (it falls back to the CPU)
            let mut on_graphics_card = false;
            let attempt_count = round_attempts.len();
            for (attempt, (hardware_encoder_name, args)) in round_attempts.into_iter().enumerate() {
                let is_last_attempt = attempt + 1 == attempt_count;

                let mut ffmpeg_cmd = self.get_ffmpeg_command()?;
                ffmpeg_cmd.args(args);

                let executor = MediaProcessExecutorBuilder::new(self.app.clone())
                    .owner_window(&self.owner_window)
                    .command(ffmpeg_cmd)
                    .with_cancel_support(
                        vec![video_id.to_string(), batch_id.clone()],
                        Some(cancel_callback.clone()),
                    )
                    .with_stdout_callback(stdout_callback.clone())
                    .build()?;

                let error = match executor.spawn_and_wait().await {
                    Ok(result) if result.success() => {
                        on_graphics_card = hardware_encoder_name.is_some();
                        break;
                    }
                    // Cancelled by the user: not tried again, & nothing is kept
                    Err(error) if error == "CANCELLED" => {
                        remove_candidates(&candidates);
                        return Err(error);
                    }
                    Ok(_) => "Video compression failed".to_string(),
                    Err(error) => error,
                };
                // The window compressing it was closed (its processes are stopped with it)
                if self.app.get_webview_window(&self.owner_window).is_none() {
                    remove_candidates(&candidates);
                    return Err(error);
                }
                if is_last_attempt {
                    round_error = Some(error);
                    break;
                }
                log::warn!(
                    "[ffmpeg] compressing on the graphics card ({}) failed ({}), compressing on the CPU instead",
                    hardware_encoder_name.unwrap_or_default(),
                    error
                );
            }
            if let Some(error) = round_error {
                if candidates.is_empty() {
                    return Err(error);
                }
                log::warn!(
                    "[ffmpeg] compressing again for the target size failed ({}), keeping the earlier output",
                    error
                );
                break;
            }

            let (Some(target), Some(bitrate)) = (target_size, target_bitrate) else {
                break;
            };
            let output_size = std::fs::metadata(&output_file)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            log::info!(
                "[ffmpeg] target size {} bytes: {} bytes {} on the {}",
                target.size_in_bytes,
                output_size,
                if is_quality_round {
                    "at the quality".to_string()
                } else {
                    format!("at {} kbit/s", bitrate)
                },
                if on_graphics_card { "graphics card" } else { "CPU" }
            );
            let candidate = output_file.with_file_name(format!(
                "{}.attempt{}.{}",
                video_id, size_attempt, convert_to_extension
            ));
            if std::fs::rename(&output_file, &candidate).is_ok() {
                candidates.push((candidate, output_size));
            }
            if !is_quality_round {
                samples.push(SizeSample {
                    on_graphics_card,
                    bitrate,
                    size: output_size,
                });
            }

            // Done when the quality fits, or an output is close under the size
            let is_close = candidates.iter().any(|(_, size)| {
                *size <= target.size_in_bytes
                    && *size as f64 >= target.size_in_bytes as f64 * TARGET_SIZE_CLOSE
            });
            if (is_quality_round && output_size <= target.size_in_bytes)
                || is_close
                || output_size == 0
                || size_attempt >= MAX_TARGET_SIZE_RETRIES
            {
                break;
            }
            let next_on_graphics_card = hardware_encoder.is_some() && !target.retry_on_cpu;
            let next_bitrate = next_target_bitrate(
                &samples,
                next_on_graphics_card,
                if is_audio_target {
                    planned_audio_bitrate.unwrap()
                } else {
                    target.video_bitrate
                },
                target.size_in_bytes,
            );
            let next_bitrate = if is_audio_target {
                let next = next_bitrate.clamp(minimum_audio_bitrate, maximum_audio_bitrate);
                if samples.iter().any(|sample| sample.bitrate == next) {
                    break;
                }
                next
            } else {
                next_bitrate
            };
            log::info!(
                "[ffmpeg] {} bytes is {} the target size of {} bytes, compressing again at {} kbit/s on the {}",
                output_size,
                if output_size > target.size_in_bytes {
                    "over"
                } else {
                    "well under"
                },
                target.size_in_bytes,
                next_bitrate,
                if next_on_graphics_card {
                    "graphics card"
                } else {
                    "CPU"
                }
            );
            target_bitrate = Some(next_bitrate);
            size_attempt += 1;
        }

        // The best output becomes the output; the others are kept, to be chosen instead
        let mut other_outputs: Vec<OutputOption> = Vec::new();
        if let (Some(target), false) = (target_size, candidates.is_empty()) {
            let best = candidates
                .iter()
                .filter(|(_, size)| *size <= target.size_in_bytes)
                .max_by_key(|(_, size)| *size)
                .or_else(|| candidates.iter().min_by_key(|(_, size)| *size))
                .map(|(path, size)| (path.clone(), *size));
            if let Some((best_path, best_size)) = best {
                for (path, size) in &candidates {
                    if *path == best_path {
                        std::fs::rename(path, &output_file).map_err(|err| err.to_string())?;
                    } else {
                        other_outputs.push(OutputOption {
                            file_path: path.display().to_string(),
                            size: *size,
                        });
                    }
                }
                log::info!(
                    "[ffmpeg] kept the output of {} bytes for the target size of {} bytes",
                    best_size,
                    target.size_in_bytes
                );
            }
        }

        if convert_to_extension == "gif" {
            log::info!("[ffmpeg] Converting processed video to GIF");

            let temp_video_path = output_file.to_string_lossy().to_string();

            let gif_output_path = self
                .convert_video_to_gif(&temp_video_path, quality as u8, video_id, dimensions, fps)
                .await?;

            std::fs::remove_file(&temp_video_path).ok();
            log::info!(
                "[ffmpeg] Removed temporary video file: {:?}",
                temp_video_path
            );

            let gif_path = gif_output_path.to_string_lossy().to_string();
            let file_metadata = get_file_metadata(&gif_path);
            let gif_file_name = format!("{}.gif", video_id);

            return Ok(VideoCompressionResult {
                video_id: video_id.to_owned(),
                file_name: gif_file_name,
                file_path: gif_path,
                file_metadata: file_metadata.ok(),
                other_outputs: Vec::new(),
            });
        }

        let file_metadata = get_file_metadata(&output_file.to_string_lossy().to_string());
        Ok(VideoCompressionResult {
            video_id: video_id.to_owned(),
            file_name,
            file_path: output_file.display().to_string(),
            file_metadata: file_metadata.ok(),
            other_outputs,
        })
    }

    /// About the size a video comes out at with its settings (`config`, compressed by quality), in
    /// bytes: a short video is compressed whole, a longer one in a few short parts spread over it,
    /// whose size is scaled up to its length. Cancelled like a compression, by `estimate_id`.
    /// - `duration`: the video's length, in seconds
    pub async fn estimate_video_size(
        &mut self,
        estimate_id: &str,
        config: &VideoCompressionConfig,
        duration: f64,
    ) -> Result<u64, String> {
        // The parts of the video kept (all of it, unless trimmed)
        let segments: Vec<(f64, f64)> = config
            .trim_segments
            .as_ref()
            .map(|segments| {
                segments
                    .iter()
                    .filter(|segment| segment.end > segment.start)
                    .map(|segment| (segment.start, segment.end))
                    .collect::<Vec<_>>()
            })
            .filter(|segments| !segments.is_empty())
            .unwrap_or_else(|| vec![(0.0, duration)]);
        let kept_length: f64 = segments.iter().map(|(start, end)| end - start).sum();
        if kept_length <= 0.0 {
            return Err("The video has no length".to_string());
        }

        // Short videos whole (exact), longer ones in many short parts spread evenly over the kept
        // length (footage often changes a lot over a video, so a few parts can be far off)
        let parts: Vec<Option<(f64, f64)>> = if kept_length <= ESTIMATE_WHOLE_VIDEO_SECONDS {
            vec![None]
        } else {
            let count = ((kept_length / ESTIMATE_SECONDS_PER_SAMPLE).round() as usize)
                .clamp(ESTIMATE_MIN_SAMPLES, ESTIMATE_MAX_SAMPLES);
            (0..count)
                .map(|index| {
                    let middle = kept_length * (index as f64 + 0.5) / count as f64;
                    // The kept segment the middle falls in (the last one, past its end), & the
                    // part around the middle within it
                    let mut offset = middle;
                    let (start, end) = segments
                        .iter()
                        .find(|(start, end)| {
                            let is_in = offset <= end - start;
                            if !is_in {
                                offset -= end - start;
                            }
                            is_in
                        })
                        .copied()
                        .unwrap_or(segments[segments.len() - 1]);
                    let length = end - start;
                    let part_length = ESTIMATE_SAMPLE_SECONDS.min(length);
                    let part_start = (start + offset.min(length) - part_length / 2.0)
                        .clamp(start, end - part_length);
                    Some((part_start, part_length))
                })
                .collect()
        };

        // A few parts at a time
        let mut size: u64 = 0;
        let mut encoded_length: f64 = 0.0;
        let mut pending = parts.into_iter().enumerate();
        let mut running = tokio::task::JoinSet::new();
        loop {
            while running.len() < ESTIMATE_PARALLEL_SAMPLES {
                let Some((index, range)) = pending.next() else {
                    break;
                };
                let app = self.app.clone();
                let owner_window = self.owner_window.clone();
                let config = config.clone();
                let estimate_id = estimate_id.to_string();
                running.spawn(async move {
                    let result = FFMPEG::new(&app)?
                        .with_owner_window(&owner_window)
                        .with_input_range(range)
                        .compress_video(
                            &config.video_path,
                            &config.convert_to_extension,
                            config.preset_name.as_deref(),
                            &format!("{}-{}", estimate_id, index),
                            Some(estimate_id.as_str()),
                            &config.audio_config,
                            config.quality,
                            config.dimensions,
                            config.fps.as_deref(),
                            config.video_codec.as_deref(),
                            config.transform_history.as_ref().map(|v| v.as_ref()),
                            config.strip_metadata,
                            config.metadata_config.as_ref(),
                            None,
                            // A part is already taken from the kept segments
                            if range.is_some() {
                                None
                            } else {
                                config.trim_segments.as_ref()
                            },
                            None,
                            config.speed,
                            None,
                        )
                        .await?;
                    let path = PathBuf::from(&result.file_path);
                    let part_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                    std::fs::remove_file(&path).ok();
                    Ok::<(u64, Option<(f64, f64)>), String>((part_size, range))
                });
            }
            let Some(joined) = running.join_next().await else {
                break;
            };
            match joined.map_err(|err| err.to_string()).and_then(|result| result) {
                Ok((part_size, range)) => {
                    size += part_size;
                    encoded_length += range.map(|(_, length)| length).unwrap_or(kept_length);
                }
                // No more parts are started; those running finish (they are short) & are deleted
                Err(error) => {
                    while running.join_next().await.is_some() {}
                    return Err(error);
                }
            }
        }
        if encoded_length <= 0.0 {
            return Err("Nothing was encoded".to_string());
        }
        let estimate = (size as f64 * kept_length / encoded_length).round() as u64;
        log::info!(
            "[ffmpeg] estimated {} bytes for {:?} ({} bytes for {:.1} of {:.1} seconds)",
            estimate,
            config.video_path,
            size,
            encoded_length,
            kept_length
        );
        Ok(estimate)
    }

    /// Compressed videos in batch
    pub async fn compress_videos_batch(
        &mut self,
        batch_id: &str,
        videos: Vec<VideoCompressionConfig>,
    ) -> Result<BatchCompressionResult, String> {
        let mut results: std::collections::HashMap<String, VideoCompressionResult> =
            std::collections::HashMap::new();
        let total_count = videos.len();

        for (index, video_options) in videos.iter().enumerate() {
            let video_id = &video_options.video_id;

            let app_clone = self.app.clone();
            let batch_id_clone = batch_id.to_string();
            let video_id_clone = video_id.clone();

            // Removed again once this media is done (see `EventListenerGuard`)
            // Progress of the whole app (from any window)
            let _progress_listener = {
                let window = app_clone.clone();
                let event_id = app_clone.listen_any(
                    CustomEvents::VideoCompressionProgress.as_ref(),
                    move |evt| {
                        if let Ok(progress) =
                            serde_json::from_str::<VideoCompressionProgress>(evt.payload())
                        {
                            if progress.video_id == video_id_clone {
                                let batch_progress = BatchVideoCompressionProgress {
                                    batch_id: batch_id_clone.to_owned(),
                                    current_index: index,
                                    total_count,
                                    video_progress: progress,
                                };
                                let _ = window.emit(
                                    CustomEvents::BatchVideoCompressionProgress.as_ref(),
                                    batch_progress,
                                );
                            }
                        }
                    },
                );
                EventListenerGuard::for_app(app_clone.clone(), event_id)
            };

            let mut ffmpeg_instance = match FFMPEG::new(&self.app).map(|f| f.with_owner_window(&self.owner_window)) {
                Ok(f) => f,
                Err(e) => return Err(format!("Failed to create ffmpeg instance: {}", e)),
            };

            let app_clone2 = self.app.clone();
            let batch_id_clone2 = batch_id.to_string();

            let video_path = &video_options.video_path;
            let convert_to_extension = &video_options.convert_to_extension;
            let preset_name = video_options.preset_name.as_deref();
            let batch_id_for_compression = batch_id;
            let audio_config = &video_options.audio_config;
            let quality = video_options.quality;
            let dimensions = video_options.dimensions;
            let fps = video_options.fps.as_deref();
            let video_codec = video_options.video_codec.as_deref();
            let transform_history = video_options.transform_history.as_ref().map(|v| v.as_ref());
            let metadata_config = video_options.metadata_config.as_ref();
            let thumbnail_path = video_options.custom_thumbnail_path.as_deref();
            let trim_segments = video_options.trim_segments.as_ref();
            let subtitles_config = video_options.subtitles_config.as_ref();
            let strip_metadata = video_options.strip_metadata;
            let speed = video_options.speed;

            match ffmpeg_instance
                .compress_video(
                    video_path,
                    convert_to_extension,
                    preset_name,
                    video_id,
                    Some(batch_id_for_compression),
                    audio_config,
                    quality,
                    dimensions,
                    fps,
                    video_codec,
                    transform_history,
                    strip_metadata,
                    metadata_config,
                    thumbnail_path,
                    trim_segments,
                    subtitles_config,
                    speed,
                    video_options.target_size.as_ref(),
                )
                .await
            {
                Ok(result) => {
                    let video_id = result.video_id.clone();
                    results.insert(video_id, result.clone());

                    tokio::spawn(async move {
                        {
                            // To the whole app (any window can be compressing)
                            let window = app_clone2.clone();
                            let individual_compression_result: BatchVideoIndividualCompressionResult =
                                BatchVideoIndividualCompressionResult {
                                    batch_id: batch_id_clone2,
                                    result: result,
                                };
                            let _ = window.emit(
                                CustomEvents::BatchVideoIndividualCompressionCompletion.as_ref(),
                                individual_compression_result,
                            );
                        }
                    });
                }
                Err(e) => {
                    if e == "CANCELLED" {
                        return Err(String::from("CANCELLED"));
                    }
                    log::error!("Failed to compress video at index {}: {}", index, e);
                }
            }
        }

        Ok(BatchCompressionResult { results })
    }

    /// Generates a .jpeg thumbnail image from a video path
    pub async fn generate_video_thumbnail(
        &mut self,
        video_path: &str,
        timestamp: Option<&str>,
    ) -> Result<VideoThumbnail, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exist in given path."));
        }
        // Nothing to take a picture of (e.g. an audio file without cover art): said without running
        // FFmpeg, whose failure would fill the log
        // (when it cannot be read, FFmpeg is still tried)
        let video_streams = {
            let mut ffprobe = FFPROBE::new(&self.app)?.with_owner_window(&self.owner_window);
            ffprobe.get_video_streams(video_path).await
        };
        if video_streams.is_ok_and(|streams| streams.is_empty()) {
            return Err(String::from("The media has no picture."));
        }
        let id = nanoid!();
        let file_name = format!("{}.jpg", id);
        let output_path: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let timestamp_value = timestamp.unwrap_or("00:00:01.00");

        let mut ffmpeg_cmd = self.get_ffmpeg_command()?;
        ffmpeg_cmd.args([
            "-ss",
            timestamp_value,
            "-i",
            video_path,
            "-vf",
            "scale=trunc(iw*sar/2)*2:ih,setsar=1",
            "-frames:v",
            "1",
            // Without an explicit quality, the jpeg encoder falls back to a 200kb/s bitrate target,
            // giving a visibly soft image (it's also what the transform editor crops on).
            // 4 is visually close to the max (2) at ~40% smaller files. Keep the native resolution,
            // since crop coordinates from the editor are applied to the source in these pixels.
            "-q:v",
            "4",
            "-an",
            "-sn",
            &output_path.display().to_string(),
            "-y",
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(ffmpeg_cmd)
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err("Video is corrupted or thumbnail generation failed".to_string());
        }

        Ok(VideoThumbnail {
            id,
            file_name,
            file_path: output_path.display().to_string(),
        })
    }

    /// Extracts a subtitle stream from a video file to a separate subtitle file
    pub async fn extract_subtitle(
        &mut self,
        video_path: &str,
        stream_index: u32,
        output_path: &str,
        output_format: &str,
    ) -> Result<String, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exist in given path."));
        }

        let output_path_buf = PathBuf::from(output_path);

        if let Some(parent_dir) = output_path_buf.parent() {
            if !Path::exists(parent_dir) {
                return Err(String::from("Target directory does not exist."));
            }
        }

        let mut ffprobe = FFPROBE::new(&self.app)?.with_owner_window(&self.owner_window);
        let subtitle_streams = ffprobe.get_subtitle_streams(video_path).await?;

        let target_stream = match subtitle_streams.iter().find(|s| s.index == stream_index) {
            Some(stream) => stream,
            None => {
                let available_indices: Vec<u32> =
                    subtitle_streams.iter().map(|s| s.index).collect();
                return Err(format!(
                    "Subtitle stream with global index {} not found. Available subtitle stream indices: {:?}",
                    stream_index, available_indices
                ));
            }
        };

        let codec = &target_stream.codec;

        let subtitle_specific_index = subtitle_streams
            .iter()
            .position(|s| s.index == stream_index)
            .unwrap_or(0);

        let ffmpeg_codec = match output_format {
            "vtt" => "webvtt",
            _ => output_format,
        };

        if matches!(
            codec.as_str(),
            "hdmv_pgs_subtitle" | "dvd_subtitle" | "xsub"
        ) {
            return Err(format!(
                "Cannot extract subtitle: Codec '{}' cannot be converted to {}. This is an image-based subtitle format (e.g., Blu-ray PGS or DVD VobSub).",
                codec, output_format.to_uppercase()
            ));
        }

        let mut ffmpeg_cmd = self.get_ffmpeg_command()?;
        ffmpeg_cmd
            .args(["-i", video_path])
            .args(["-map", &format!("0:s:{}", subtitle_specific_index)])
            .args(["-c:s", ffmpeg_codec])
            .arg(&output_path_buf)
            .arg("-y");

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(ffmpeg_cmd)
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            if Path::exists(&output_path_buf) {
                return Err(format!(
                    "Failed to extract subtitle (exit code {}). The subtitle may be in an unsupported format.",
                    result.code()
                ));
            } else {
                return Err(String::from(
                    "Failed to extract subtitle: Output file was not created.",
                ));
            }
        }

        Ok(output_path.to_string())
    }

    pub async fn convert_video_to_gif(
        &mut self,
        video_path: &str,
        quality: u8,
        video_id: &str,
        dimensions: Option<(f64, f64)>,
        fps: Option<&str>,
    ) -> Result<PathBuf, String> {
        let output_filename = format!("{}.gif", video_id);
        let output_path: PathBuf = [self.assets_dir.clone(), PathBuf::from(&output_filename)]
            .iter()
            .collect();

        let output_path_str = output_path
            .to_str()
            .ok_or("Invalid output path")?
            .to_string();

        let video_duration_seconds = {
            let mut ffprobe = FFPROBE::new(&self.app)?.with_owner_window(&self.owner_window);
            let video_info = ffprobe.get_video_basic_info(video_path).await?;
            video_info.duration.unwrap_or(0.0)
        };

        let video_duration_offset = if video_duration_seconds > 0.0 {
            let hours = (video_duration_seconds / 3600.0) as u32;
            let minutes = ((video_duration_seconds % 3600.0) / 60.0) as u32;
            let seconds = video_duration_seconds % 60.0;
            format!("{:02}:{:02}:{:05.2}", hours, minutes, seconds)
        } else {
            String::from("00:00:00.00")
        };

        let mut ffmpeg_cmd = self.get_ffmpeg_command()?;
        ffmpeg_cmd.args([
            "-i",
            video_path,
            "-pix_fmt",
            "yuv420p", // Convert to 8-bit for yuv4mpegpipe compatibility
            "-f",
            "yuv4mpegpipe",
            "-",
        ]);

        let gifski_quality = quality.clamp(1, 100);
        let mut gifski_args: Vec<String> = vec!["-Q".to_string(), gifski_quality.to_string()];

        if let Some(fps_val) = fps {
            gifski_args.extend(["-r".to_string(), fps_val.to_string()]);
        }

        if let Some((width, height)) = dimensions {
            gifski_args.extend([
                "-W".to_string(),
                width.to_string(),
                "-H".to_string(),
                height.to_string(),
            ]);
        }

        gifski_args.extend(["-o".to_string(), output_path_str, "-".to_string()]);

        let gifski_args_refs: Vec<&str> = gifski_args.iter().map(|s| s.as_str()).collect();

        let image_compressor = ImageCompressor::new(&self.app)?.with_owner_window(&self.owner_window);
        let mut gifski_cmd = image_compressor
            .get_gifski_command()
            .map_err(|e| format!("Gifski command error: {}", e))?;
        gifski_cmd.args(&gifski_args_refs);

        log::info!(
            "[ffmpeg] final ffmpeg -> gifski args: {:?} | {:?}",
            ffmpeg_cmd.get_args(),
            gifski_cmd.get_args()
        );

        let cancel_callback = Arc::new(|| {
            log::info!("CANCELLED Video to GIF conversion");
        });

        let app_clone = self.app.clone();
        let video_id_for_progress = video_id.to_string();
        let video_duration_offset_clone = video_duration_offset.clone();
        let time_regex = Regex::new(r"time=(?P<time>[\d:.]+)").unwrap();

        let stderr_callback = Arc::new(move |process_index: usize, stderr_line: String| {
            if process_index == 0 {
                if let Some(cap) = time_regex.captures(&stderr_line) {
                    if let Some(time) = cap.name("time") {
                        let current_duration = time.as_str();
                        if !current_duration.is_empty() {
                            let combined_duration = if let Some(sum) =
                                utils::duration::add_durations(&[
                                    &video_duration_offset_clone,
                                    current_duration,
                                ]) {
                                sum
                            } else {
                                current_duration.to_string()
                            };

                            let video_progress = VideoCompressionProgress {
                                video_id: video_id_for_progress.clone(),
                                batch_id: String::new(),
                                current_duration: combined_duration,
                            };
                            {
                                // To the whole app (any window can be compressing)
                                let window = app_clone.clone();
                                window
                                    .emit(
                                        CustomEvents::VideoCompressionProgress.as_ref(),
                                        video_progress,
                                    )
                                    .ok();
                            }
                        }
                    }
                }
            }
        });

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .commands(vec![ffmpeg_cmd, gifski_cmd])
            .with_piped()
            .with_cancel_support(vec![video_id.to_string()], Some(cancel_callback))
            .with_stderr_callback(stderr_callback)
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err("Video to GIF conversion failed".to_string());
        }

        Ok(output_path)
    }
}

/// Builds complete FFmpeg filter complex for video/image post-processing
/// A video up to this long (seconds) is compressed whole for its estimated size
const ESTIMATE_WHOLE_VIDEO_SECONDS: f64 = 30.0;

/// A longer one is compressed in parts this long (seconds), one for about every this many
/// seconds of it (within the fewest & the most), a few at a time, for its estimate
const ESTIMATE_SAMPLE_SECONDS: f64 = 2.0;
const ESTIMATE_SECONDS_PER_SAMPLE: f64 = 15.0;
const ESTIMATE_MIN_SAMPLES: usize = 8;
const ESTIMATE_MAX_SAMPLES: usize = 30;
const ESTIMATE_PARALLEL_SAMPLES: usize = 3;

/// How many times a video is encoded again when it missed its target size
const MAX_TARGET_SIZE_RETRIES: u32 = 3;

/// An output at least this part of its target size (& within it) is kept as it is
const TARGET_SIZE_CLOSE: f64 = 0.85;

/// The part of its target size a retry aims for, leaving room for the encoder's drift
const TARGET_SIZE_AIM: f64 = 0.96;

/// The most a retry's bitrate changes from the previous one's (up or down)
const MAX_TARGET_SIZE_CHANGE: f64 = 4.0;

/// Sent to the window compressing a video when it is encoded again for its target size
const TARGET_SIZE_RETRY_EVENT: &str = "target-size-retry";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TargetSizeRetry {
    video_id: String,
    /// The encode it is (2 for the first retry)
    pass: u32,
    /// Encoded again on the CPU (instead of the graphics card)
    on_cpu: bool,
}

/// The options encoding a video at an average bitrate (in kbit/s), with its peaks kept near it
fn bitrate_args(video_bitrate: u32) -> Vec<String> {
    vec![
        "-b:v:0".to_string(),
        format!("{}k", video_bitrate),
        "-maxrate:v:0".to_string(),
        format!("{}k", video_bitrate.saturating_mul(3) / 2),
        "-bufsize:v:0".to_string(),
        format!("{}k", video_bitrate.saturating_mul(2)),
    ]
}

/// The arguments of an ffmpeg command encoding at a video bitrate (see `bitrate_args`): its
/// bitrate options replaced, & a constant quality (`-crf`) dropped
fn with_bitrate(args: &[String], video_bitrate: u32) -> Vec<String> {
    let mut next = Vec::with_capacity(args.len() + 6);
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "-b:v:0" if index + 1 < args.len() => {
                next.extend(bitrate_args(video_bitrate));
                index += 2;
            }
            "-crf" | "-maxrate:v:0" | "-bufsize:v:0" if index + 1 < args.len() => index += 2,
            arg => {
                next.push(arg.to_string());
                index += 1;
            }
        }
    }
    next
}

fn vorbis_sample_rate(source: u32) -> u32 {
    [
        8000_u32, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
    ]
    .into_iter()
    .min_by_key(|rate| rate.abs_diff(source))
    .unwrap_or(48000)
}

fn audio_encoder_bitrate_limits(codec: &str, sample_rate: u32, channels: u32) -> (u32, u32) {
    if codec != "libvorbis" {
        return (8, if codec == "libmp3lame" { 320 } else { 256 });
    }
    let rate = vorbis_sample_rate(sample_rate);
    let channels = channels.max(1);
    let minimum = if rate <= 8000 {
        8 * channels
    } else if rate <= 24000 {
        16 * channels
    } else if channels == 1 {
        32
    } else {
        24 * channels
    };
    let per_channel_maximum = if rate <= 8000 {
        32
    } else if rate <= 12000 {
        48
    } else if rate <= 16000 {
        96
    } else if rate <= 24000 {
        64
    } else if rate <= 32000 {
        160
    } else {
        192
    };
    (
        minimum,
        (per_channel_maximum * channels).min(256).max(minimum),
    )
}

fn audio_encoder_sample_rate_args(codec: &str, sample_rate: u32) -> Vec<String> {
    if codec == "libvorbis" {
        vec!["-ar".into(), vorbis_sample_rate(sample_rate).to_string()]
    } else {
        vec![]
    }
}

fn audio_target_encoder_args(codec: &str) -> Vec<String> {
    match codec {
        "libmp3lame" => vec!["-abr".into(), "1".into()],
        "libopus" => vec!["-vbr".into(), "constrained".into()],
        _ => vec![],
    }
}

/// The same encoder configuration is used for quality, custom bitrates and size attempts.
/// Lossless formats ignore bitrate; Vorbis bitrate limits and resampling apply in every mode.
fn audio_output_encoding_args(
    codec: &str,
    sample_rate: u32,
    channels: u32,
    bitrate: Option<u32>,
    target_size: bool,
) -> Vec<String> {
    let mut args = vec!["-c:a".into(), codec.into()];
    if !matches!(codec, "flac" | "alac" | "pcm_s16le") {
        let bitrate = if codec == "libvorbis" {
            let (minimum, maximum) = audio_encoder_bitrate_limits(codec, sample_rate, channels);
            Some(bitrate.unwrap_or(128).clamp(minimum, maximum))
        } else if codec == "libopus" {
            bitrate.map(|value| value.clamp(6, 256 * channels.max(1)))
        } else {
            bitrate
        };
        if let Some(bitrate) = bitrate {
            args.extend(["-b:a".into(), format!("{}k", bitrate)]);
        }
    }
    args.extend(audio_encoder_sample_rate_args(codec, sample_rate));
    if codec == "libopus" && channels > 2 {
        args.extend(["-mapping_family".into(), "1".into()]);
    }
    if target_size {
        args.extend(audio_target_encoder_args(codec));
    }
    args
}

/// Change only the audio bitrate; every retry still reads the original source.
fn with_audio_bitrate(args: &[String], bitrate: u32) -> Vec<String> {
    let mut next = args.to_vec();
    if let Some(index) = next.iter().position(|arg| arg == "-b:a") {
        if let Some(value) = next.get_mut(index + 1) {
            *value = format!("{}k", bitrate);
        }
    }
    next
}

/// An encode for a target size: where it ran, its bitrate (kbit/s) & the size it came out
struct SizeSample {
    on_graphics_card: bool,
    bitrate: u32,
    size: u64,
}

/// The bitrate (kbit/s) of the next encode for a target size, from the earlier encodes on the same
/// encoder (the CPU keeps to a bitrate, while a graphics card often keeps well below it):
/// - none yet (e.g. retrying on the CPU after the graphics card): the bitrate planned for the size
/// - one under & one over the size: between them, where the size is aimed for
/// - otherwise: along the line through the last two, or in proportion to the last one
fn next_target_bitrate(
    samples: &[SizeSample],
    on_graphics_card: bool,
    planned_bitrate: u32,
    target_size: u64,
) -> u32 {
    let same: Vec<&SizeSample> = samples
        .iter()
        .filter(|sample| sample.on_graphics_card == on_graphics_card && sample.size > 0)
        .collect();
    let Some(last) = same.last() else {
        return planned_bitrate;
    };
    let goal = target_size as f64 * TARGET_SIZE_AIM;
    let under = same
        .iter()
        .filter(|sample| sample.size <= target_size)
        .max_by_key(|sample| sample.size);
    let over = same
        .iter()
        .filter(|sample| sample.size > target_size)
        .min_by_key(|sample| sample.size);

    let next = match (under, over) {
        (Some(under), Some(over)) if over.bitrate > under.bitrate => {
            let part = ((goal - under.size as f64) / (over.size as f64 - under.size as f64))
                .clamp(0.1, 0.9);
            under.bitrate as f64 + part * (over.bitrate - under.bitrate) as f64
        }
        _ => {
            let proportional = last.bitrate as f64 * goal / last.size as f64;
            let along_line = same
                .len()
                .checked_sub(2)
                .map(|index| same[index])
                .filter(|previous| previous.bitrate != last.bitrate)
                .map(|previous| {
                    let slope = (last.size as f64 - previous.size as f64)
                        / (last.bitrate as f64 - previous.bitrate as f64);
                    (slope, last.bitrate as f64 + (goal - last.size as f64) / slope)
                })
                .filter(|(slope, _)| slope.is_finite() && *slope > 0.0)
                .map(|(_, bitrate)| bitrate);
            along_line.unwrap_or(proportional).clamp(
                last.bitrate as f64 / MAX_TARGET_SIZE_CHANGE,
                last.bitrate as f64 * MAX_TARGET_SIZE_CHANGE,
            )
        }
    };
    let mut next = next.floor().max(1.0) as u32;
    // Never the same bitrate again (it would come out the same)
    if same.iter().any(|sample| sample.bitrate == next) {
        let factor = if last.size > target_size { 0.93 } else { 1.05 };
        next = ((next as f64) * factor).floor().max(1.0) as u32;
    }
    next
}

/// Combines transforms (crop, rotate, flip) + scale (dimensions) + padding
pub fn build_ffmpeg_filters(
    transform_history: Option<&MediaTransformHistory>,
    dimensions: Option<(f64, f64)>,
) -> String {
    let mut filters = build_transform_filters(transform_history, dimensions);

    // Video encoders (e.g. yuv420p) require even dimensions
    filters.push("pad=ceil(iw/2)*2:ceil(ih/2)*2".to_string());

    filters.join(",")
}

/// Crop, rotate, flip and scale filters, without any encoder-specific padding
pub fn build_transform_filters(
    transform_history: Option<&MediaTransformHistory>,
    dimensions: Option<(f64, f64)>,
) -> Vec<String> {
    let mut filters: Vec<String> = Vec::new();
    let mut latest_crop: Option<&MediaTransformCrop> = None;

    if let Some(actions) = transform_history {
        for action in actions {
            match action {
                MediaTransform::Rotate { value } => {
                    let angle = *value;
                    match angle % 360 {
                        -90 | 270 => filters.push("transpose=2".to_string()),
                        90 | -270 => filters.push("transpose=1".to_string()),
                        180 | -180 => filters.push("hflip,vflip".to_string()),
                        _ => {}
                    }
                }
                MediaTransform::Flip { value } => {
                    if value.horizontal {
                        filters.push("hflip".to_string());
                    }
                    if value.vertical {
                        filters.push("vflip".to_string());
                    }
                }
                MediaTransform::Crop { value } => {
                    latest_crop = Some(value);
                }
            }
        }
    }

    // Apply only the last crop
    if let Some(c) = latest_crop {
        let w = c.width.round() as i64;
        let h = c.height.round() as i64;
        let x = c.left.round() as i64;
        let y = c.top.round() as i64;

        filters.push(format!("crop={}:{}:{}:{}", w, h, x, y));
    }

    if let Some((width, height)) = dimensions {
        let w = width.round() as i64;
        let h = height.round() as i64;
        filters.push(format!("scale={}:{}:flags=lanczos", w, h));
    }

    filters
}

#[cfg(test)]
mod audio_target_size_tests {
    use super::*;

    #[test]
    fn audio_retry_preserves_format_codec_and_filters() {
        let args: Vec<String> = [
            "-i",
            "original.wav",
            "-b:a",
            "128k",
            "-c:a",
            "aac",
            "-filter:a:0",
            "atempo=2",
            "output.m4a",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let retry = with_audio_bitrate(&args, 96);
        assert_eq!(retry[3], "96k");
        for index in [0, 1, 2, 4, 5, 6, 7, 8] {
            assert_eq!(retry[index], args[index]);
        }
        assert!(!retry.iter().any(|arg| arg.starts_with("-b:v")));
    }

    #[test]
    fn oversize_audio_retries_below_100_kbps() {
        let samples = [SizeSample {
            on_graphics_card: false,
            bitrate: 64,
            size: 110_000,
        }];
        let next = next_target_bitrate(&samples, false, 64, 100_000);
        assert!(next < 64 && next >= 8);
        assert_eq!(
            audio_encoder_bitrate_limits("libmp3lame", 48000, 2),
            (8, 320)
        );
        assert_eq!(
            audio_encoder_bitrate_limits("libvorbis", 48000, 2),
            (48, 256)
        );
    }

    /// Uses the shipped encoder and retry calculation, with trim and speed filters preserved.
    #[test]
    fn bundled_audio_encoders_reach_target_without_changing_format() {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let ffmpeg = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join(format!(
                "compresso_ffmpeg-{}{}",
                env!("COMPRESSO_TARGET"),
                suffix
            ));
        let ffprobe = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join(format!(
                "compresso_ffprobe-{}{}",
                env!("COMPRESSO_TARGET"),
                suffix
            ));
        struct Work(PathBuf);
        impl Drop for Work {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let work = Work(std::env::temp_dir().join(format!("compresso-audio-size-{}", nanoid!())));
        std::fs::create_dir_all(&work.0).unwrap();
        for (format, selected_codec, expected_codec, sample_rate, channels) in [
            ("mp3", "libmp3lame", "mp3", 48000, 2),
            ("m4a", "aac", "aac", 48000, 2),
            ("ogg", "libvorbis", "vorbis", 48000, 2),
            ("opus", "libopus", "opus", 48000, 2),
            ("ogg", "libopus", "opus", 48000, 2),
            ("ogg", "libvorbis", "vorbis", 192000, 1),
            ("ogg", "libvorbis", "vorbis", 8000, 2),
            ("ogg", "libvorbis", "vorbis", 22050, 1),
            ("ogg", "libvorbis", "vorbis", 44100, 1),
        ] {
            let output = work.0.join(format!("audio.{format}"));
            let mut samples = Vec::new();
            // Force an oversized first attempt to exercise real measured-size retries.
            let (minimum, maximum) =
                audio_encoder_bitrate_limits(selected_codec, sample_rate, channels);
            let mut bitrate =
                (if sample_rate == 192000 { 256 } else { 160 }).clamp(minimum, maximum);
            let input =
                format!("anoisesrc=color=pink:seed=42:duration=30:sample_rate={sample_rate}");
            let channel_count = channels.to_string();
            let limit = 90_000;
            let mut fitted = false;
            for _ in 0..=MAX_TARGET_SIZE_RETRIES {
                let args: Vec<String> = [
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    input.as_str(),
                    "-ac",
                    channel_count.as_str(),
                    "-af",
                    "atrim=start=5:end=25,asetpts=PTS-STARTPTS,atempo=2",
                ]
                .into_iter()
                .map(String::from)
                .collect();
                let mut args = args;
                args.extend(audio_output_encoding_args(
                    selected_codec,
                    sample_rate,
                    channels,
                    Some(bitrate),
                    true,
                ));
                let result = std::process::Command::new(&ffmpeg)
                    .args(args)
                    .arg(&output)
                    .output()
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{format}: {}",
                    String::from_utf8_lossy(&result.stderr)
                );
                let size = std::fs::metadata(&output).unwrap().len();
                samples.push(SizeSample {
                    on_graphics_card: false,
                    bitrate,
                    size,
                });
                if size <= limit {
                    fitted = true;
                    break;
                }
                bitrate = next_target_bitrate(&samples, false, 66, limit).clamp(minimum, maximum);
            }
            assert!(fitted, "{format}/{selected_codec}: no output within target");
            let probe = std::process::Command::new(&ffprobe)
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_name,channels,sample_rate:format=duration",
                    "-of",
                    "json",
                ])
                .arg(&output)
                .output()
                .unwrap();
            assert!(probe.status.success());
            let info: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
            assert_eq!(info["streams"][0]["codec_name"], expected_codec);
            assert_eq!(info["streams"][0]["channels"], channels);
            if selected_codec == "libvorbis" {
                assert_eq!(
                    info["streams"][0]["sample_rate"],
                    vorbis_sample_rate(sample_rate).to_string()
                );
            }
            let duration: f64 = info["format"]["duration"]
                .as_str()
                .unwrap()
                .parse()
                .unwrap();
            assert!((duration - 10.0).abs() < 0.2, "duration was {duration}");
        }
    }

    #[test]
    fn audio_quality_and_target_encoder_compatibility_matrix() {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let tool = |name: &str| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("bin")
                .join(format!(
                    "compresso_{name}-{}{}",
                    env!("COMPRESSO_TARGET"),
                    suffix
                ))
        };
        struct Work(PathBuf);
        impl Drop for Work {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let work = Work(std::env::temp_dir().join(format!("compresso-audio-matrix-{}", nanoid!())));
        std::fs::create_dir_all(&work.0).unwrap();
        let mut failures = Vec::new();
        let mut cases = 0;
        for (format, codec, encoded_codec, lossy) in [
            ("mp3", "libmp3lame", "mp3", true),
            ("m4a", "aac", "aac", true),
            ("ogg", "libvorbis", "vorbis", true),
            ("opus", "libopus", "opus", true),
            ("ogg", "libopus", "opus", true),
            ("wav", "pcm_s16le", "pcm_s16le", false),
            ("flac", "flac", "flac", false),
            ("m4a", "alac", "alac", false),
            ("ogg", "flac", "flac", false),
        ] {
            for rate in [8000, 22050, 44100, 48000, 192000] {
                for (channels, layout) in [(1, "mono"), (2, "stereo"), (6, "5.1")] {
                    for target in [false, true] {
                        if target && !lossy {
                            continue;
                        }
                        for bitrate in [64, 128, 256, 320] {
                            cases += 1;
                            let output = work.0.join(format!("audio.{format}"));
                            let input = format!("anullsrc=r={rate}:cl={layout}");
                            let mut args: Vec<String> = [
                                "-v",
                                "error",
                                "-y",
                                "-f",
                                "lavfi",
                                "-i",
                                input.as_str(),
                                "-t",
                                "0.15",
                            ]
                            .into_iter()
                            .map(String::from)
                            .collect();
                            args.extend(audio_output_encoding_args(
                                codec,
                                rate,
                                channels,
                                Some(bitrate),
                                target,
                            ));
                            let result = std::process::Command::new(tool("ffmpeg"))
                                .args(args)
                                .arg(&output)
                                .output()
                                .unwrap();
                            let label = format!("{format}/{codec}, {rate} Hz, {channels} channels, {bitrate} kbps, target={target}");
                            if !result.status.success() {
                                failures.push(format!(
                                    "{label}: {}",
                                    String::from_utf8_lossy(&result.stderr)
                                ));
                                continue;
                            }
                            let probe = std::process::Command::new(tool("ffprobe"))
                                .args([
                                    "-v",
                                    "error",
                                    "-show_entries",
                                    "stream=codec_name,channels",
                                    "-of",
                                    "json",
                                ])
                                .arg(&output)
                                .output()
                                .unwrap();
                            let info: serde_json::Value =
                                serde_json::from_slice(&probe.stdout).unwrap();
                            assert_eq!(info["streams"][0]["codec_name"], encoded_codec, "{label}");
                            let expected_channels = if codec == "libmp3lame" {
                                channels.min(2)
                            } else {
                                channels
                            };
                            assert_eq!(
                                info["streams"][0]["channels"], expected_channels,
                                "{label}"
                            );
                        }
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "{} failures in {cases} cases:\n{}",
            failures.len(),
            failures.join("\n")
        );
        eprintln!("Validated {cases} quality/target encoder combinations.");
    }

    #[test]
    fn target_encoders_stay_inside_selected_containers() {
        for (format, codec) in [
            ("mp3", "libmp3lame"),
            ("m4a", "aac"),
            ("ogg", "libvorbis"),
            ("opus", "libopus"),
        ] {
            assert_eq!(audio_output_codec(format, None), codec);
        }
        assert_eq!(audio_target_encoder_args("libmp3lame"), ["-abr", "1"]);
        assert_eq!(
            audio_target_encoder_args("libopus"),
            ["-vbr", "constrained"]
        );
    }
}
