// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use lib::fs::{self as file_system};
use tauri::Manager;
use tauri_plugin_log::{Target as LogTarget, TargetKind as LogTargetKind};

use lib::tauri_commands::{
    command::{__cmd__show_item_in_file_manager, show_item_in_file_manager},
    ffmpeg::{
        __cmd__compress_video, __cmd__generate_video_thumbnail, __cmd__get_video_duration,
        compress_video, generate_video_thumbnail, get_video_duration,
    },
    fs::{
        __cmd__delete_cache, __cmd__delete_file, __cmd__get_file_metadata,
        __cmd__get_image_dimension, __cmd__move_file, delete_cache, delete_file, get_file_metadata,
        get_image_dimension, move_file,
    },
};

#[cfg(target_os = "linux")]
use lib::tauri_commands::command::DbusState;
#[cfg(target_os = "linux")]
use std::sync::Mutex;

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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            app.manage(DbusState(Mutex::new(
                dbus::blocking::SyncConnection::new_session().ok(),
            )));

            file_system::setup_app_data_dir(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compress_video,
            generate_video_thumbnail,
            get_video_duration,
            get_image_dimension,
            get_file_metadata,
            move_file,
            delete_file,
            delete_cache,
            show_item_in_file_manager
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
