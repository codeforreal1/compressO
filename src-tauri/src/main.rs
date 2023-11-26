// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]


use tauri::api::path;

use libs::ffmpeg;
use libs::filesystem;

#[tauri::command]
async fn compress(path: &str) -> Result<String, String> {
    println!("File received");
    return match ffmpeg::compress(path).await {
        Ok(result) => Ok(result),
        Err(err) => Err(err),
    };
}

fn main() {
    println!("{:?}", path::cache_dir());
    filesystem::create_cache_dir().unwrap();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![compress])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
