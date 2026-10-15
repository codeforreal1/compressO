// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
#[cfg(target_os = "macos")]
mod macos;
mod sys;
mod tauri_commands;
mod utils;

#[cfg(target_os = "linux")]
use core::server;

use std::sync::{Arc, Mutex, OnceLock};
use sys::fs::{self as file_system};
use sys::quit;
use tauri::{Emitter, Listener, Manager, Url};
use tauri_plugin_fs::FsExt;
use tauri_plugin_log::{Target as LogTarget, TargetKind as LogTargetKind};

use tauri_commands::{
    compression_status::{
        get_compression_status, has_unsaved_output, is_compressing, set_compression_status,
        update_compression_status, CompressionStatusState,
    },
    dock::{clear_dock_badge, set_dock_progress},
    ffmpeg::{compress_video, compress_videos_batch, extract_subtitle, generate_video_thumbnail},
    ffprobe::{
        get_audio_streams, get_chapters, get_container_info, get_subtitle_streams,
        get_video_basic_info, get_video_streams,
    },
    file_manager::show_item_in_file_manager,
    fs::{
        copy_file_to_clipboard, copy_files_to_clipboard, delete_cache, delete_file, get_file_metadata, get_image_dimension,
        get_available_path, get_svg_dimension, move_file, read_files_from_clipboard, read_files_from_paths,
    },
    image::{
        compress_images_batch, convert_svg_to_png, get_exif_info, get_image_basic_info,
        get_image_color_info, get_image_dimensions,
    },
    hardware_encoder::{get_hardware_encoders, set_hardware_encoding_enabled},
    media::{compress_media_batch, set_batch_paused},
    sound::play_completion_sound,
    updater::{check_update, download_and_install_update},
    window::set_window_tint,
};

#[cfg(target_os = "linux")]
use tauri_commands::server::{construct_video_url, get_server_url};

#[cfg(target_os = "linux")]
use tauri_commands::file_manager::DbusState;

#[cfg(target_os = "macos")]
use tauri_commands::drop_queue::{
    cancel_drop_queue, clear_finished_drop_queue, is_drop_queue_paused, set_drop_queue_paused, get_drop_queue, remove_drop_queue_item, retry_drop_queue_item,
    set_auto_compress_enabled, update_drop_queue_item,
};

#[cfg(target_os = "macos")]
use tauri_commands::tray::{
    close_tray_popover, focus_main_window, is_tray_popover_visible, open_tray_popover, quit_app,
    add_dropped_files, clear_dropped_files, get_dropped_files, is_clipboard_watch_enabled,
    paste_dropped_files, remove_dropped_file, resize_tray_popover, set_clipboard_watch_enabled,
    set_supported_drop_extensions, set_tray_icon_enabled, set_tray_popover_pinned,
};

#[cfg(any(windows, target_os = "linux"))]
use std::path::PathBuf;

#[cfg(debug_assertions)]
const LOG_TARGETS: [LogTarget; 1] = [LogTarget::new(LogTargetKind::Stdout)];

#[cfg(not(debug_assertions))]
const LOG_TARGETS: [LogTarget; 0] = [];

const MAIN_WINDOW_LABEL: &str = "main";

// Global storage for URLs that arrive before app setup completes.
// "Open with CompressO" triggers `application:openURLs` before app setup is complete
static EARLY_URLS: OnceLock<Mutex<Vec<Url>>> = OnceLock::new();

struct PendingFiles(Arc<Mutex<Vec<String>>>);

impl PendingFiles {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(Vec::new())))
    }
}

fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_visible().unwrap_or(false) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

struct FrontendReady(Arc<Mutex<bool>>);

impl FrontendReady {
    fn new() -> Self {
        Self(Arc::new(Mutex::new(false)))
    }

    fn set_ready(&self) {
        *self.0.lock().unwrap() = true;
    }

    fn set_not_ready(&self) {
        *self.0.lock().unwrap() = false;
    }

    fn is_ready(&self) -> bool {
        *self.0.lock().unwrap()
    }
}

fn emit_pending_open_with_app_files(app_handle: &tauri::AppHandle) {
    if let Some(pending) = app_handle.try_state::<PendingFiles>() {
        let pending_inner = pending.0.clone();
        let app_handle_clone = app_handle.clone();

        let mut list = pending_inner.lock().unwrap();
        if !list.is_empty() {
            let files_to_emit = list.drain(..).collect::<Vec<_>>();
            log::info!("Emitting files on frontend ready: {:?}", files_to_emit);
            drop(list);
            if let Err(e) = app_handle_clone.emit("open-with-app", files_to_emit) {
                log::error!("Failed to emit open-with-app event: {:?}", e);
            }
        }
    }
}

