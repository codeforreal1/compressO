//! Watched folders (Settings -> Watched folders): media that lands in them (e.g. a new screen
//! recording or download) is added to the drop zone's queue, after the media dropped on it (see
//! `drop_queue`), whether or not the drop zone compresses automatically. The menu bar's window
//! compresses it (the main window, on Linux, while it is open). The system tells when files change
//! (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux), through `notify`:
//! - only media added after a folder is watched (what is already in it is left alone)
//! - only once complete: a file is handled once it has not changed for a moment, & temporary files
//!   (hidden ones, partial downloads) are skipped until they are renamed
//! - never the app's own outputs, even renamed, moved or copied (see `output_registry`)

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, DebouncedEventKind, Debouncer};
use serde::Deserialize;
use tauri::AppHandle;

/// A file is handled once it has not changed for this long (it is still being written before)
const SETTLE_TIME: Duration = Duration::from_secs(2);

/// Files still being written by browsers & download tools, handled once renamed
const TEMPORARY_EXTENSIONS: [&str; 7] = [
    "part",
    "partial",
    "crdownload",
    "download",
    "opdownload",
    "tmp",
    "temp",
];

/// A folder to watch, from the settings
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: String,
    pub path: String,
    /// Shown with its media in the queue (e.g. `Screenshots`)
    pub name: String,
}

/// A folder being watched: its real path (as the system reports changes), & the files in it that
/// are already handled (or were there when it started being watched)
struct FolderState {
    folder: WatchedFolder,
    real_path: PathBuf,
    known: HashSet<PathBuf>,
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static FOLDERS: Mutex<Vec<FolderState>> = Mutex::new(Vec::new());
/// The extensions of the media that can be compressed, set by the frontend
static SUPPORTED_EXTENSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static WATCHER: Mutex<Option<Debouncer<RecommendedWatcher>>> = Mutex::new(None);

/// Keeps the app, to queue media from the system's changes
pub fn init(app_handle: &AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
}

/// Paths that no longer name directories. Checked when Watch Folder settings open and before a
/// folder is enabled, since the operating system may not report removal of the watched root.
#[tauri::command]
pub async fn missing_watched_folders(paths: Vec<String>) -> Vec<String> {
    let mut missing = Vec::new();
    for path in paths {
        match tokio::fs::metadata(&path).await {
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => missing.push(path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => missing.push(path),
            Err(error) => log::warn!("[watch-folders] Could not check {}: {}", path, error),
        }
    }
    missing
}

/// The files directly in a folder (not in its subfolders)
fn files_in(path: &Path) -> HashSet<PathBuf> {
    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_file())
                .collect()
        })
        .unwrap_or_default()
}

/// Sets the folders watched (the enabled ones; the settings are kept by the frontend). A folder
/// newly watched starts from what is in it now.
#[tauri::command]
pub fn set_watched_folders(folders: Vec<WatchedFolder>, supported_extensions: Vec<String>) {
    if let Ok(mut extensions) = SUPPORTED_EXTENSIONS.lock() {
        *extensions = supported_extensions
            .iter()
            .map(|extension| extension.to_lowercase())
            .collect();
    }
    let Ok(mut states) = FOLDERS.lock() else {
        return;
    };
    let Ok(mut watcher) = WATCHER.lock() else {
        return;
    };
    if watcher.is_none() {
        match new_debouncer(SETTLE_TIME, handle_changes) {
            Ok(debouncer) => *watcher = Some(debouncer),
            Err(err) => {
                log::error!("[watch-folders] Could not watch folders: {}", err);
                return;
            }
        }
    }
    let Some(debouncer) = watcher.as_mut() else {
        return;
    };

    // Folders no longer watched (removed, turned off, or moved to another path)
    states.retain(|state| {
        let is_kept = folders.contains(&state.folder);
        if !is_kept {
            let _ = debouncer.watcher().unwatch(&state.real_path);
        }
        is_kept
    });
    for folder in folders {
        if states.iter().any(|state| state.folder == folder) {
            continue;
        }
        let Ok(real_path) = std::fs::canonicalize(&folder.path) else {
            log::warn!("[watch-folders] Could not find {}", folder.path);
            continue;
        };
        if let Err(err) = debouncer
            .watcher()
            .watch(&real_path, RecursiveMode::NonRecursive)
        {
            log::warn!("[watch-folders] Could not watch {}: {}", folder.path, err);
            continue;
        }
        log::info!("[watch-folders] Watching {}", folder.path);
        states.push(FolderState {
            known: files_in(&real_path),
            folder,
            real_path,
        });
    }
}

/// Whether a file is media that can be compressed (by its extension)
fn is_supported(path: &str) -> bool {
    let Some(extension) = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
    else {
        return false;
    };
    SUPPORTED_EXTENSIONS
        .lock()
        .map(|extensions| extensions.contains(&extension))
        .unwrap_or(false)
}

/// Hidden files & files still being downloaded
fn is_temporary(path: &Path) -> bool {
    let is_hidden = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_none_or(|name| name.starts_with('.') || name.starts_with('~'));
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase())
        .unwrap_or_default();
    is_hidden || TEMPORARY_EXTENSIONS.contains(&extension.as_str())
}

/// Files of the watched folders that changed & then settled: the new ones are queued
fn handle_changes(result: DebounceEventResult) {
    let Some(app_handle) = APP_HANDLE.get() else {
        return;
    };
    let Ok(events) = result else {
        return;
    };
    // Its media is compressed by the menu bar's window (the main window, on Linux)
    #[cfg(any(target_os = "macos", windows))]
    if app_handle
        .tray_by_id(crate::tray_popover::TRAY_WINDOW_LABEL)
        .is_none()
    {
        return;
    }

    let mut queued: Vec<(WatchedFolder, String)> = Vec::new();
    {
        let Ok(mut states) = FOLDERS.lock() else {
            return;
        };
        for event in events {
            // Still being written (changes kept coming), handled once it settles
            if event.kind != DebouncedEventKind::Any {
                continue;
            }
            let path = event.path;
            let Some(state) = states
                .iter_mut()
                .find(|state| path.parent() == Some(state.real_path.as_path()))
            else {
                continue;
            };
            // Removed (or moved away): a new file of the same name is handled again
            if !path.is_file() {
                state.known.remove(&path);
                continue;
            }
            if state.known.contains(&path) || is_temporary(&path) {
                continue;
            }
            // Empty for now (e.g. just created), handled once written
            if std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) == 0 {
                continue;
            }
            state.known.insert(path.clone());
            // The app's own output (e.g. saved into this folder, or renamed or copied there)
            if crate::sys::output_registry::is_output(app_handle, &path) {
                continue;
            }
            queued.push((state.folder.clone(), path.to_string_lossy().to_string()));
        }
    }

    for (folder, path) in queued {
        log::info!("[watch-folders] New media in {}: {}", folder.path, path);
        crate::tauri_commands::drop_queue::add_to_queue_from(
            app_handle,
            vec![path],
            is_supported,
            Some(crate::tauri_commands::drop_queue::QueueSource {
                folder_id: folder.id,
                folder_name: folder.name,
            }),
        );
    }
}
