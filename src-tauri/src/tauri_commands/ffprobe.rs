use crate::core::{
    domain::{AudioStream, Chapter, ContainerInfo, SubtitleStream, VideoInfo, VideoStream},
    ffprobe,
    image_dynamic_range::DynamicRange,
    video_dynamic_range::{self, VideoDynamicRangeInfo},
};

#[tauri::command]
pub async fn get_video_basic_info(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    video_path: &str,
) -> Result<VideoInfo, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?.with_owner_window(window.label());
    ffprobe.get_video_basic_info(video_path).await
}

#[tauri::command]
pub async fn get_container_info(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<ContainerInfo, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?;
    ffprobe.get_container_info(video_path).await
}

#[tauri::command]
pub async fn get_video_streams(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<Vec<VideoStream>, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?;
    ffprobe.get_video_streams(video_path).await
}

#[tauri::command]
pub async fn get_audio_streams(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    video_path: &str,
) -> Result<Vec<AudioStream>, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?.with_owner_window(window.label());
    ffprobe.get_audio_streams(video_path).await
}

#[tauri::command]
pub async fn get_subtitle_streams(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<Vec<SubtitleStream>, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?;
    ffprobe.get_subtitle_streams(video_path).await
}

#[tauri::command]
pub async fn get_chapters(app: tauri::AppHandle, video_path: &str) -> Result<Vec<Chapter>, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?;
    ffprobe.get_chapters(video_path).await
}

/// Whether a video is SDR or HDR, for its HDR Boost / Remove HDR setting
#[tauri::command]
pub async fn get_video_dynamic_range(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    video_path: &str,
) -> Result<VideoDynamicRangeInfo, String> {
    let mut ffprobe = ffprobe::FFPROBE::new(&app)?.with_owner_window(window.label());
    Ok(match ffprobe.get_video_color(video_path).await? {
        Some(color) => video_dynamic_range::classify(&color),
        None => VideoDynamicRangeInfo {
            dynamic_range: DynamicRange::Unknown,
            format: None,
        },
    })
}
