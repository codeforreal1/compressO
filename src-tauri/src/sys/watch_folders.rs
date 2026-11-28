//! Watched folders (Settings -> Watched folders): media that lands in them (e.g. a new screen
//! recording or download) is added to the drop zone's queue, after the media dropped on it (see
//! `drop_queue`), whether or not the drop zone compresses automatically. The menu bar's window
//! compresses it (the main window, on Linux, while it is open). The system tells when files change
//! (FSEvents on macOS, ReadDirectoryChangesW on Windows, inotify on Linux), through `notify`:
//! - in the folder & its subfolders (hidden ones aside), also media in a folder moved or copied in,
//!   of which the system may only tell the folder
//! - only media added after a folder is watched (what is already in it is left alone)
//! - only once complete: a file is handled once it has not changed for a moment, & temporary files
//!   (hidden ones, partial downloads) are skipped until they are renamed
//! - never the app's own outputs, even renamed, moved or copied (see `output_registry`)

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

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

/// A file's size & last change, to tell a file put back or replaced under a known name from the
/// one already handled
type FileStamp = (u64, Option<SystemTime>);

fn file_stamp(path: &Path) -> Option<FileStamp> {
    std::fs::metadata(path)
        .ok()
        .map(|metadata| (metadata.len(), metadata.modified().ok()))
}

/// A folder being watched: its real path (as the system reports changes), & the files in it & its
/// subfolders that are already handled (or were there when it started being watched), as they were
struct FolderState {
    folder: WatchedFolder,
    real_path: PathBuf,
    known: HashMap<PathBuf, FileStamp>,
}

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static FOLDERS: Mutex<Vec<FolderState>> = Mutex::new(Vec::new());
/// The extensions of the media that can be compressed, set by the frontend
static SUPPORTED_EXTENSIONS: Mutex<Vec<String>> = Mutex::new(Vec::new());
static WATCHER: Mutex<Option<Debouncer<RecommendedWatcher>>> = Mutex::new(None);

/// All extensions CompressO can pick up in watched folders.
const ALL_WATCHED_EXTENSIONS: [&str; 35] = [
    "mp4", "mov", "mkv", "webm", "avi", "ts", "gif", "m4v", "mts", "m2ts", "png", "jpg", "jpeg",
    "webp", "svg", "avif", "jxl", "heic", "heif", "bmp", "tiff", "tif", "mp3", "m4a", "wav",
    "flac", "ogg", "opus", "aac", "m4b", "aiff", "aif", "wma", "oga", "mp2",
];

fn folder_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string())
}

/// Synchronizes OS folder watchers directly from `core::settings` + `core::presets` without any WebView.
pub fn sync_from_core(app_handle: &AppHandle) {
    if APP_HANDLE.get().is_none() || crate::sys::cli_server::is_launched_for_cli() {
        return;
    }
    let settings = crate::core::settings::get(app_handle);
    let presets = crate::core::presets::get(app_handle);
    let folders: Vec<WatchedFolder> = settings
        .watched_folders
        .iter()
        .filter(|folder| {
            folder.is_enabled && crate::core::planning::can_watched_folder_save(folder, &presets, &settings)
        })
        .map(|folder| WatchedFolder {
            id: folder.id.clone(),
            path: folder.path.clone(),
            name: folder_display_name(&folder.path),
        })
        .collect();
    let extensions = ALL_WATCHED_EXTENSIONS
        .iter()
        .map(|ext| (*ext).to_string())
        .collect();
    set_watched_folders(folders, extensions);
}

