// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lib::domain::FileMetadata;
use lib::fs as file_system;
use lib::{domain::CompressionResult, ffmpeg};

#[tauri::command]
async fn compress_video(
    app: tauri::AppHandle,
    video_path: &str,
    convert_to_extension: &str,
    preset_name: &str,
) -> Result<CompressionResult, String> {
    let ffmpeg = ffmpeg::FFMPEG::new(&app)?;
    return match ffmpeg
        .compress_video(video_path, convert_to_extension, preset_name)
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
) -> Result<String, String> {
    let ffmpeg = ffmpeg::FFMPEG::new(&app)?;
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

fn main() {
    tauri::Builder::default()
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
            get_file_metadata,
            get_image_dimension
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
