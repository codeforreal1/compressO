use crate::core::domain::{
    AudioStream, Chapter, ContainerInfo, Disposition, SubtitleStream, VideoInfo, VideoStream,
};
use crate::core::image_dynamic_range::DynamicRange;
use crate::core::media_process::MediaProcessExecutorBuilder;
use crate::core::video_dynamic_range::{
    self, Operation as DynamicRangeOperation, VideoColor, VideoDynamicRangeInfo,
};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;
use std::process::Command;
use tauri::AppHandle;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoImportProbe {
    pub basic_info: VideoInfo,
    pub audio_streams: Vec<AudioStream>,
    pub dynamic_range: VideoDynamicRangeInfo,
    pub has_picture: bool,
    #[serde(skip_serializing)]
    pub thumbnail_hdr_to_sdr_filter: Option<String>,
}

pub struct FFPROBE {
    app: AppHandle,
    owner_window: Option<String>,
}

impl FFPROBE {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self {
            app: app.to_owned(),
            owner_window: None,
        })
    }

    /// Window the processes belong to (`None` by default, i.e. detached/headless), see `MediaProcessExecutorBuilder`
    pub fn with_owner_window(mut self, label: &str) -> Self {
        self.owner_window = Some(label.to_string());
        self
    }

    pub fn with_owner_window_opt(mut self, label: Option<&str>) -> Self {
        self.owner_window = label.map(str::to_string);
        self
    }

    pub fn get_ffprobe_command(&self) -> Result<Command, String> {
        super::tool_bundle::command(&self.app, "ffprobe")
            .map_err(|e| format!("Failed to create ffprobe command: {}", e))
    }

    /// Gets video basic information (duration, dimensions, fps) using ffprobe JSON output
    pub async fn get_video_basic_info(&mut self, video_path: &str) -> Result<VideoInfo, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exist in given path."));
        }

        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            // `V` excludes attached pictures, which some MP4s (e.g. from X/Twitter) carry as a
            // 0×0 MJPEG stream. Selecting `v:0` picked that cover art instead of the video and
            // left the preview without dimensions.
            "-select_streams",
            "V:0",
            "-show_entries",
            "stream=width,height,r_frame_rate,avg_frame_rate",
            "-show_entries",
            "stream_tags=rotate:stream_side_data=rotation",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            video_path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Video file is corrupted".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        Ok(parse_video_info(
            &json,
            json.get("streams").and_then(|s| s.as_array()).and_then(|s| s.first()),
        ))
    }

    /// Probes duration, non-attached video metadata, dynamic range, audio streams, and picture
    /// presence in a single ffprobe invocation for fast media import.
    pub async fn inspect_video_import(&mut self, video_path: &str) -> Result<VideoImportProbe, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exist in given path."));
        }

        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_name,codec_long_name,codec_type,profile,width,height,r_frame_rate,avg_frame_rate,pix_fmt,color_space,color_range,color_primaries,color_transfer,channels,channel_layout,sample_rate,sample_fmt,bits_per_sample,bit_rate,duration:stream_tags=rotate,language,title:stream_side_data=rotation,dv_profile:stream_disposition=attached_pic",
            "-of",
            "json",
            video_path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Video file is corrupted".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        Ok(parse_video_import_probe(&json))
    }

    // Get all video streams from the source video
    pub async fn get_video_streams(&mut self, path: &str) -> Result<Vec<VideoStream>, String> {
        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            "-select_streams",
            "v",
            "-show_entries",
            "stream=codec_name,codec_long_name,profile,codec_type,width,height,coded_width,coded_height,r_frame_rate,avg_frame_rate,pix_fmt,color_space,color_range,color_primaries,color_transfer,chroma_location,bit_rate,duration,nb_frames,refs,field_order,time_base,tags,gop_size,level",
            "-of",
            "json",
            path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Failed to get video streams".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let streams = if let Some(streams_array) = json.get("streams").and_then(|s| s.as_array()) {
            let mut result = Vec::new();
            for stream in streams_array {
                // Basic codec info
                let codec = stream
                    .get("codec_name")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                let codec_long_name = stream
                    .get("codec_long_name")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                let profile = stream
                    .get("profile")
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .to_string();

                let codec_type = stream
                    .get("codec_type")
                    .and_then(|c| c.as_str())
                    .unwrap_or("video")
                    .to_string();

                // Dimensions
                let width = stream.get("width").and_then(|w| w.as_u64()).unwrap_or(0) as u32;

                let height = stream.get("height").and_then(|h| h.as_u64()).unwrap_or(0) as u32;

                let coded_width = stream
                    .get("coded_width")
                    .and_then(|w| w.as_u64())
                    .unwrap_or(0) as u32;

                let coded_height = stream
                    .get("coded_height")
                    .and_then(|h| h.as_u64())
                    .unwrap_or(0) as u32;

                // Frame rate
                let r_frame_rate = stream
                    .get("r_frame_rate")
                    .and_then(|r| r.as_str())
                    .unwrap_or("0/0")
                    .to_string();

                let avg_frame_rate = stream
                    .get("avg_frame_rate")
                    .and_then(|a| a.as_str())
                    .unwrap_or("0/0")
                    .to_string();

                // Pixel format and color
                let pix_fmt = stream
                    .get("pix_fmt")
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .to_string();

                let color_space = stream
                    .get("color_space")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());

                let color_range = stream
                    .get("color_range")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());

                let color_primaries = stream
                    .get("color_primaries")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());

                let color_transfer = stream
                    .get("color_transfer")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());

                let chroma_location = stream
                    .get("chroma_location")
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());

                // Bitrate and duration
                let bit_rate = stream
                    .get("bit_rate")
                    .and_then(|b| b.as_str())
                    .map(|s| s.to_string());

                let duration = stream
                    .get("duration")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string());

                // Frame info
                let nb_frames = stream
                    .get("nb_frames")
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string());

                let refs = stream
                    .get("refs")
                    .and_then(|r| r.as_u64())
                    .and_then(|r| u32::try_from(r).ok());

                // Bitstream/codec-specific info
                let gop_size = stream
                    .get("gop_size")
                    .and_then(|g| g.as_u64())
                    .and_then(|g| u32::try_from(g).ok());

                let level = stream
                    .get("level")
                    .and_then(|l| l.as_i64())
                    .and_then(|l| u32::try_from(l).ok());

                // Other
                let field_order = stream
                    .get("field_order")
                    .and_then(|f| f.as_str())
                    .unwrap_or("progressive")
                    .to_string();

                let time_base = stream
                    .get("time_base")
                    .and_then(|t| t.as_str())
                    .unwrap_or("0/0")
                    .to_string();

                // Rotation metadata (from tags)
                let rotation = if let Some(tags_obj) = stream.get("tags") {
                    tags_obj
                        .get("rotate")
                        .and_then(|r| r.as_str())
                        .and_then(|r| r.parse::<f64>().ok())
                } else {
                    None
                };

                result.push(VideoStream {
                    codec,
                    codec_long_name,
                    profile,
                    codec_type,
                    width,
                    height,
                    coded_width,
                    coded_height,
                    r_frame_rate,
                    avg_frame_rate,
                    pix_fmt,
                    color_space,
                    color_range,
                    color_primaries,
                    color_transfer,
                    chroma_location,
                    bit_rate,
                    duration,
                    nb_frames,
                    refs,
                    gop_size,
                    level,
                    field_order,
                    time_base,
                    rotation,
                });
            }
            result
        } else {
            Vec::new()
        };

        Ok(streams)
    }

    /// The colour of the first video stream (the one compressed), with its Dolby Vision profile;
    /// `None` without a video stream (see `video_dynamic_range`)
    pub async fn get_video_color(&mut self, path: &str) -> Result<Option<VideoColor>, String> {
        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=pix_fmt,height,color_transfer,color_primaries,color_space,color_range:stream_side_data=dv_profile",
            "-of",
            "json",
            path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;
        let output = executor.spawn_and_wait_with_output().await?;
        if !output.success() {
            return Err("Failed to get the video's colour".to_string());
        }
        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;
        Ok(json
            .get("streams")
            .and_then(|streams| streams.as_array())
            .and_then(|streams| streams.first())
            .map(video_color))
    }

    /// Get container-level format information
    pub async fn get_container_info(&mut self, path: &str) -> Result<ContainerInfo, String> {
        if !Path::exists(Path::new(path)) {
            return Err(String::from("File does not exist in given path."));
        }

        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v", "error",
            "-show_entries",
            "format=filename,format_name,format_long_name,duration,size,bit_rate,nb_streams:format_tags",
            "-of", "json",
            path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Failed to get format info".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let format = json.get("format").ok_or("Failed to parse format info")?;

        let filename = format
            .get("filename")
            .and_then(|f| f.as_str())
            .unwrap_or("")
            .to_string();

        let format_name = format
            .get("format_name")
            .and_then(|f| f.as_str())
            .unwrap_or("")
            .to_string();

        let format_long_name = format
            .get("format_long_name")
            .and_then(|f| f.as_str())
            .unwrap_or("")
            .to_string();

        let duration = format
            .get("duration")
            .and_then(|d| d.as_str())
            .and_then(|s| s.parse::<f64>().ok());

        let size = format
            .get("size")
            .and_then(|s| s.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);

        let bit_rate = format
            .get("bit_rate")
            .and_then(|b| b.as_str())
            .and_then(|b| b.parse::<u64>().ok());

        let nb_streams = format
            .get("nb_streams")
            .and_then(|n| n.as_str())
            .and_then(|n| n.parse::<u32>().ok())
            .unwrap_or(0);

        let tags = if let Some(tags_obj) = format.get("tags") {
            if let Some(tags_map) = tags_obj.as_object() {
                let mut tags_vec = Vec::new();
                for (key, value) in tags_map.iter() {
                    if let Some(val_str) = value.as_str() {
                        tags_vec.push((key.clone(), val_str.to_string()));
                    }
                }
                Some(tags_vec)
            } else {
                None
            }
        } else {
            None
        };

        Ok(ContainerInfo {
            filename,
            format_name,
            format_long_name,
            duration,
            size,
            bit_rate,
            nb_streams,
            tags,
        })
    }

    // Get all audio streams from the media
    pub async fn get_audio_streams(&mut self, path: &str) -> Result<Vec<AudioStream>, String> {
        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_name,codec_long_name,codec_type,profile,channels,channel_layout,sample_rate,sample_fmt,bits_per_sample,bit_rate,duration:stream_tags=language,title",
            "-of",
            "json",
            path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Failed to get audio streams".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let streams = if let Some(streams_array) = json.get("streams").and_then(|s| s.as_array()) {
            streams_array.iter().map(parse_audio_stream).collect()
        } else {
            Vec::new()
        };

        Ok(streams)
    }

    /// Get all subtitle streams from the media
    pub async fn get_subtitle_streams(
        &mut self,
        path: &str,
    ) -> Result<Vec<SubtitleStream>, String> {
        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            "-select_streams",
            "s",
            "-show_entries",
            "stream=index,codec_name,codec_long_name,codec_type:stream_tags:stream_disposition",
            "-of",
            "json",
            path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Failed to get subtitle streams".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let streams = if let Some(streams_array) = json.get("streams").and_then(|s| s.as_array()) {
            let mut result = Vec::new();
            for stream in streams_array {
                let index = stream.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as u32;

                let codec = stream
                    .get("codec_name")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                let codec_long_name = stream
                    .get("codec_long_name")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                let codec_type = stream
                    .get("codec_type")
                    .and_then(|c| c.as_str())
                    .unwrap_or("subtitle")
                    .to_string();

                // Extract tags (language, title, etc.)
                let (language, title) = if let Some(tags_obj) = stream.get("tags") {
                    let lang = tags_obj
                        .get("language")
                        .and_then(|l| l.as_str())
                        .map(|s| s.to_string());
                    let title_tag = tags_obj
                        .get("title")
                        .and_then(|t| t.as_str())
                        .map(|s| s.to_string());
                    (lang, title_tag)
                } else {
                    (None, None)
                };

                // Extract disposition
                let disposition = if let Some(disposition_obj) = stream.get("disposition") {
                    Disposition {
                        default: disposition_obj
                            .get("default")
                            .and_then(|d| d.as_i64())
                            .unwrap_or(0)
                            != 0,
                        forced: disposition_obj
                            .get("forced")
                            .and_then(|f| f.as_i64())
                            .unwrap_or(0)
                            != 0,
                        attached_pic: disposition_obj
                            .get("attached_pic")
                            .and_then(|a| a.as_i64())
                            .unwrap_or(0)
                            != 0,
                        comment: disposition_obj
                            .get("comment")
                            .and_then(|c| c.as_i64())
                            .unwrap_or(0)
                            != 0,
                        karaoke: disposition_obj
                            .get("karaoke")
                            .and_then(|k| k.as_i64())
                            .unwrap_or(0)
                            != 0,
                        lyrics: disposition_obj
                            .get("lyrics")
                            .and_then(|l| l.as_i64())
                            .unwrap_or(0)
                            != 0,
                    }
                } else {
                    Disposition::default()
                };

                result.push(SubtitleStream {
                    index,
                    codec,
                    codec_long_name,
                    codec_type,
                    language,
                    title,
                    disposition,
                });
            }
            result
        } else {
            Vec::new()
        };

        Ok(streams)
    }

    /// Get all chapters from the media
    pub async fn get_chapters(&mut self, path: &str) -> Result<Vec<Chapter>, String> {
        let mut ffprobe_cmd = self.get_ffprobe_command()?;
        ffprobe_cmd.args([
            "-v",
            "error",
            "-show_entries",
            "chapter=id,time_base,start,end,title",
            "-of",
            "json",
            path,
        ]);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window_opt(self.owner_window.as_deref())
            .command(ffprobe_cmd)
            .build()?;

        let output = executor.spawn_and_wait_with_output().await?;

        if !output.success() {
            return Err("Failed to get chapters".to_string());
        }

        let json: Value = serde_json::from_str(&output.stdout)
            .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

        let chapters = if let Some(chapters_array) = json.get("chapters").and_then(|c| c.as_array())
        {
            let mut result = Vec::new();
            for chapter in chapters_array {
                let id = chapter.get("id").and_then(|i| i.as_u64()).unwrap_or(0);

                let time_base = chapter
                    .get("time_base")
                    .and_then(|t| t.as_str())
                    .unwrap_or("")
                    .to_string();

                let start = chapter.get("start").and_then(|s| s.as_f64()).unwrap_or(0.0) / 1000.0;

                let end = chapter.get("end").and_then(|e| e.as_f64()).unwrap_or(0.0) / 1000.0;

                let title = chapter
                    .get("title")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());

                result.push(Chapter {
                    id,
                    time_base,
                    start,
                    end,
                    title,
                });
            }
            result
        } else {
            Vec::new()
        };

        Ok(chapters)
    }
}

