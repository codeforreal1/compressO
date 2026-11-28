//! The history of compressions (Settings -> History): what was compressed, where from (the main
//! window, the drop zone or a watched folder), & where the original & the output were then. The
//! paths are kept as they were (files may be moved or deleted later; see `paths_exist`). Kept in the
//! app's data folder, the latest ones up to a limit, & sent to every window when it changes.

use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
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
    /// Exact JSON Contract snapshot used for compression (`None` on legacy entries)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<serde_json::Value>,
}

/// The entries, newest last (loaded from the data folder the first time they are used)
static ENTRIES: Mutex<Option<VecDeque<HistoryEntry>>> = Mutex::new(None);
/// Monotonic counter incremented on every mutation so coalesced background writes never skip newer edits
static DIRTY_GENERATION: AtomicU64 = AtomicU64::new(0);
static FLUSHED_GENERATION: AtomicU64 = AtomicU64::new(0);
static FLUSH_SCHEDULED: AtomicBool = AtomicBool::new(false);
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

fn write_snapshot_atomic(app_handle: &AppHandle) {
    let _write_guard = match WRITE_LOCK.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let (generation, text) = {
        let dirty = DIRTY_GENERATION.load(Ordering::SeqCst);
        let flushed = FLUSHED_GENERATION.load(Ordering::SeqCst);
        if dirty == flushed {
            return;
        }
        let Ok(mut entries) = ENTRIES.lock() else {
            return;
        };
        let entries = entries.get_or_insert_with(|| load(app_handle));
        let Ok(serialized) = serde_json::to_string(entries) else {
            return;
        };
        (DIRTY_GENERATION.load(Ordering::SeqCst), serialized)
    };
    let Some(path) = store_path(app_handle) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp_path = path.with_extension("json.tmp");
    if let Err(err) = std::fs::write(&tmp_path, text) {
        log::warn!("[history] Could not write history temp file: {}", err);
        return;
    }
    if let Err(err) = std::fs::rename(&tmp_path, &path) {
        if let Err(fallback_err) = std::fs::write(&path, std::fs::read(&tmp_path).unwrap_or_default()) {
            log::warn!("[history] Could not save the history: {} ({})", err, fallback_err);
            let _ = std::fs::remove_file(&tmp_path);
            return;
        }
        let _ = std::fs::remove_file(&tmp_path);
    }
    FLUSHED_GENERATION.store(generation, Ordering::SeqCst);
}

fn schedule_flush(app_handle: &AppHandle) {
    if FLUSH_SCHEDULED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let app_for_write = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                write_snapshot_atomic(&app_for_write);
            })
            .await;
            if DIRTY_GENERATION.load(Ordering::SeqCst) == FLUSHED_GENERATION.load(Ordering::SeqCst)
            {
                FLUSH_SCHEDULED.store(false, Ordering::SeqCst);
                if DIRTY_GENERATION.load(Ordering::SeqCst)
                    == FLUSHED_GENERATION.load(Ordering::SeqCst)
                    || FLUSH_SCHEDULED
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_err()
                {
                    break;
                }
            }
        }
    });
}

/// Flushes any pending history mutations synchronously (called on app exit).
pub fn flush_blocking(app_handle: &AppHandle) {
    if DIRTY_GENERATION.load(Ordering::SeqCst) != FLUSHED_GENERATION.load(Ordering::SeqCst) {
        write_snapshot_atomic(app_handle);
    }
}

/// Changes the entries (loaded first if needed), then schedules a coalesced background write &
/// notifies windows immediately.
fn update(app_handle: &AppHandle, change: impl FnOnce(&mut VecDeque<HistoryEntry>)) {
    {
        let Ok(mut entries) = ENTRIES.lock() else {
            return;
        };
        let entries = entries.get_or_insert_with(|| load(app_handle));
        change(entries);
        while entries.len() > MAX_ENTRIES {
            entries.pop_front();
        }
        DIRTY_GENERATION.fetch_add(1, Ordering::SeqCst);
    }
    let _ = app_handle.emit(HISTORY_EVENT, ());
    schedule_flush(app_handle);
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

/// Records compressions directly from Rust (`queue_runner`), replacing any entry with the same id.
pub fn add_entries(app_handle: &AppHandle, entries: Vec<HistoryEntry>) {
    update(app_handle, |stored| {
        if entries.len() == 1 {
            let target_id = &entries[0].id;
            stored.retain(|existing| &existing.id != target_id);
        } else if entries.len() > 1 {
            let incoming_ids: HashSet<&str> = entries.iter().map(|e| e.id.as_str()).collect();
            stored.retain(|existing| !incoming_ids.contains(existing.id.as_str()));
        }
        for entry in entries {
            stored.push_back(entry);
        }
    });
}

/// Records compressions (an entry with the id of one already recorded replaces it)
#[tauri::command]
pub fn add_history_entries(app_handle: AppHandle, entries: Vec<HistoryEntry>) {
    add_entries(&app_handle, entries);
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

#[cfg(test)]
mod tests {
    use super::HistoryEntry;
    use serde_json::json;

    #[test]
    fn legacy_entries_without_contract_deserialize_and_contract_round_trips() {
        let legacy_json = json!({
            "id": "legacy-1",
            "completedAt": 1700000000000i64,
            "mediaType": "video",
            "source": "main",
            "originalPath": "/tmp/in.mp4",
            "outputPath": "/tmp/out.mp4"
        });
        let legacy: HistoryEntry = serde_json::from_value(legacy_json).unwrap();
        assert!(legacy.contract.is_none());
        let serialized_legacy = serde_json::to_value(&legacy).unwrap();
        assert!(serialized_legacy.get("contract").is_none());

        let with_contract = HistoryEntry {
            contract: Some(json!({ "version": 1, "mediaType": "video" })),
            ..legacy
        };
        let encoded = serde_json::to_string(&with_contract).unwrap();
        let decoded: HistoryEntry = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded.contract.unwrap()["mediaType"], "video");
    }
}
