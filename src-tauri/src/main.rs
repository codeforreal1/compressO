// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lib::{domain::CompressionResult, ffmpeg};

#[tauri::command]
async fn compress(path: &str) -> Result<CompressionResult, String> {
    println!("[info] File received {:?}", path);
    return match ffmpeg::compress(path).await {
        Ok(result) => Ok(result),
        Err(err) => Err(err),
    };
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![compress])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
