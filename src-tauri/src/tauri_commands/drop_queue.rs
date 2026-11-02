//! Queue of the media dropped on the menu bar (or copied, with the clipboard watching) while
//! "Compress automatically" is on. It is compressed one by one, in the order the media was added,
//! by the menu bar popover; the queue is kept here, so every window shows the same queue.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

static IS_AUTO_COMPRESS_ENABLED: AtomicBool = AtomicBool::new(false);
/// No new media is compressed (the media being compressed finishes)
static IS_PAUSED: AtomicBool = AtomicBool::new(false);

/// Sent to every window when the queue is paused or resumed
const DROP_QUEUE_PAUSED_EVENT: &str = "drop-queue-paused-changed";

fn set_paused(app_handle: &AppHandle, paused: bool) {
    if IS_PAUSED.swap(paused, Ordering::SeqCst) != paused {
        let _ = app_handle.emit(DROP_QUEUE_PAUSED_EVENT, paused);
    }
}

/// Pauses the queue after the media being compressed, or resumes it
#[tauri::command]
pub fn set_drop_queue_paused(app_handle: AppHandle, paused: bool) {
    set_paused(&app_handle, paused);
}

#[tauri::command]
pub fn is_drop_queue_paused() -> bool {
    IS_PAUSED.load(Ordering::SeqCst)
}
/// Increases each time media is queued for compression (added or tried again)
static QUEUE_ORDER: AtomicU64 = AtomicU64::new(0);

fn next_queue_order() -> u64 {
    QUEUE_ORDER.fetch_add(1, Ordering::SeqCst)
}