fn handle_open_with_app(app_handle: &tauri::AppHandle, urls: Vec<Url>) -> Result<(), String> {
    let fs_scope = app_handle.fs_scope();
    let asset_scope = app_handle.asset_protocol_scope();

    let new_files: Vec<String> = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|p| p.to_string_lossy().replace('\\', "\\\\"))
        .collect();

    for url in &urls {
        if let Ok(path) = url.to_file_path() {
            if let Err(_) = fs_scope.allow_file(&path) {
                let path_str = path.to_string_lossy().to_string();
                return Err(format!("Failed to allow file in fs_scope: {}", path_str));
            }
            if let Err(_) = asset_scope.allow_file(&path) {
                let path_str = path.to_string_lossy().to_string();
                return Err(format!("Failed to allow file in asset_scope: {}", path_str));
            }
        }
    }

    if let Some(pending) = app_handle.try_state::<PendingFiles>() {
        let frontend_ready = app_handle.try_state::<FrontendReady>();
        let pending_inner = pending.0.clone();

        {
            let mut list = pending_inner
                .lock()
                .map_err(|e| format!("Failed to lock pending files: {:?}", e))?;
            list.extend(new_files);
        }

        if let Some(ready_state) = frontend_ready {
            let is_ready = ready_state.is_ready();
            if is_ready {
                let app_handle_clone = app_handle.clone();
                let mut list = pending_inner.lock().unwrap();
                log::info!("Frontend is ready, emitting {} pending files", list.len());
                if !list.is_empty() {
                    let files_to_emit = list.drain(..).collect::<Vec<_>>();
                    drop(list);
                    if let Err(e) = app_handle_clone.emit("open-with-app", files_to_emit) {
                        log::error!("Failed to emit open-with-app event: {:?}", e);
                    }
                }
            } else {
                log::info!("Frontend not ready yet, files stored in pending list");
            }
        }
    } else {
        log::info!(
            "PendingFiles state not ready, storing {} URLs for later",
            urls.len()
        );
        let early_urls = EARLY_URLS.get_or_init(|| Mutex::new(Vec::new()));
        let mut stored = early_urls.lock().unwrap();
        stored.extend(urls);
    }

    Ok(())
}