/// Helper function to parse fraction strings like "30000/1001" or "30/1"
fn parse_fraction(fraction: &str) -> Option<(u64, u64)> {
    let parts: Vec<&str> = fraction.split('/').collect();
    if parts.len() == 2 {
        let num = parts[0].parse::<u64>().ok()?;
        let den = parts[1].parse::<u64>().ok()?;
        Some((num, den))
    } else {
        None
    }
}

/// Rotation of a video stream in degrees, from its display matrix (side data) or the older `rotate`
/// tag
fn get_stream_rotation(stream: &Value) -> Option<f64> {
    stream
        .get("side_data_list")
        .and_then(|list| list.as_array())
        .and_then(|list| {
            list.iter()
                .find_map(|side_data| side_data.get("rotation").and_then(|r| r.as_f64()))
        })
        .or_else(|| {
            stream
                .get("tags")
                .and_then(|tags| tags.get("rotate"))
                .and_then(|r| r.as_str())
                .and_then(|r| r.parse::<f64>().ok())
        })
}

/// Whether a rotation swaps the width & height (90° or 270°)
fn is_quarter_turn(rotation: Option<f64>) -> bool {
    rotation.is_some_and(|r| (r.round() as i64).rem_euclid(180) == 90)
}

/// A video stream's colour from ffprobe's JSON (see `get_video_color`)
fn video_color(stream: &Value) -> VideoColor {
    let text = |key: &str| {
        stream
            .get(key)
            .and_then(|value| value.as_str())
            .map(str::to_string)
    };
    VideoColor {
        pix_fmt: text("pix_fmt").unwrap_or_default(),
        transfer: text("color_transfer"),
        primaries: text("color_primaries"),
        matrix: text("color_space"),
        range: text("color_range"),
        height: stream.get("height").and_then(|h| h.as_u64()).unwrap_or(0) as u32,
        dolby_vision_profile: stream
            .get("side_data_list")
            .and_then(|list| list.as_array())
            .and_then(|list| {
                list.iter()
                    .find_map(|side_data| side_data.get("dv_profile").and_then(|p| p.as_u64()))
            })
            .map(|profile| profile as u32),
    }
}

