//! Logs written to files, so a problem can be looked into from the files a user sends (Settings ->
//! About -> Show log files). They are kept small: each file holds at most `MAX_FILE_SIZE`, and only
//! the newest `KEPT_FILES` are kept, so the logs never take more than about 25 MB.
//!
//! Where they are: macOS `~/Library/Logs/com.compresso.app/`, Windows
//! `%LOCALAPPDATA%\com.compresso.app\logs\`, Linux `~/.local/share/com.compresso.app/logs/`.

use std::path::PathBuf;

use tauri::{plugin::TauriPlugin, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// Name of the log file (`CompressO.log`; older ones are renamed with their date)
const LOG_FILE_NAME: &str = "CompressO";
const MAX_FILE_SIZE: u128 = 5 * 1024 * 1024;
const KEPT_FILES: usize = 5;

/// Libraries whose messages are not worth keeping in the log files (connections, windows...)
const NOISY_TARGETS: [&str; 7] = [
    "tao", "wry", "rustls", "hyper", "reqwest", "h2", "tauri_plugin_updater",
];

/// The log plugin: the log files (information, warnings & errors), and the terminal in development
/// (everything)
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let file = Target::new(TargetKind::LogDir {
        file_name: Some(LOG_FILE_NAME.to_string()),
    })
    .filter(|metadata| {
        metadata.level() <= log::Level::Info
            && !NOISY_TARGETS
                .iter()
                .any(|target| metadata.target().starts_with(target))
    });
    #[allow(unused_mut)]
    let mut targets = vec![file];
    #[cfg(debug_assertions)]
    targets.push(Target::new(TargetKind::Stdout));

    tauri_plugin_log::Builder::new()
        .targets(targets)
        .max_file_size(MAX_FILE_SIZE)
        .rotation_strategy(RotationStrategy::KeepSome(KEPT_FILES))
        // Local time cannot be read safely once the app runs several threads (it falls back to UTC
        // anyway), so the times are UTC, as the start line says
        .timezone_strategy(TimezoneStrategy::UseUtc)
        .build()
}

/// Writes a crash (a panic) to the log, which would otherwise only show in a terminal, before the
/// app ends as it did
pub fn log_panics() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("[panic] {}", info);
        log::logger().flush();
        previous_hook(info);
    }));
}

/// The app, version & system, at the top of each run in the log
pub fn log_app_start<R: Runtime>(app: &tauri::AppHandle<R>) {
    log::info!(
        "CompressO {} started on {} {} ({}), times in UTC",
        app.package_info().version,
        tauri_plugin_os::platform(),
        tauri_plugin_os::version(),
        tauri_plugin_os::arch(),
    );
}

/// The current log file, which "Show log files" shows in the file manager
pub fn log_file_path<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    Ok(log_dir.join(format!("{}.log", LOG_FILE_NAME)))
}