/// Sent to every window with the whole queue when it changes
const DROP_QUEUE_EVENT: &str = "drop-queue-changed";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DropQueueItemStatus {
    Waiting,
    Compressing,
    Done,
    Failed,
    /// Stopped (while compressing) or never compressed, with `cancel_drop_queue`
    Cancelled,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DropQueueItem {
    pub id: String,
    pub path: String,
    /// Folder of the file relative to the dropped folder (e.g. `Vacation/Day1`), empty for a file
    /// that was dropped directly
    pub relative_dir: String,
    /// Media added together (e.g. the files of a dropped folder) share it
    pub group_id: String,
    /// The run of compressions it belongs to, which the menu bar's progress is measured over:
    /// media added (or tried again) while the queue is compressing joins its batch, media added
    /// once it is done starts a new one, from 0%
    #[serde(skip)]
    pub batch_id: String,
    pub status: DropQueueItemStatus,
    /// The media is compressed in this order (the lowest first), while the queue keeps the order
    /// it was added in: media tried again is compressed after the media already waiting, but stays
    /// in its place
    pub queue_order: u64,
    /// 0 to 100, while compressing
    pub progress: f64,
    pub original_size: Option<u64>,
    pub output_size: Option<u64>,
    /// Where the output was saved
    pub saved_path: Option<String>,
    /// The output in the app's cache, when it was not saved (e.g. larger than the original);
    /// deleted when the item is cleared
    pub output_path: Option<String>,
    /// Why it failed, or was not saved (e.g. larger than the original)
    pub message: Option<String>,
    /// It failed as the system did not allow opening it (e.g. macOS privacy settings)
    pub is_access_denied: bool,
    /// It was compressed, but its preset asks where to save, which nothing in the queue can
    pub needs_save_location: bool,
    /// The watched folder it landed in (see `watch_folders`); `None` for media dropped, pasted or
    /// copied, which is compressed first
    pub watch_folder_id: Option<String>,
    /// That folder's name, shown with it
    pub watch_folder_name: Option<String>,
    /// The command line job it belongs to (see `cli_server`), with that job's preset & output
    /// settings; `None` for media added in the app
    pub cli_job: Option<CliJob>,
    /// Why it failed or was not saved, for the command line (`larger`, `noSaveLocation`,
    /// `saveFailed`, `accessDenied`, `compressFailed`); `message` is the same, translated
    pub reason: Option<String>,
    /// The error it failed with, as the command line shows it
    pub error: Option<String>,
}

/// A command line job's choices (see `cli_server`): each setting left out follows the app
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliJob {
    #[serde(default)]
    pub job_id: String,
    /// The preset of each media type, by id; a media type without one uses its default preset
    #[serde(default)]
    pub preset_ids: CliPresetIds,
    /// Saved here instead of the preset's save location
    #[serde(default)]
    pub output_folder: Option<String>,
    #[serde(default)]
    pub skip_larger_outputs: Option<bool>,
    #[serde(default)]
    pub preserve_folder_structure: Option<bool>,
    #[serde(default)]
    pub replace_original_files: Option<bool>,
    #[serde(default)]
    pub file_name_prefix: Option<String>,
    #[serde(default)]
    pub use_hardware_acceleration: Option<bool>,
    #[serde(default)]
    pub reach_target_sizes_without_acceleration: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CliPresetIds {
    #[serde(default)]
    pub video: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub audio: Option<String>,
}

/// Where queued media came from, when not dropped: a watched folder
pub struct QueueSource {
    pub folder_id: String,
    pub folder_name: String,
}

/// Changes to an item, from the popover compressing it
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DropQueueItemUpdate {
    pub status: Option<DropQueueItemStatus>,
    pub progress: Option<f64>,
    pub original_size: Option<u64>,
    pub output_size: Option<u64>,
    pub saved_path: Option<String>,
    pub output_path: Option<String>,
    pub message: Option<String>,
    pub is_access_denied: Option<bool>,
    pub needs_save_location: Option<bool>,
    pub reason: Option<String>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct DropQueueState(Mutex<Vec<DropQueueItem>>);

pub fn is_auto_compress_enabled() -> bool {
    IS_AUTO_COMPRESS_ENABLED.load(Ordering::SeqCst)
}

/// Changes the queue & sends it to every window
fn update_queue(app_handle: &AppHandle, update: impl FnOnce(&mut Vec<DropQueueItem>)) {
    let items = {
        let Some(state) = app_handle.try_state::<DropQueueState>() else {
            return;
        };
        let Ok(mut items) = state.0.lock() else {
            return;
        };
        update(&mut items);
        items.clone()
    };
    show_queue_progress(app_handle, &items);
    // Nothing left to resume (e.g. cleared), so media added next is compressed
    if !items.iter().any(is_active) {
        set_paused(app_handle, false);
        // An app started by the command line quits once it is done
        crate::sys::cli_server::schedule_quit_check(app_handle, std::time::Duration::from_secs(2));
    }
    // To the command line jobs waiting on their media (see `cli_server`)
    let _ = queue_channel().send(items.clone());
    let _ = app_handle.emit(DROP_QUEUE_EVENT, items);
}

/// Sends the whole queue each time it changes, to whoever listens (see `subscribe`)
fn queue_channel() -> &'static tokio::sync::broadcast::Sender<Vec<DropQueueItem>> {
    static CHANNEL: std::sync::OnceLock<tokio::sync::broadcast::Sender<Vec<DropQueueItem>>> =
        std::sync::OnceLock::new();
    CHANNEL.get_or_init(|| tokio::sync::broadcast::channel(256).0)
}

/// The queue, each time it changes
pub fn subscribe() -> tokio::sync::broadcast::Receiver<Vec<DropQueueItem>> {
    queue_channel().subscribe()
}

fn is_active(item: &DropQueueItem) -> bool {
    matches!(
        item.status,
        DropQueueItemStatus::Waiting | DropQueueItemStatus::Compressing
    )
}

/// The batch the queue is compressing, if it is (see `DropQueueItem::batch_id`)
fn active_batch_id(items: &[DropQueueItem]) -> Option<String> {
    items
        .iter()
        .find(|item| is_active(item))
        .map(|item| item.batch_id.clone())
}

/// Shows the progress of the queue on the menu bar icon (unless the main window is compressing,
/// which shows its own), cleared once nothing is waiting
fn show_queue_progress(app_handle: &AppHandle, items: &[DropQueueItem]) {
    if crate::tauri_commands::compression_status::is_compressing(app_handle) {
        return;
    }
    // Only the media of the batch being compressed, not that of the batches done before it
    let progress = if let Some(batch_id) = active_batch_id(items) {
        let batch_items: Vec<&DropQueueItem> = items
            .iter()
            .filter(|item| item.batch_id == batch_id)
            .collect();
        let total: f64 = batch_items
            .iter()
            .map(|item| match item.status {
                DropQueueItemStatus::Done
                | DropQueueItemStatus::Failed
                | DropQueueItemStatus::Cancelled => 100.0,
                DropQueueItemStatus::Compressing => item.progress,
                DropQueueItemStatus::Waiting => 0.0,
            })
            .sum();
        // At least a little, so the progress shows from the start
        (total / batch_items.len() as f64).max(1.0)
    } else {
        0.0
    };
    #[cfg(any(target_os = "macos", windows))]
    let _ = crate::tray_popover::set_tray_progress(app_handle, progress);
    // No tray icon on Linux (the main window shows the queue)
    #[cfg(target_os = "linux")]
    let _ = progress;
}

/// Adds media to the end of the queue (folders are added as the media they contain), in order.
/// Media already waiting or being compressed is not added again.
pub fn add_to_queue(app_handle: &AppHandle, paths: Vec<String>, is_supported: impl Fn(&str) -> bool) {
    add_to_queue_from(app_handle, paths, is_supported, None);
}

/// `add_to_queue`, for media from a watched folder (`source`)
pub fn add_to_queue_from(
    app_handle: &AppHandle,
    paths: Vec<String>,
    is_supported: impl Fn(&str) -> bool,
    source: Option<QueueSource>,
) {
    let files = match crate::tauri_commands::fs::allow_asset_scopes(app_handle, paths) {
        Ok(files) => files,
        Err(err) => {
            log::error!("[drop-queue] Could not read the added media: {}", err);
            return;
        }
    };
    let files = files
        .into_iter()
        .filter(|file| {
            let is_file_supported = is_supported(&file.path);
            if !is_file_supported {
                log::info!("[drop-queue] Skipped unsupported media: {}", file.path);
            }
            is_file_supported
        })
        .collect();
    // Media dropped by the user: an app started by the command line now stays open
    if source.is_none() {
        crate::sys::cli_server::keep_app_open();
    }
    add_files_to_queue(app_handle, files, source, None);
}

/// Adds media to the end of the queue, in order: from a watched folder (`source`), for a command
/// line job (`cli_job`), or dropped. Media already waiting or being compressed is not added again,
/// except for a command line job, which waits for its own media. Returns the items added.
pub fn add_files_to_queue(
    app_handle: &AppHandle,
    files: Vec<crate::core::domain::CollectedFile>,
    source: Option<QueueSource>,
    cli_job: Option<CliJob>,
) -> Vec<DropQueueItem> {
    let group_id = nanoid!();
    // The tray webview compresses the queue (the main window, on Linux or without the tray icon)
    #[cfg(any(target_os = "macos", windows))]
    crate::tray_popover::ensure_tray_window(app_handle);
    log::info!("[drop-queue] Adding {} media", files.len());
    let mut added = Vec::new();
    update_queue(app_handle, |items| {
        let batch_id = active_batch_id(items).unwrap_or_else(|| nanoid!());
        for file in files {
            let is_queued = cli_job.is_none()
                && items.iter().any(|item| {
                    item.path == file.path
                        && matches!(
                            item.status,
                            DropQueueItemStatus::Waiting | DropQueueItemStatus::Compressing
                        )
                });
            if is_queued {
                continue;
            }
            let item = DropQueueItem {
                id: nanoid!(),
                path: file.path,
                relative_dir: file.relative_dir,
                group_id: group_id.clone(),
                batch_id: batch_id.clone(),
                status: DropQueueItemStatus::Waiting,
                queue_order: next_queue_order(),
                progress: 0.0,
                original_size: None,
                output_size: None,
                saved_path: None,
                output_path: None,
                message: None,
                is_access_denied: false,
                needs_save_location: false,
                watch_folder_id: source.as_ref().map(|source| source.folder_id.clone()),
                watch_folder_name: source.as_ref().map(|source| source.folder_name.clone()),
                cli_job: cli_job.clone(),
                reason: None,
                error: None,
            };
            added.push(item.clone());
            items.push(item);
        }
    });
    added
}

/// Turns compressing automatically on or off (the setting is kept by the frontend)
#[tauri::command]
pub fn set_auto_compress_enabled(enabled: bool) {
    IS_AUTO_COMPRESS_ENABLED.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub fn get_drop_queue(app_handle: AppHandle) -> Vec<DropQueueItem> {
    app_handle
        .try_state::<DropQueueState>()
        .and_then(|state| state.0.lock().ok().map(|items| items.clone()))
        .unwrap_or_default()
}

#[tauri::command]
pub fn update_drop_queue_item(app_handle: AppHandle, id: String, update: DropQueueItemUpdate) {
    update_queue(&app_handle, |items| {
        let Some(item) = items.iter_mut().find(|item| item.id == id) else {
            return;
        };
        // A cancelled compression ends with an error, which must not replace the status
        if item.status == DropQueueItemStatus::Cancelled {
            return;
        }
        if let Some(status) = update.status {
            item.status = status;
        }
        if let Some(progress) = update.progress {
            item.progress = progress.clamp(0.0, 100.0);
        }
        if update.original_size.is_some() {
            item.original_size = update.original_size;
        }
        if update.output_size.is_some() {
            item.output_size = update.output_size;
        }
        if update.saved_path.is_some() {
            item.saved_path = update.saved_path;
        }
        if update.output_path.is_some() {
            item.output_path = update.output_path;
        }
        if update.message.is_some() {
            item.message = update.message;
        }
        if let Some(is_access_denied) = update.is_access_denied {
            item.is_access_denied = is_access_denied;
        }
        if let Some(needs_save_location) = update.needs_save_location {
            item.needs_save_location = needs_save_location;
        }
        if update.reason.is_some() {
            item.reason = update.reason;
        }
        if update.error.is_some() {
            item.error = update.error;
        }
    });
}

/// Compresses an item again (e.g. one that failed or was cancelled), after the media already
/// waiting; it stays in its place in the queue
#[tauri::command]
pub fn retry_drop_queue_item(app_handle: AppHandle, id: String) {
    update_queue(&app_handle, |items| {
        let batch_id = active_batch_id(items).unwrap_or_else(|| nanoid!());
        let Some(item) = items.iter_mut().find(|item| item.id == id) else {
            return;
        };
        item.batch_id = batch_id;
        item.status = DropQueueItemStatus::Waiting;
        item.queue_order = next_queue_order();
        item.progress = 0.0;
        item.output_size = None;
        item.saved_path = None;
        item.message = None;
        item.is_access_denied = false;
        item.needs_save_location = false;
        item.reason = None;
        item.error = None;
        delete_unsaved_output(item);
    });
}

/// Deletes the output an item left in the app's cache (not saved), if any. Only the queue's own
/// outputs are deleted, never others (e.g. the main window's).
fn delete_unsaved_output(item: &mut DropQueueItem) {
    if let Some(output_path) = item.output_path.take() {
        let _ = std::fs::remove_file(output_path);
    }
}

/// Removes an item that is not being compressed (& its unsaved output)
#[tauri::command]
pub fn remove_drop_queue_item(app_handle: AppHandle, id: String) {
    update_queue(&app_handle, |items| {
        items.retain_mut(|item| {
            if item.id != id || item.status == DropQueueItemStatus::Compressing {
                return true;
            }
            delete_unsaved_output(item);
            false
        })
    });
}

/// Removes the items that are done, failed or cancelled (& their unsaved outputs)
#[tauri::command]
pub fn clear_finished_drop_queue(app_handle: AppHandle) {
    update_queue(&app_handle, |items| {
        items.retain_mut(|item| {
            let is_pending = matches!(
                item.status,
                DropQueueItemStatus::Waiting | DropQueueItemStatus::Compressing
            );
            if !is_pending {
                delete_unsaved_output(item);
            }
            is_pending
        })
    });
}

/// Whether media of the queue is waiting or being compressed (e.g. to confirm quitting)
pub fn is_queue_active(app_handle: &AppHandle) -> bool {
    app_handle
        .try_state::<DropQueueState>()
        .and_then(|state| {
            state.0.lock().ok().map(|items| {
                items.iter().any(|item| {
                    matches!(
                        item.status,
                        DropQueueItemStatus::Waiting | DropQueueItemStatus::Compressing
                    )
                })
            })
        })
        .unwrap_or(false)
}

/// Cancels the queue: stops the media being compressed, and marks it & the waiting media as
/// cancelled (kept in the queue, so it shows what was not compressed)
#[tauri::command]
pub fn cancel_drop_queue(app_handle: AppHandle) {
    // Stopped, so nothing is left to resume
    set_paused(&app_handle, false);
    cancel_items(&app_handle, |_| true);
}

/// Cancels the media of a command line job that is waiting or being compressed
pub fn cancel_cli_job(app_handle: &AppHandle, job_id: &str) {
    cancel_items(app_handle, |item| {
        item.cli_job
            .as_ref()
            .is_some_and(|job| job.job_id == job_id)
    });
}

/// Stops the matching media being compressed, and marks it & the matching waiting media as
/// cancelled
fn cancel_items(app_handle: &AppHandle, matches: impl Fn(&DropQueueItem) -> bool) {
    let mut compressing_ids: Vec<String> = Vec::new();
    update_queue(app_handle, |items| {
        for item in items.iter_mut().filter(|item| matches(item)) {
            match item.status {
                DropQueueItemStatus::Waiting => {}
                DropQueueItemStatus::Compressing => compressing_ids.push(item.id.clone()),
                _ => continue,
            }
            item.status = DropQueueItemStatus::Cancelled;
            item.progress = 0.0;
        }
    });
    // The queue item's id is its compression's batch id (see `-queue.ts`)
    if !compressing_ids.is_empty() {
        let _ = app_handle.emit(
            crate::core::domain::CustomEvents::CancelInProgressCompression.as_ref(),
            // See `CancelInProgressCompressionPayload`
            serde_json::json!({ "ids": compressing_ids }),
        );
    }
}