fn parse_video_info(json: &Value, video_stream: Option<&Value>) -> VideoInfo {
    let duration = json
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(|dur| dur.as_str())
        .and_then(|dur| dur.parse::<f64>().ok());

    let mut dimensions: Option<(f64, f64)> = None;
    let mut fps: Option<f32> = None;

    if let Some(stream) = video_stream {
        if let (Some(w), Some(h)) = (
            stream.get("width").and_then(|v| v.as_u64()),
            stream.get("height").and_then(|v| v.as_u64()),
        ) {
            if w > 0 && h > 0 {
                dimensions = Some(if is_quarter_turn(get_stream_rotation(stream)) {
                    (h as f64, w as f64)
                } else {
                    (w as f64, h as f64)
                });
            }
        }

        if let Some(r_frame_rate) = stream.get("r_frame_rate").and_then(|v| v.as_str()) {
            if let Some((num, den)) = parse_fraction(r_frame_rate) {
                if den > 0 {
                    fps = Some(num as f32 / den as f32);
                }
            }
        }
        if fps.is_none() {
            if let Some(avg_frame_rate) = stream.get("avg_frame_rate").and_then(|v| v.as_str()) {
                if let Some((num, den)) = parse_fraction(avg_frame_rate) {
                    if den > 0 {
                        fps = Some(num as f32 / den as f32);
                    }
                }
            }
        }
    }

    VideoInfo {
        duration,
        dimensions,
        fps,
    }
}

