use crate::{
    domain::{CompressionResult, VideoThumbnail},
    ffmpeg,
    fs::delete_stale_files,
};

#[tauri::command]
pub async fn compress_video(
    app: tauri::AppHandle,
    video_path: &str,
    convert_to_extension: &str,
    preset_name: Option<&str>,
    video_id: Option<&str>,
    should_mute_video: bool,
) -> Result<CompressionResult, String> {
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
            should_mute_video,
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
) -> Result<VideoThumbnail, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    ffmpeg.generate_video_thumbnail(video_path).await
}

#[tauri::command]
pub async fn get_video_duration(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<Option<String>, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    ffmpeg.get_video_duration(video_path).await
}
