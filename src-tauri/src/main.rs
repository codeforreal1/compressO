// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lib::fs::setup_app_data_dir;
use lib::{domain::CompressionResult, ffmpeg};

#[tauri::command]
async fn compress_video(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<CompressionResult, String> {
    let ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    return match ffmpeg.compress_video(video_path).await {
        Ok(result) => Ok(result),
        Err(err) => Err(err),
    };
}

#[tauri::command]
async fn generate_video_thumbnail(
    app: tauri::AppHandle,
    video_path: &str,
) -> Result<String, String> {
    let ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    return Ok(ffmpeg.generate_video_thumbnail(video_path).await?);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            setup_app_data_dir(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compress_video,
            generate_video_thumbnail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
