// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lib::domain::{FileMetadata, VideoThumbnail};
use lib::fs::{self as file_system, delete_stale_files};
use lib::{domain::CompressionResult, ffmpeg};
use tauri_plugin_log::{Target as LogTarget, TargetKind as LogTargetKind};

#[tauri::command]
async fn compress_video(
    app: tauri::AppHandle,
    video_path: &str,
    convert_to_extension: &str,
    preset_name: &str,
    video_id: Option<&str>,
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
    return match ffmpeg
        .compress_video(video_path, convert_to_extension, preset_name, video_id)
        .await
    {
        Ok(result) => Ok(result),
        Err(err) => Err(err),
    };
}

#[tauri::command]
async fn generate_video_thumbnail(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<VideoThumbnail, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    return Ok(ffmpeg.generate_video_thumbnail(video_path).await?);
}

#[tauri::command]
async fn get_file_metadata(file_path: &str) -> Result<FileMetadata, String> {
    file_system::get_file_metadata(file_path)
}

#[tauri::command]
async fn get_image_dimension(image_path: &str) -> Result<(u32, u32), String> {
    file_system::get_image_dimension(image_path)
}

#[tauri::command]
async fn move_file(from: &str, to: &str) -> Result<(), String> {
    if let Err(err) = file_system::copy_file(from, to).await {
        return Err(err.to_string());
    }

    if let Err(err) = file_system::delete_file(from).await {
        return Err(err.to_string());
    }

    Ok(())
}

#[tauri::command]
async fn get_vide_duration(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<Option<String>, String> {
    let mut ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    ffmpeg.get_video_duration(video_path).await
}

#[cfg(debug_assertions)]
const LOG_TARGETS: [LogTarget; 1] = [LogTarget::new(LogTargetKind::Stdout)];

#[cfg(not(debug_assertions))]
const LOG_TARGETS: [LogTarget; 0] = [];

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets(LOG_TARGETS)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            file_system::setup_app_data_dir(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compress_video,
            generate_video_thumbnail,
            get_vide_duration,
            get_file_metadata,
            get_image_dimension,
            move_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
