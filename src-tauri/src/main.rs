// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
#[cfg(target_os = "macos")]
mod macos;
mod sys;
mod tauri_commands;
mod utils;
#[cfg(windows)]
mod win;

// The tray popover with the drop zone: the macOS menu bar's, or the Windows system tray's
#[cfg(target_os = "macos")]
use macos::tray_popover;
#[cfg(windows)]
use win::tray_popover;

#[cfg(target_os = "linux")]
use core::server;

use std::sync::{Arc, Mutex, OnceLock};
use sys::fs::{self as file_system};
use sys::quit;
use tauri::{Emitter, Listener, Manager, Url};
use tauri_plugin_fs::FsExt;

use tauri_commands::{
    app::{
        get_log_file_path, get_open_at_login, open_login_items_settings, restart_app, set_keep_awake_settings,
        set_open_at_login, take_opened_at_login, OPENED_AT_LOGIN_ARG,
    },
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
use tauri_commands::server::{construct_video_url, start_video_server};

#[cfg(target_os = "linux")]
use tauri_commands::file_manager::DbusState;

#[cfg(any(target_os = "macos", windows))]
use tauri_commands::drop_queue::{
    cancel_drop_queue, clear_finished_drop_queue, is_drop_queue_paused, set_drop_queue_paused, get_drop_queue, remove_drop_queue_item, retry_drop_queue_item,
    set_auto_compress_enabled, update_drop_queue_item,
};

#[cfg(any(target_os = "macos", windows))]
use tauri_commands::tray::{
    add_dropped_files, clear_dropped_files, close_tray_popover, focus_main_window,
    get_dropped_files, is_clipboard_watch_enabled, is_tray_popover_visible, open_tray_popover,
    paste_dropped_files, quit_app, remove_dropped_file, resize_tray_popover,
    set_clipboard_watch_enabled, set_supported_drop_extensions, set_tray_icon_enabled,
    set_tray_popover_pinned, set_tray_progress_color,
};

#[cfg(any(windows, target_os = "linux"))]
use std::path::PathBuf;

const MAIN_WINDOW_LABEL: &str = "main";

// Global storage for URLs that arrive before app setup completes.
// "Open with CompressO" triggers `application:openURLs` before app setup is complete
static EARLY_URLS: OnceLock<Mutex<Vec<Url>>> = OnceLock::new();

/// Set once the app is set up, with its main window. "Open with CompressO" can open files while
/// the app is still launching, before that window exists: creating one then made the app's own
/// creation of it fail (& the app crash), so files opened then wait for it instead.
static IS_APP_SET_UP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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

/// Files the app was launched with ("Open with", or dragged on its icon): file URLs or paths,
/// relative ones resolved against `cwd` (the directory of a second launch). Options such as
/// `--autostart` are skipped.
#[cfg(any(windows, target_os = "linux"))]
fn urls_from_launch_args(args: &[String], cwd: Option<&str>) -> Vec<Url> {
    let mut urls = Vec::new();
    for maybe_file in args.iter().skip(1) {
        if maybe_file.starts_with('-') {
            continue;
        }

        if !cfg!(target_os = "windows") {
            if let Ok(url) = Url::parse(maybe_file) {
                if url.to_file_path().is_ok() {
                    urls.push(url);
                }
                continue;
            }
        }

        let mut path = PathBuf::from(maybe_file);
        if path.is_relative() {
            if let Some(cwd) = cwd {
                path = PathBuf::from(cwd).join(path);
            }
        }
        match Url::from_file_path(&path) {
            Ok(url) => urls.push(url),
            Err(_) => log::error!("Failed to convert the launch path: {:?}", path),
        }
    }
    urls
}

/// Another launch of the app (only one runs at a time, so they never share or clear each other's
/// cache): the running app comes forward instead, with the files it was launched with
fn on_second_instance(app_handle: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    log::info!("Another launch of the app, bringing this one forward");

    // Also when the main window was closed, while the app keeps running in the tray
    #[cfg(any(target_os = "macos", windows))]
    if let Err(e) = tauri_commands::tray::focus_or_create_main_window(app_handle) {
        log::error!("Failed to open the main window: {}", e);
    }
    #[cfg(target_os = "linux")]
    if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    #[cfg(any(windows, target_os = "linux"))]
    {
        let urls = urls_from_launch_args(&args, Some(&cwd));
        if !urls.is_empty() {
            if let Err(e) = handle_open_with_app(app_handle, urls) {
                log::error!("Failed to open the files of another launch: {:?}", e);
            }
        }
    }
    #[cfg(target_os = "macos")]
    let _ = (args, cwd);
}

/// Files dropped on the tray can be opened unless compressing or compressed media is unsaved, which
/// the new media would replace
#[cfg(any(target_os = "macos", windows))]
fn can_open_files_in_main_window(app_handle: &tauri::AppHandle) -> bool {
    !is_compressing(app_handle) && !has_unsaved_output(app_handle)
}

#[tokio::main]
async fn main() {
    sys::logging::log_panics();
    tauri::Builder::default()
        // First, so a second launch exits before anything else starts
        .plugin(tauri_plugin_single_instance::init(on_second_instance))
        // Opens the app at login when turned on (Settings -> General), telling it so
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![OPENED_AT_LOGIN_ARG]),
        ))
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
            // Log files, so problems can be looked into (see `sys::logging`); added here, as the
            // log folder is the app's
            match sys::logging::plugin(app.handle()) {
                Ok(log_plugin) => {
                    if let Err(e) = app.handle().plugin(log_plugin) {
                        eprintln!("Failed to start logging: {}", e);
                    }
                }
                Err(e) => eprintln!("Failed to start logging: {}", e),
            }
            sys::logging::log_app_start(app.handle());
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

            // Started by the frontend, only with video previews on (see `start_video_server`)
            #[cfg(target_os = "linux")]
            app.manage(server::VideoServer::default());
            file_system::setup_app_data_dir(app)?;
            file_system::ensure_assets_dir(&app.app_handle())?;

            // The tray icon itself is added by the frontend, depending on the user's setting
            #[cfg(any(target_os = "macos", windows))]
            tray_popover::init(app);

            // The window starts hidden (see `tauri.conf.json`) so the webview isn't shown before it
            // has painted, which flashed a blank background on launch
            let fallback_app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Fallback in case the frontend never signals readiness (e.g. a load error); not
                // once it did, as it may have chosen to stay hidden (opened at login)
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let is_frontend_ready = fallback_app_handle
                    .try_state::<FrontendReady>()
                    .is_some_and(|ready_state| ready_state.is_ready());
                if !is_frontend_ready {
                    show_main_window(&fallback_app_handle);
                }
            });

            let app_handle = app.handle().clone();
            // Every main window sends it (it can be closed & recreated while the app keeps running
            // in the menu bar), so files opened in the meantime are delivered to the new one
            app.listen("frontend-ready", move |evt| {
                log::info!("Frontend is ready, checking for pending files");

                // Left hidden when opened at login to the menu bar only (Settings -> General)
                let should_show = serde_json::from_str::<serde_json::Value>(evt.payload())
                    .ok()
                    .and_then(|payload| payload.get("show")?.as_bool())
                    .unwrap_or(true);
                if should_show {
                    show_main_window(&app_handle);
                }

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
                let urls = urls_from_launch_args(&args, None);
                if let Err(e) = handle_open_with_app(app.handle(), urls) {
                    log::error!("Failed to handle open with app (platform args): {:?}", e);
                }
            }

            IS_APP_SET_UP.store(true, std::sync::atomic::Ordering::SeqCst);
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
            restart_app,
            set_keep_awake_settings,
            take_opened_at_login,
            get_open_at_login,
            set_open_at_login,
            open_login_items_settings,
            get_log_file_path,
            #[cfg(target_os = "linux")]
            start_video_server,
            #[cfg(target_os = "linux")]
            construct_video_url,
            #[cfg(any(target_os = "macos", windows))]
            open_tray_popover,
            #[cfg(any(target_os = "macos", windows))]
            close_tray_popover,
            #[cfg(any(target_os = "macos", windows))]
            resize_tray_popover,
            #[cfg(any(target_os = "macos", windows))]
            is_tray_popover_visible,
            #[cfg(any(target_os = "macos", windows))]
            focus_main_window,
            #[cfg(any(target_os = "macos", windows))]
            quit_app,
            #[cfg(any(target_os = "macos", windows))]
            set_tray_icon_enabled,
            #[cfg(any(target_os = "macos", windows))]
            add_dropped_files,
            #[cfg(any(target_os = "macos", windows))]
            paste_dropped_files,
            #[cfg(any(target_os = "macos", windows))]
            remove_dropped_file,
            #[cfg(any(target_os = "macos", windows))]
            get_dropped_files,
            #[cfg(any(target_os = "macos", windows))]
            clear_dropped_files,
            #[cfg(any(target_os = "macos", windows))]
            set_clipboard_watch_enabled,
            #[cfg(any(target_os = "macos", windows))]
            is_clipboard_watch_enabled,
            #[cfg(any(target_os = "macos", windows))]
            set_supported_drop_extensions,
            #[cfg(any(target_os = "macos", windows))]
            set_tray_popover_pinned,
            #[cfg(any(target_os = "macos", windows))]
            set_tray_progress_color,
            #[cfg(any(target_os = "macos", windows))]
            set_auto_compress_enabled,
            #[cfg(any(target_os = "macos", windows))]
            get_drop_queue,
            #[cfg(any(target_os = "macos", windows))]
            update_drop_queue_item,
            #[cfg(any(target_os = "macos", windows))]
            retry_drop_queue_item,
            #[cfg(any(target_os = "macos", windows))]
            remove_drop_queue_item,
            #[cfg(any(target_os = "macos", windows))]
            clear_finished_drop_queue,
            #[cfg(any(target_os = "macos", windows))]
            cancel_drop_queue,
            #[cfg(any(target_os = "macos", windows))]
            set_drop_queue_paused,
            #[cfg(any(target_os = "macos", windows))]
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

                    // With the tray icon, closing the window during a compression (or with unsaved
                    // outputs) only hides it: the compression continues (its progress shows in the
                    // tray), nothing is lost & the window comes back from the tray (or the dock)
                    #[cfg(any(target_os = "macos", windows))]
                    if app_handle
                        .tray_by_id(tray_popover::TRAY_WINDOW_LABEL)
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
                    // Also clears the tray's progress
                    #[cfg(any(target_os = "macos", windows))]
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
                    // The app may still be running in the menu bar without a main window (not while
                    // it is launching, when the main window is about to be created)
                    if IS_APP_SET_UP.load(std::sync::atomic::Ordering::SeqCst)
                        && app_handle.get_webview_window(MAIN_WINDOW_LABEL).is_none()
                    {
                        if let Err(e) =
                            tauri_commands::tray::focus_or_create_main_window(app_handle)
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
                    let video_server = app_handle.try_state::<server::VideoServer>();
                    let running = video_server
                        .as_ref()
                        .and_then(|video_server| video_server.0.lock().ok()?.clone());
                    if let Some(server_state) = running {
                        log::info!("App exiting, shutting down video server");
                        server::shutdown_server(&server_state);
                    }
                }
            },
        );
}