/// Files dropped on the menu bar can be opened unless compressing or compressed media is unsaved,
/// which the new media would replace
#[cfg(target_os = "macos")]
fn can_open_files_in_main_window(app_handle: &tauri::AppHandle) -> bool {
    !is_compressing(app_handle) && !has_unsaved_output(app_handle)
}

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
        .plugin(
            // Don't restore visibility: the window starts hidden & is shown once the frontend is ready
            tauri_plugin_window_state::Builder::default()
                // The tray popover window has a fixed size (set in code), so it must not be restored
                .with_denylist(&["tray"])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                )
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(PendingFiles::new());
            app.manage(FrontendReady::new());
            app.manage(CompressionStatusState(Mutex::new(Default::default())));

            // Finds the graphics card's video encoders in the background, so the first compression
            // does not wait for it
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    core::hardware_encoder::available_encoders(&app_handle).await;
                });
            }

            #[cfg(target_os = "macos")]
            quit::install_macos_quit_confirmation(app.handle());

            #[cfg(target_os = "macos")]
            macos::app_menu::init(app)?;

            #[cfg(target_os = "linux")]
            app.manage(DbusState(Mutex::new(
                dbus::blocking::SyncConnection::new_session().ok(),
            )));

            #[cfg(target_os = "linux")]
            {
                use std::sync::mpsc;
                use std::thread;
                use std::time::Duration;

                let (tx, rx) = mpsc::channel();

                thread::spawn(move || {
                    let rt = match tokio::runtime::Runtime::new() {
                        Ok(rt) => rt,
                        Err(e) => {
                            let _ = tx.send(Err(format!("Failed to create runtime: {}", e)));
                            return;
                        }
                    };

                    rt.block_on(async {
                        match server::start_server().await {
                            Ok(state) => {
                                let shutdown_tx = state.shutdown_tx.clone();
                                let _ = tx.send(Ok(state));

                                let mut shutdown_rx = shutdown_tx.subscribe();
                                let _ = shutdown_rx.recv().await;
                                log::info!("Server thread shutting down");
                            }
                            Err(e) => {
                                log::error!("Failed to start video server: {:?}", e);
                                let _ = tx.send(Err(format!("Server error: {}", e)));
                            }
                        }
                    });
                });

                // Wait for the server to start with a timeout
                let server_state = match rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(Ok(state)) => state,
                    Ok(Err(e)) => {
                        log::error!("Video server startup failed: {}", e);
                        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)));
                    }
                    Err(_) => {
                        return Err(Box::new(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "Video server startup timed out after 5 seconds",
                        )));
                    }
                };

                log::info!("Video server started on port {}", server_state.port);

                app.manage(server_state.clone());
            }
            file_system::setup_app_data_dir(app)?;
            file_system::ensure_assets_dir(&app.app_handle())?;

            // The tray icon itself is added by the frontend, depending on the user's setting
            #[cfg(target_os = "macos")]
            macos::tray_popover::init(app);

            // The window starts hidden (see `tauri.conf.json`) so the webview isn't shown before it
            // has painted, which flashed a blank background on launch
            let fallback_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Fallback in case the frontend never signals readiness (e.g. a load error)
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                show_main_window(&fallback_app_handle);
            });

            let app_handle = app.handle().clone();
            // Every main window sends it (it can be closed & recreated while the app keeps running
            // in the menu bar), so files opened in the meantime are delivered to the new one
            app.listen("frontend-ready", move |_| {
                log::info!("Frontend is ready, checking for pending files");

                show_main_window(&app_handle);

                if let Some(ready_state) = app_handle.try_state::<FrontendReady>() {
                    ready_state.set_ready();
                }

                emit_pending_open_with_app_files(&app_handle);

                #[cfg(target_os = "macos")]
                macos::app_menu::on_frontend_ready(&app_handle);
            });

            if let Some(early_urls) = EARLY_URLS.get() {
                let urls_to_process = {
                    let mut stored = early_urls.lock().unwrap();
                    if stored.is_empty() {
                        None
                    } else {
                        Some(stored.drain(..).collect::<Vec<_>>())
                    }
                };

                if let Some(urls) = urls_to_process {
                    if let Err(e) = handle_open_with_app(app.handle(), urls) {
                        log::error!("Failed to handle early open with app URLs: {:?}", e);
                    }
                }
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                let args: Vec<String> = std::env::args().collect();

                let mut urls = Vec::new();
                for maybe_file in args.iter().skip(1) {
                    if maybe_file.starts_with('-') {
                        continue;
                    }

                    if cfg!(target_os = "windows") {
                        let path = PathBuf::from(maybe_file);

                        match Url::from_file_path(&path) {
                            Ok(url) => {
                                urls.push(url);
                            }
                            Err(_) => {
                                log::error!("Failed to convert Windows path: {:?}", path);
                            }
                        }
                    } else {
                        if let Ok(url) = Url::parse(maybe_file) {
                            if let Ok(_path) = url.to_file_path() {
                                urls.push(url);
                            }
                        } else {
                            let path = PathBuf::from(maybe_file);
                            if let Ok(url) = Url::from_file_path(&path) {
                                urls.push(url);
                            }
                        }
                    }
                }
                if let Err(e) = handle_open_with_app(app.handle(), urls) {
                    log::error!("Failed to handle open with app (platform args): {:?}", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            compress_video,
            compress_videos_batch,
            compress_images_batch,
            compress_media_batch,
            set_batch_paused,
            set_hardware_encoding_enabled,
            get_hardware_encoders,
            extract_subtitle,
            generate_video_thumbnail,
            get_video_basic_info,
            get_image_dimension,
            get_svg_dimension,
            get_file_metadata,
            move_file,
            get_available_path,
            delete_file,
            delete_cache,
            show_item_in_file_manager,
            copy_file_to_clipboard,
            copy_files_to_clipboard,
            read_files_from_clipboard,
            read_files_from_paths,
            get_audio_streams,
            get_chapters,
            get_container_info,
            get_subtitle_streams,
            get_video_streams,
            set_dock_progress,
            clear_dock_badge,
            check_update,
            download_and_install_update,
            convert_svg_to_png,
            get_image_basic_info,
            get_image_dimensions,
            get_image_color_info,
            get_exif_info,
            set_window_tint,
            play_completion_sound,
            #[cfg(target_os = "linux")]
            get_server_url,
            #[cfg(target_os = "linux")]
            construct_video_url,
            #[cfg(target_os = "macos")]
            open_tray_popover,
            #[cfg(target_os = "macos")]
            close_tray_popover,
            #[cfg(target_os = "macos")]
            resize_tray_popover,
            #[cfg(target_os = "macos")]
            is_tray_popover_visible,
            #[cfg(target_os = "macos")]
            focus_main_window,
            #[cfg(target_os = "macos")]
            quit_app,
            #[cfg(target_os = "macos")]
            set_tray_icon_enabled,
            #[cfg(target_os = "macos")]
            add_dropped_files,
            paste_dropped_files,
            #[cfg(target_os = "macos")]
            remove_dropped_file,
            #[cfg(target_os = "macos")]
            get_dropped_files,
            #[cfg(target_os = "macos")]
            clear_dropped_files,
            #[cfg(target_os = "macos")]
            set_clipboard_watch_enabled,
            #[cfg(target_os = "macos")]
            is_clipboard_watch_enabled,
            #[cfg(target_os = "macos")]
            set_supported_drop_extensions,
            #[cfg(target_os = "macos")]
            set_tray_popover_pinned,
            #[cfg(target_os = "macos")]
            set_auto_compress_enabled,
            #[cfg(target_os = "macos")]
            get_drop_queue,
            #[cfg(target_os = "macos")]
            update_drop_queue_item,
            #[cfg(target_os = "macos")]
            retry_drop_queue_item,
            #[cfg(target_os = "macos")]
            remove_drop_queue_item,
            #[cfg(target_os = "macos")]
            clear_finished_drop_queue,
            #[cfg(target_os = "macos")]
            cancel_drop_queue,
            #[cfg(target_os = "macos")]
            set_drop_queue_paused,
            #[cfg(target_os = "macos")]
            is_drop_queue_paused,
            set_compression_status,
            get_compression_status
        ])
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }
            let app_handle = window.app_handle();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if !is_compressing(app_handle) && !has_unsaved_output(app_handle) {
                        return;
                    }

                    // With the menu bar icon, closing the window during a compression (or with
                    // unsaved outputs) only hides it: the compression continues (its progress
                    // shows in the menu bar), nothing is lost & the window comes back from the
                    // menu bar or the dock
                    #[cfg(target_os = "macos")]
                    if app_handle
                        .tray_by_id(macos::tray_popover::TRAY_WINDOW_LABEL)
                        .is_some()
                    {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }

                    // Otherwise closing the window loses the compression or the unsaved outputs (&
                    // quits), so ask first
                    if let Some(reason) = quit::quit_reason(app_handle) {
                        api.prevent_close();
                        let window_to_close = window.clone();
                        quit::confirm_quit(app_handle, reason, move || {
                            let _ = window_to_close.destroy();
                        });
                    }
                }
                // The compression stops with the window, so its progress is cleared
                tauri::WindowEvent::Destroyed => {
                    // Files opened before a new main window is ready wait for it
                    if let Some(ready_state) = app_handle.try_state::<FrontendReady>() {
                        ready_state.set_not_ready();
                    }
                    // Also clears the menu bar progress
                    #[cfg(target_os = "macos")]
                    let _ = clear_dock_badge(app_handle.clone());
                    update_compression_status(app_handle, Default::default());
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Opened { ref urls } = event {
                    if let Err(e) = handle_open_with_app(app_handle, urls.clone()) {
                        log::error!("Failed to handle open with app: {:?}", e);
                    }
                    // The app may still be running in the menu bar without a main window
                    if app_handle.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
                        if let Err(e) = tauri_commands::tray::focus_or_create_main_window(app_handle)
                        {
                            log::error!("Failed to open the main window: {}", e);
                        }
                    }
                }

                // Running compressions (ffmpeg etc.) are separate processes, so they are stopped
                // with the app
                if let tauri::RunEvent::Exit = event {
                    core::media_process::kill_running_processes();
                }

                // Quitting (e.g. from the menu bar popover) cancels the compression or discards unsaved
                // outputs, so ask first
                if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                    if let Some(reason) = quit::quit_reason(app_handle) {
                        api.prevent_exit();
                        let exit_app_handle = app_handle.clone();
                        quit::confirm_quit(app_handle, reason, move || exit_app_handle.exit(0));
                    }
                }

                // The hidden tray window keeps the app alive after the main window is closed, so
                // clicking the dock icon brings the main window back
                #[cfg(target_os = "macos")]
                if let tauri::RunEvent::Reopen {
                    has_visible_windows: false,
                    ..
                } = event
                {
                    if let Err(e) = tauri_commands::tray::focus_or_create_main_window(app_handle) {
                        log::error!("Failed to reopen the main window: {}", e);
                    }
                }

                // Handle server shutdown on app exit (Linux only)
                #[cfg(target_os = "linux")]
                if matches!(event, tauri::RunEvent::Exit) {
                    if let Some(server_state) = app_handle.try_state::<core::server::ServerState>()
                    {
                        log::info!("App exiting, shutting down video server");
                        core::server::shutdown_server(&server_state);
                    }
                }
            },
        );
}
