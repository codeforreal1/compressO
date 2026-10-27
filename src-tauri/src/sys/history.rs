//! The history of compressions (Settings -> History): what was compressed, where from (the main
//! window, the drop zone or a watched folder), & where the original & the output were then. The
//! paths are kept as they were (files may be moved or deleted later; see `paths_exist`). Kept in the
//! app's data folder, the latest ones up to a limit, & sent to every window when it changes.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// The most entries kept (the oldest are dropped)
const MAX_ENTRIES: usize = 20_000;

const FILE_NAME: &str = "history.json";

/// Sent to every window when the history changes
const HISTORY_EVENT: &str = "history-changed";

/// A compression, as recorded when it was done
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// When it was compressed (milliseconds since 1970)
    pub completed_at: i64,
    /// `video`, `image` or `audio`
    pub media_type: String,
    /// `main` (the main window), `dropZone` or `watchedFolder`
    pub source: String,
    #[serde(default)]
    pub watch_folder_name: Option<String>,
    /// Media compressed together (a batch, or a drop) share it
    #[serde(default)]
    pub group_id: Option<String>,
    /// The dropped folder it was in (e.g. `Vacation`), & its folder within it (e.g. `Vacation/Day1`)
    #[serde(default)]
    pub folder_name: Option<String>,
    #[serde(default)]
    pub relative_dir: Option<String>,
    pub original_path: String,
    #[serde(default)]
    pub original_size: Option<u64>,
    /// Where the output was saved (`None` while it is not, e.g. left for the Save button)
    #[serde(default)]
    pub output_path: Option<String>,
    #[serde(default)]
    pub output_size: Option<u64>,
    #[serde(default)]
    pub preset_name: Option<String>,
}

/// The entries, newest last (loaded from the data folder the first time they are used)
static ENTRIES: Mutex<Option<VecDeque<HistoryEntry>>> = Mutex::new(None);

fn store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

/// Changes the entries (loaded first if needed), then saves them & tells every window
fn update(app_handle: &AppHandle, change: impl FnOnce(&mut VecDeque<HistoryEntry>)) {
    let saved = {
        let Ok(mut entries) = ENTRIES.lock() else {
            return;
        };
        let entries = entries.get_or_insert_with(|| load(app_handle));
        change(entries);
        while entries.len() > MAX_ENTRIES {
            entries.pop_front();
        }
        serde_json::to_string(entries).ok()
    };
    if let (Some(text), Some(path)) = (saved, store_path(app_handle)) {
        if let Err(err) = std::fs::write(&path, text) {
            log::warn!("[history] Could not save the history: {}", err);
        }
    }
    let _ = app_handle.emit(HISTORY_EVENT, ());
}

fn load(app_handle: &AppHandle) -> VecDeque<HistoryEntry> {
    store_path(app_handle)
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<VecDeque<HistoryEntry>>(&text).ok())
        .unwrap_or_default()
}

/// Every entry, newest last
#[tauri::command]
pub fn get_history(app_handle: AppHandle) -> Vec<HistoryEntry> {
    ENTRIES
        .lock()
        .map(|mut entries| {
            entries
                .get_or_insert_with(|| load(&app_handle))
                .iter()
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// Records compressions (an entry with the id of one already recorded replaces it)
#[tauri::command]
pub fn add_history_entries(app_handle: AppHandle, entries: Vec<HistoryEntry>) {
    update(&app_handle, |stored| {
        for entry in entries {
            stored.retain(|existing| existing.id != entry.id);
            stored.push_back(entry);
        }
    });
}

/// Where an output was saved, once it is (e.g. with the Save button, after compressing)
#[tauri::command]
pub fn set_history_output(
    app_handle: AppHandle,
    id: String,
    output_path: String,
    output_size: Option<u64>,
) {
    update(&app_handle, |entries| {
        if let Some(entry) = entries.iter_mut().find(|entry| entry.id == id) {
            entry.output_path = Some(output_path);
            if output_size.is_some() {
                entry.output_size = output_size;
            }
        }
    });
}

#[tauri::command]
pub fn clear_history(app_handle: AppHandle) {
    update(&app_handle, |entries| entries.clear());
}

/// Whether each path still exists (files may have been moved or deleted since)
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|path| std::path::Path::new(path).exists())
        .collect()
}