fn parse_audio_stream(stream: &Value) -> AudioStream {
    let codec = stream
        .get("codec_name")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let codec_long_name = stream
        .get("codec_long_name")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let codec_type = stream
        .get("codec_type")
        .and_then(|c| c.as_str())
        .unwrap_or("audio")
        .to_string();
    let profile = stream
        .get("profile")
        .and_then(|p| p.as_str())
        .map(|s| s.to_string());
    let channels = stream
        .get("channels")
        .and_then(|c| c.as_u64())
        .unwrap_or(0)
        .to_string();
    let channel_layout = stream
        .get("channel_layout")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();
    let sample_rate = stream
        .get("sample_rate")
        .and_then(|s| s.as_str())
        .unwrap_or("0")
        .to_string();
    let sample_fmt = stream
        .get("sample_fmt")
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());
    let bits_per_sample = stream
        .get("bits_per_sample")
        .and_then(|b| b.as_u64())
        .and_then(|b| u32::try_from(b).ok());
    let bit_rate = stream
        .get("bit_rate")
        .and_then(|b| b.as_str())
        .map(|s| s.to_string());
    let duration = stream
        .get("duration")
        .and_then(|d| d.as_str())
        .map(|s| s.to_string());
    let language = stream
        .get("tags")
        .and_then(|t| t.get("language"))
        .and_then(|l| l.as_str())
        .map(|s| s.to_string());
    let tags = stream
        .get("tags")
        .and_then(|tags_obj| tags_obj.as_object())
        .map(|tags_map| {
            tags_map
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|val_str| (key.clone(), val_str.to_string()))
                })
                .collect()
        });

    AudioStream {
        codec,
        codec_long_name,
        codec_type,
        profile,
        channels,
        channel_layout,
        sample_rate,
        sample_fmt,
        bits_per_sample,
        bit_rate,
        duration,
        language,
        tags,
    }
}

