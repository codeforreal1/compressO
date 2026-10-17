//! Logs written to files, so a problem can be looked into from the files a user sends (Settings ->
//! General -> Troubleshooting -> Show log files). Each file is named after when it was started, e.g.
//! `CompressO_2026-10-17_04-17-36.log` (with milliseconds when one of that second exists). The newest
//! file is written to until it holds more than `MAX_FILE_SIZE` when the app starts, then a new one is
//! started, and only the newest `KEPT_FILES` are kept, so the logs take about 25 MB at most.
//!
//! Where they are: macOS `~/Library/Logs/com.compresso.app/`, Windows
//! `%LOCALAPPDATA%\com.compresso.app\logs\`, Linux `~/.local/share/com.compresso.app/logs/`.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{plugin::TauriPlugin, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use time::OffsetDateTime;

/// Start of every log file's name, followed by its date
const LOG_FILE_PREFIX: &str = "CompressO_";
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
const KEPT_FILES: usize = 5;

/// Libraries whose messages are not worth keeping in the log files (connections, windows...)
const NOISY_TARGETS: [&str; 7] = [
    "tao", "wry", "rustls", "hyper", "reqwest", "h2", "tauri_plugin_updater",
];

/// The log file of this run, which "Show log files" shows
static LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The log plugin, added once the app is set up (the log folder is the app's): the log files
/// (information, warnings & errors), and the terminal in development (everything)
pub fn plugin<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<TauriPlugin<R>, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|err| err.to_string())?;
    let file_name = choose_log_file_name(&log_dir);
    let _ = LOG_FILE_PATH.set(log_dir.join(format!("{}.log", file_name)));
    remove_old_log_files(&log_dir, &file_name);

    let file = Target::new(TargetKind::Folder {
        path: log_dir,
        file_name: Some(file_name),
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

    Ok(tauri_plugin_log::Builder::new()
        .targets(targets)
        // The files are named & removed here (see above), so the plugin never renames them
        .max_file_size(u128::MAX)
        .rotation_strategy(RotationStrategy::KeepAll)
        // Local time cannot be read safely once the app runs several threads (it falls back to UTC
        // anyway), so the times are UTC, as the start line says
        .timezone_strategy(TimezoneStrategy::UseUtc)
        .build())
}

/// The log files, oldest first (their names start with their date, so they sort by it)
fn log_files(log_dir: &Path) -> Vec<(String, PathBuf)> {
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(log_dir)
        .map(|entries| {
            entries
                .filter_map(|entry| {
                    let path = entry.ok()?.path();
                    let name = path.file_stem()?.to_string_lossy().to_string();
                    let is_log_file = name.starts_with(LOG_FILE_PREFIX)
                        && path.extension().is_some_and(|extension| extension == "log");
                    is_log_file.then_some((name, path))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}

/// The newest log file while it is not full, otherwise a new one named after now (with the
/// milliseconds when a file of this second exists)
fn choose_log_file_name(log_dir: &Path) -> String {
    if let Some((name, path)) = log_files(log_dir).pop() {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size < MAX_FILE_SIZE {
            return name;
        }
    }
    let now = OffsetDateTime::now_utc();
    let name = format!(
        "{}{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
        LOG_FILE_PREFIX,
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    );
    if log_dir.join(format!("{}.log", name)).exists() {
        format!("{}-{:03}", name, now.millisecond())
    } else {
        name
    }
}

/// Keeps the newest `KEPT_FILES` log files, with the one of this run
fn remove_old_log_files(log_dir: &Path, current_file_name: &str) {
    let files = log_files(log_dir);
    let old_files = files
        .iter()
        .filter(|(name, _)| name != current_file_name)
        .rev()
        .skip(KEPT_FILES - 1);
    for (_, path) in old_files {
        let _ = std::fs::remove_file(path);
    }
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

/// The log file of this run, which "Show log files" shows in the file manager
pub fn log_file_path() -> Result<PathBuf, String> {
    LOG_FILE_PATH
        .get()
        .cloned()
        .ok_or_else(|| String::from("The log file is not set up."))
}
