use crate::core::{
    domain::{
        AudioConfig, BatchCompressionResult, MediaMetadataConfig, MediaTransformHistory,
        SubtitlesConfig, VideoCompressionConfig, VideoCompressionResult, VideoThumbnail,
        VideoTrimSegment,
    },
    ffmpeg::{self},
};
use crate::sys::fs::delete_stale_files;
use std::path::Path;

#[tauri::command]
pub async fn compress_video(
    app: tauri::AppHandle,
    video_path: &str,
    convert_to_extension: &str,
    preset_name: Option<&str>,
    video_id: &str,
    audio_config: AudioConfig,
    quality: u16,
    dimensions: Option<(f64, f64)>,
    fps: Option<&str>,
    video_codec: Option<&str>,
    transform_history: Option<MediaTransformHistory>,
    metadata_config: Option<MediaMetadataConfig>,
    custom_thumbnail_path: Option<&str>,
    trim_segments: Option<Vec<VideoTrimSegment>>,
    subtitles_config: Option<SubtitlesConfig>,
    strip_metadata: Option<bool>,
    speed: Option<f32>,
) -> Result<VideoCompressionResult, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    if let Ok(files) =
        delete_stale_files(ffmpeg.get_asset_dir().as_str(), 24 * 60 * 60 * 1000).await
    {
        log::debug!(
            "[main] Stale files deleted. Number of deleted files = {}",
            files.len()
        )
    };
    match ffmpeg
        .compress_video(
            video_path,
            convert_to_extension,
            preset_name,
            video_id,
            None,
            &audio_config,
            quality,
            dimensions,
            fps,
            video_codec,
            transform_history.as_ref(),
            strip_metadata,
            metadata_config.as_ref(),
            custom_thumbnail_path,
            trim_segments.as_ref(),
            subtitles_config.as_ref(),
            speed,
            None,
        )
        .await
    {
        Ok(result) => Ok(result),
        Err(err) => Err(err),
    }
}

#[tauri::command]
pub async fn generate_video_thumbnail(
    app: tauri::AppHandle,
    video_path: &str,
    timestamp: Option<&str>,
) -> Result<VideoThumbnail, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    ffmpeg.generate_video_thumbnail(video_path, timestamp).await
}

#[tauri::command]
pub async fn compress_videos_batch(
    app: tauri::AppHandle,
    batch_id: &str,
    videos: Vec<VideoCompressionConfig>,
) -> Result<BatchCompressionResult, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    if let Ok(files) =
        delete_stale_files(ffmpeg.get_asset_dir().as_str(), 24 * 60 * 60 * 1000).await
    {
        log::debug!(
            "[main] Stale files deleted. Number of deleted files = {}",
            files.len()
        )
    };
    ffmpeg
        .compress_videos_batch(batch_id, videos)
        .await
        .map(|result| Ok(result))
        .unwrap_or_else(|err| Err(err))
}

#[tauri::command]
pub async fn extract_subtitle(
    app: tauri::AppHandle,
    video_path: &str,
    stream_index: u32,
    output_path: &str,
    format: Option<&str>,
) -> Result<String, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;

    if !Path::new(video_path).exists() {
        return Err(String::from("Video file does not exist."));
    }

    let output_format = format.unwrap_or("srt");

    if !matches!(output_format, "srt" | "vtt") {
        return Err(format!(
            "Unsupported output format '{}'. Supported formats: srt, vtt",
            output_format
        ));
    }

    ffmpeg
        .extract_subtitle(video_path, stream_index, output_path, output_format)
        .await
}