fn is_attached_picture(stream: &Value) -> bool {
    stream
        .get("disposition")
        .and_then(|d| d.get("attached_pic"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        != 0
}

pub fn parse_video_import_probe(json: &Value) -> VideoImportProbe {
    let streams = json
        .get("streams")
        .and_then(|s| s.as_array())
        .map(|s| s.as_slice())
        .unwrap_or(&[]);

    // Skip attached cover-art streams (`V:0` semantics) for dimensions, fps, and HDR metadata,
    // while keeping any video stream (including cover art) for `has_picture`.
    let first_picture_stream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("video"));
    let main_video_stream = streams.iter().find(|s| {
        s.get("codec_type").and_then(|t| t.as_str()) == Some("video") && !is_attached_picture(s)
    });

    let basic_info = parse_video_info(json, main_video_stream);
    let audio_streams = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("audio"))
        .map(parse_audio_stream)
        .collect();

    let dynamic_range = match main_video_stream.map(video_color) {
        Some(color) => video_dynamic_range::classify(&color),
        None => VideoDynamicRangeInfo {
            dynamic_range: DynamicRange::Unknown,
            format: None,
        },
    };
    let thumbnail_hdr_to_sdr_filter = first_picture_stream
        .map(video_color)
        .filter(|color| video_dynamic_range::classify(color).dynamic_range == DynamicRange::Hdr)
        .and_then(|color| video_dynamic_range::filter(DynamicRangeOperation::ToSdr, &color));

    VideoImportProbe {
        basic_info,
        audio_streams,
        dynamic_range,
        has_picture: first_picture_stream.is_some(),
        thumbnail_hdr_to_sdr_filter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn import_probe_skips_attached_picture_for_video_info_but_keeps_has_picture() {
        let probe = json!({
            "format": { "duration": "12.5" },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "mjpeg",
                    "width": 0,
                    "height": 0,
                    "disposition": { "attached_pic": 1 }
                },
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1080,
                    "height": 1920,
                    "r_frame_rate": "30/1",
                    "pix_fmt": "yuv420p",
                    "disposition": { "attached_pic": 0 }
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac",
                    "channels": 2,
                    "sample_rate": "48000"
                }
            ]
        });

        let parsed = parse_video_import_probe(&probe);
        assert!(parsed.has_picture);
        assert_eq!(parsed.basic_info.duration, Some(12.5));
        assert_eq!(parsed.basic_info.dimensions, Some((1080.0, 1920.0)));
        assert_eq!(parsed.basic_info.fps, Some(30.0));
        assert_eq!(parsed.audio_streams.len(), 1);
        assert_eq!(parsed.audio_streams[0].codec, "aac");
    }
}