/// Keeps the app, to queue media from the system's changes
pub fn init(app_handle: &AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
    sync_from_core(app_handle);
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

/// The files in a folder & its subfolders, but not in hidden folders (e.g. `.git`) nor through
/// symlinked folders (possible loops)
fn files_in(path: &Path) -> HashSet<PathBuf> {
    let mut files = HashSet::new();
    let mut folders = vec![path.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let entry_path = entry.path();
            if file_type.is_dir() {
                if !is_hidden(&entry_path) {
                    folders.push(entry_path);
                }
            } else if entry_path.is_file() {
                files.insert(entry_path);
            }
        }
    }
    files
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

    // The same path may be sent twice (e.g. by two windows), or kept twice by an older app: watch
    // each path once, keeping the first folder (& updating its id/name on the state)
    let mut unique_folders: Vec<WatchedFolder> = Vec::new();
    for folder in folders {
        if unique_folders
            .iter()
            .any(|watched| watched.path == folder.path)
        {
            continue;
        }
        unique_folders.push(folder);
    }

    // Folders no longer watched (removed, turned off, or moved to another path)
    let watched_paths: HashSet<&str> = unique_folders
        .iter()
        .map(|folder| folder.path.as_str())
        .collect();
    let mut kept_paths: HashSet<String> = HashSet::new();
    states.retain(|state| {
        if !watched_paths.contains(state.folder.path.as_str()) {
            let _ = debouncer.watcher().unwatch(&state.real_path);
            return false;
        }
        // A state for this path is already kept: do not unwatch the path it shares
        kept_paths.insert(state.folder.path.clone())
    });
    for folder in unique_folders {
        // The same path, with another id or name (e.g. changed by the command line): keep its watch
        if let Some(state) = states
            .iter_mut()
            .find(|state| state.folder.path == folder.path)
        {
            state.folder = folder;
            continue;
        }
        let Ok(real_path) = std::fs::canonicalize(&folder.path) else {
            log::warn!("[watch-folders] Could not find {}", folder.path);
            continue;
        };
        if let Err(err) = debouncer
            .watcher()
            .watch(&real_path, RecursiveMode::Recursive)
        {
            log::warn!("[watch-folders] Could not watch {}: {}", folder.path, err);
            continue;
        }
        log::info!("[watch-folders] Watching {}", folder.path);
        states.push(FolderState {
            known: files_in(&real_path)
                .into_iter()
                .filter_map(|path| file_stamp(&path).map(|stamp| (path, stamp)))
                .collect(),
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

/// A hidden file or folder (or a temporary one, e.g. `~$report.docx`)
fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_none_or(|name| name.starts_with('.') || name.starts_with('~'))
}

/// Hidden files & files still being downloaded
fn is_temporary(path: &Path) -> bool {
    let is_hidden = is_hidden(path);
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
                .find(|state| path.starts_with(&state.real_path) && path != state.real_path)
            else {
                continue;
            };
            // In a hidden folder (e.g. `.git`), or a hidden file
            let is_in_hidden_folder = path
                .strip_prefix(&state.real_path)
                .map(|relative| {
                    relative
                        .parent()
                        .into_iter()
                        .flat_map(|parent| parent.components())
                        .any(|component| is_hidden(Path::new(component.as_os_str())))
                })
                .unwrap_or(true);
            if is_in_hidden_folder {
                continue;
            }
            // A folder moved or copied in: the system may only tell the folder, so its media is
            // looked for in it (files still being written are left to their own changes)
            if path.is_dir() {
                if is_hidden(&path) {
                    continue;
                }
                let mut files: Vec<PathBuf> = files_in(&path).into_iter().collect();
                files.sort();
                for file in files {
                    if is_settled(&file) {
                        if let Some(file) = take_new_file(app_handle, state, file) {
                            queued.push((state.folder.clone(), file));
                        }
                    }
                }
                continue;
            }
            // Removed (or moved away), also a folder: a new file of the same name is handled again
            if !path.exists() {
                state.known.retain(|known, _| !known.starts_with(&path));
                continue;
            }
            if let Some(file) = take_new_file(app_handle, state, path) {
                queued.push((state.folder.clone(), file));
            }
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

/// Whether a file has not changed for `SETTLE_TIME` (or its time cannot be read)
fn is_settled(path: &Path) -> bool {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_none_or(|elapsed| elapsed >= SETTLE_TIME)
}

/// A file of a watched folder to queue, once: new (or put back or replaced under a known name),
/// complete & not the app's own output
fn take_new_file(app_handle: &AppHandle, state: &mut FolderState, path: PathBuf) -> Option<String> {
    if !path.is_file() || is_temporary(&path) {
        return None;
    }
    let stamp = file_stamp(&path)?;
    if state.known.get(&path) == Some(&stamp) {
        return None;
    }
    // Empty for now (e.g. just created), handled once written
    if stamp.0 == 0 {
        return None;
    }
    state.known.insert(path.clone(), stamp);
    // The app's own output (e.g. saved into this folder, or renamed or copied there)
    if crate::sys::output_registry::is_output(app_handle, &path) {
        return None;
    }
    Some(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What a watched folder starts from: its files at every depth, but not in hidden folders
    #[test]
    fn finds_files_at_every_depth() {
        let root = std::env::temp_dir().join(format!("compresso-watch-{}", std::process::id()));
        std::fs::create_dir_all(root.join("inside/deep-inside/deeper")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        for file in [
            "a.jpg",
            "inside/b.jpg",
            "inside/deep-inside/c.mp4",
            "inside/deep-inside/deeper/d.mp3",
            ".git/e.jpg",
        ] {
            std::fs::write(root.join(file), b"x").unwrap();
        }

        let mut files: Vec<String> = files_in(&root)
            .into_iter()
            .map(|path| {
                path.strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        files.sort();
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(
            files,
            [
                "a.jpg",
                "inside/b.jpg",
                "inside/deep-inside/c.mp4",
                "inside/deep-inside/deeper/d.mp3",
            ]
        );
    }
}
