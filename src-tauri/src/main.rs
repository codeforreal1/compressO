// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]


use libs::ffmpeg;

#[tauri::command]
async fn compress(path: &str) -> Result<String, String> {
    println!("[info] File received");
    return match ffmpeg::compress(path).await {
        Ok(result) => Ok(result),
        Err(err) => Err(err),
    };
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![compress])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
