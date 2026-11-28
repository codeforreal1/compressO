//! Central main-window session tracking & `active-session.json` persistence in `app_data_dir`.
//!
//! Enables tmux/rix-style detach & reattach for the main GUI compression workflow:
//! - Closing `"main"` destroys only the WebView (freeing memory) while `core` continues encoding.
//! - On macOS, the Dock icon stays visible with progress badge while a detached compression runs;
//!   clicking it (`RunEvent::Reopen`) or relaunching on Windows/Linux (`on_second_instance`)
//!   reattaches `"main"` to the live session.
//! - When a detached job finishes with manual save (`Auto-Save OFF` / `Ask` / skipped larger
//!   outputs), `active-session.json` persists inputs + cache temp outputs so reopening CompressO
//!   resumes straight at the completed Save / Compare / Clips screen and allows clean idle exit.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Listener, Manager};

use crate::core::domain::{
    BatchMediaCompressionProgress, BatchMediaIndividualCompressionResult, CustomEvents,
    MediaCompressionProgress, MediaCompressionResult,
};
use crate::core::planning::{
    self, apply_file_name_template, preset_name_for_template, resolve_preset_output,
    ResolvedPresetOutput,
};
use crate::core::presets::PresetsStoreData;
use crate::core::settings::{DomainSettings, SaveLocation};
use crate::sys::fs::ensure_assets_dir;
use crate::sys::history::{self, HistoryEntry};
use crate::tauri_commands::compression_status::{
    update_compression_status, CompressionState, CompressionStatus,
};
use crate::tauri_commands::dock::{clear_dock_badge, set_dock_progress};
use crate::tauri_commands::fs::{copy_files_to_clipboard, get_available_path, move_file, ClipboardFile};

const FILE_NAME: &str = "active-session.json";
pub const MAIN_SESSION_COMPLETED_EVENT: &str = "main-session-completed";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MainSessionStatus {
    Compressing,
    Completed,
    Cancelled,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MainSessionItemInfo {
    pub id: String,
    pub media_type: String,
    pub path_raw: String,
    pub file_name: String,
    pub source_extension: String,
    #[serde(default)]
    pub relative_dir: String,
    #[serde(default)]
    pub size_in_bytes: Option<u64>,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub output_duration_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
    pub batch_id: String,
    pub status: MainSessionStatus,
    #[serde(default)]
    pub is_paused: bool,
    #[serde(default)]
    pub detached: bool,
    /// Remains `true` once the originating main window detached during this batch so natural
    /// completion is still finalized in Rust even after the user reopens the window.
    #[serde(default)]
    pub ever_detached: bool,
    #[serde(default)]
    pub items: Vec<MainSessionItemInfo>,
    pub app_state: Value,
    #[serde(default)]
    pub progress: HashMap<String, f64>,
    #[serde(default)]
    pub results: HashMap<String, MediaCompressionResult>,
    #[serde(default)]
    pub has_unsaved_output: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StartMainSessionPayload {
    pub batch_id: String,
    pub items: Vec<MainSessionItemInfo>,
    pub app_state: Value,
}

static SESSION_STATE: Mutex<Option<ActiveSession>> = Mutex::new(None);
static LOADED_FROM_DISK: Mutex<bool> = Mutex::new(false);
static LISTENER_INSTALLED: OnceLock<()> = OnceLock::new();

fn store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

fn write_session_file(app_handle: &AppHandle, session: &ActiveSession) -> Result<(), String> {
    let Some(path) = store_path(app_handle) else {
        return Ok(());
    };
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn remove_session_file(app_handle: &AppHandle) {
    if let Some(path) = store_path(app_handle) {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn parse_duration_ms(text: &str) -> f64 {
    let parts: Vec<&str> = text.trim().split(':').collect();
    let mut seconds = 0.0;
    for part in parts {
        let Ok(val) = part.parse::<f64>() else {
            return 0.0;
        };
        seconds = seconds * 60.0 + val;
    }
    seconds * 1000.0
}

fn collect_session_asset_paths(session: &ActiveSession) -> Vec<PathBuf> {
    let mut raw_paths: Vec<&str> = session
        .items
        .iter()
        .map(|item| item.path_raw.as_str())
        .collect();
    if let Some(media) = session.app_state.get("media").and_then(|v| v.as_array()) {
        for item in media {
            for key in ["pathRaw", "thumbnailPathRaw"] {
                if let Some(p) = item.get(key).and_then(|v| v.as_str()) {
                    raw_paths.push(p);
                }
            }
            if let Some(cf) = item.get("compressedFile") {
                for key in ["pathRaw", "savedPath"] {
                    if let Some(p) = cf.get(key).and_then(|v| v.as_str()) {
                        raw_paths.push(p);
                    }
                }
                if let Some(clips) = cf.get("clips").and_then(|v| v.as_array()) {
                    for clip in clips {
                        for key in ["pathRaw", "savedPath"] {
                            if let Some(p) = clip.get(key).and_then(|v| v.as_str()) {
                                raw_paths.push(p);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut unique = HashSet::new();
    let mut paths = Vec::new();
    for raw in raw_paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = if trimmed.as_bytes().get(1) == Some(&b':') && trimmed.contains("\\\\") {
            let mut next = trimmed.to_string();
            while next.contains("\\\\") {
                next = next.replace("\\\\", "\\");
            }
            next
        } else {
            trimmed.to_string()
        };
        let path = PathBuf::from(&normalized);
        if path.is_absolute() && unique.insert(path.clone()) {
            paths.push(path);
        }
        let raw_path = PathBuf::from(trimmed);
        if raw_path.is_absolute() && unique.insert(raw_path.clone()) {
            paths.push(raw_path);
        }
    }
    paths
}

fn allow_session_asset_paths(app_handle: &AppHandle, session: &ActiveSession) {
    use tauri_plugin_fs::FsExt;
    let fs_scope = app_handle.fs_scope();
    let asset_scope = app_handle.asset_protocol_scope();
    for path in collect_session_asset_paths(session) {
        let _ = fs_scope.allow_file(&path);
        let _ = asset_scope.allow_file(&path);
    }
}

fn load_from_disk_if_needed(app_handle: &AppHandle) {
    let mut loaded_flag = LOADED_FROM_DISK.lock().unwrap();
    if *loaded_flag {
        return;
    }
    *loaded_flag = true;
    drop(loaded_flag);

    let Some(path) = store_path(app_handle) else {
        return;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut session) = serde_json::from_str::<ActiveSession>(&raw) else {
        let _ = std::fs::remove_file(&path);
        return;
    };
    // A session persisted before exit cannot still be running FFmpeg in this new process:
    // if it wasn't completed with unsaved outputs, drop stale state.
    if session.status != MainSessionStatus::Completed || !session.has_unsaved_output {
        let _ = std::fs::remove_file(&path);
        return;
    }
    allow_session_asset_paths(app_handle, &session);
    session.detached = false;
    session.is_paused = false;
    if let Ok(mut guard) = SESSION_STATE.lock() {
        if guard.is_none() {
            *guard = Some(session);
        }
    }
}

/// Installs global event listeners once so detached progress & results keep `SESSION_STATE` updated.
pub fn init(app_handle: &AppHandle) {
    load_from_disk_if_needed(app_handle);
    LISTENER_INSTALLED.get_or_init(|| {
        let progress_app = app_handle.clone();
        app_handle.listen_any(
            CustomEvents::BatchMediaCompressionProgress.as_ref(),
            move |evt| {
                let Ok(payload) =
                    serde_json::from_str::<BatchMediaCompressionProgress>(evt.payload())
                else {
                    return;
                };
                let status_to_emit = {
                    let Ok(mut guard) = SESSION_STATE.lock() else {
                        return;
                    };
                    let Some(session) = guard.as_mut() else {
                        return;
                    };
                    if session.batch_id != payload.batch_id
                        || session.status != MainSessionStatus::Compressing
                    {
                        return;
                    }
                    let (media_id, pct) = match &payload.media_progress {
                        MediaCompressionProgress::Video(v) => {
                            let dur = session
                                .items
                                .iter()
                                .find(|i| i.id == v.video_id)
                                .map(|i| i.output_duration_ms)
                                .unwrap_or(0.0);
                            let pct = if dur > 0.0 {
                                (parse_duration_ms(&v.current_duration) * 100.0 / dur)
                                    .clamp(0.0, 100.0)
                            } else {
                                0.0
                            };
                            (v.video_id.clone(), pct)
                        }
                        MediaCompressionProgress::Image(img) => {
                            (img.image_id.clone(), (img.progress as f64).clamp(0.0, 100.0))
                        }
                    };
                    session.progress.insert(media_id, pct);
                    if !session.detached {
                        return;
                    }
                    let count = session.items.len().max(1) as f64;
                    let total_progress: f64 = session
                        .items
                        .iter()
                        .map(|i| session.progress.get(&i.id).copied().unwrap_or(0.0))
                        .sum();
                    let avg = (total_progress / count).clamp(0.0, 100.0);
                    let file_name = if session.items.len() == 1 {
                        Some(session.items[0].file_name.clone())
                    } else {
                        None
                    };
                    Some((
                        avg,
                        CompressionStatus {
                            state: CompressionState::Compressing,
                            progress: avg.round(),
                            media_count: session.items.len(),
                            file_name,
                            has_unsaved_output: false,
                            is_paused: session.is_paused,
                        },
                    ))
                };
                if let Some((avg, status)) = status_to_emit {
                    let _ = set_dock_progress(progress_app.clone(), avg);
                    update_compression_status(&progress_app, status);
                }
            },
        );

        app_handle.listen_any(
            CustomEvents::BatchMediaIndividualCompressionCompletion.as_ref(),
            move |evt| {
                let Ok(payload) =
                    serde_json::from_str::<BatchMediaIndividualCompressionResult>(evt.payload())
                else {
                    return;
                };
                let Ok(mut guard) = SESSION_STATE.lock() else {
                    return;
                };
                let Some(session) = guard.as_mut() else {
                    return;
                };
                if session.batch_id != payload.batch_id {
                    return;
                }
                let media_id = match &payload.result {
                    MediaCompressionResult::Video(v) => v.video_id.clone(),
                    MediaCompressionResult::Image(i) => i.image_id.clone(),
                };
                session.progress.insert(media_id.clone(), 100.0);
                session.results.insert(media_id, payload.result);
            },
        );
    });
}

pub fn is_session_compressing() -> bool {
    SESSION_STATE
        .lock()
        .ok()
        .and_then(|g| {
            g.as_ref()
                .map(|s| s.status == MainSessionStatus::Compressing)
        })
        .unwrap_or(false)
}

pub fn has_session_unsaved_output() -> bool {
    SESSION_STATE
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.has_unsaved_output))
        .unwrap_or(false)
}

pub fn mark_detached(app_handle: &AppHandle) {
    init(app_handle);
    let Ok(mut guard) = SESSION_STATE.lock() else {
        return;
    };
    if let Some(session) = guard.as_mut() {
        if session.status == MainSessionStatus::Compressing {
            session.detached = true;
            session.ever_detached = true;
            let _ = write_session_file(app_handle, session);
        }
    }
}

pub fn sync_pause_state(batch_id: &str, paused: bool) {
    if let Ok(mut guard) = SESSION_STATE.lock() {
        if let Some(session) = guard.as_mut() {
            if session.batch_id == batch_id {
                session.is_paused = paused;
            }
        }
    }
}

/// Temp cache paths currently belonging to an active or completed-unsaved session, protected from
/// scheduled stale-cache cleanup.
pub fn protected_paths(app_handle: &AppHandle) -> HashSet<PathBuf> {
    init(app_handle);
    let mut protected = HashSet::new();
    let Ok(guard) = SESSION_STATE.lock() else {
        return protected;
    };
    let Some(session) = guard.as_ref() else {
        return protected;
    };
    for result in session.results.values() {
        match result {
            MediaCompressionResult::Video(v) => {
                protected.insert(PathBuf::from(&v.file_path));
                for o in &v.other_outputs {
                    protected.insert(PathBuf::from(&o.file_path));
                }
                for c in &v.clips {
                    protected.insert(PathBuf::from(&c.file_path));
                }
            }
            MediaCompressionResult::Image(i) => {
                protected.insert(PathBuf::from(&i.file_path));
            }
        }
    }
    if let Some(media) = session.app_state.get("media").and_then(|v| v.as_array()) {
        for item in media {
            if let Some(thumb) = item.get("thumbnailPathRaw").and_then(|v| v.as_str()) {
                protected.insert(PathBuf::from(thumb));
            }
            if let Some(cf) = item.get("compressedFile").and_then(|v| v.as_object()) {
                if let Some(p) = cf.get("pathRaw").and_then(|v| v.as_str()) {
                    protected.insert(PathBuf::from(p));
                }
                if let Some(clips) = cf.get("clips").and_then(|v| v.as_array()) {
                    for clip in clips {
                        if let Some(p) = clip.get("pathRaw").and_then(|v| v.as_str()) {
                            protected.insert(PathBuf::from(p));
                        }
                    }
                }
                if let Some(opts) = cf.get("options").and_then(|v| v.as_array()) {
                    for opt in opts {
                        if let Some(p) = opt.get("pathRaw").and_then(|v| v.as_str()) {
                            protected.insert(PathBuf::from(p));
                        }
                    }
                }
            }
        }
    }
    protected
}

#[tauri::command]
pub fn get_active_session(app_handle: AppHandle) -> Option<ActiveSession> {
    init(&app_handle);
    let mut reattached_completed = false;
    let session = {
        let mut guard = SESSION_STATE.lock().ok()?;
        let session = guard.as_mut()?;
        if session.detached && app_handle.get_webview_window("main").is_some() {
            // The user reopened the UI; clear `detached` so background progress stops overriding
            // the open window and cancelling does not wipe completed partial outputs.
            session.detached = false;
            reattached_completed = session.status == MainSessionStatus::Completed;
        }
        session.clone()
    };
    if reattached_completed {
        update_compression_status(&app_handle, Default::default());
    }
    allow_session_asset_paths(&app_handle, &session);
    Some(session)
}

#[tauri::command]
pub fn start_main_session(
    app_handle: AppHandle,
    payload: StartMainSessionPayload,
) -> Result<(), String> {
    init(&app_handle);
    remove_session_file(&app_handle);
    let session = ActiveSession {
        batch_id: payload.batch_id,
        status: MainSessionStatus::Compressing,
        is_paused: false,
        detached: false,
        ever_detached: false,
        items: payload.items,
        app_state: payload.app_state,
        progress: HashMap::new(),
        results: HashMap::new(),
        has_unsaved_output: false,
    };
    if let Ok(mut guard) = SESSION_STATE.lock() {
        *guard = Some(session);
    }
    Ok(())
}

#[tauri::command]
pub fn update_main_session_state(
    app_handle: AppHandle,
    app_state: Value,
    has_unsaved_output: bool,
) -> Result<(), String> {
    init(&app_handle);
    let mut to_persist: Option<ActiveSession> = None;
    let should_clear = {
        let Ok(mut guard) = SESSION_STATE.lock() else {
            return Ok(());
        };
        if let Some(session) = guard.as_mut() {
            session.app_state = app_state;
            session.has_unsaved_output = has_unsaved_output;
            session.status = MainSessionStatus::Completed;
            session.detached = false;
            if has_unsaved_output {
                to_persist = Some(session.clone());
                false
            } else {
                *guard = None;
                true
            }
        } else if has_unsaved_output {
            let created = ActiveSession {
                batch_id: app_state
                    .get("batchId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                status: MainSessionStatus::Completed,
                is_paused: false,
                detached: false,
                ever_detached: false,
                items: Vec::new(),
                app_state,
                progress: HashMap::new(),
                results: HashMap::new(),
                has_unsaved_output: true,
            };
            to_persist = Some(created.clone());
            *guard = Some(created);
            false
        } else {
            true
        }
    };
    if should_clear {
        remove_session_file(&app_handle);
    } else if let Some(session) = to_persist {
        write_session_file(&app_handle, &session)?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_active_session(app_handle: AppHandle) {
    if let Ok(mut guard) = SESSION_STATE.lock() {
        *guard = None;
    }
    remove_session_file(&app_handle);
}

fn output_file_name(original_name: &str, output_ext: Option<&str>) -> String {
    match output_ext.filter(|ext| !ext.is_empty()) {
        Some(ext) => {
            let (stem, _) = planning::split_file_name(original_name);
            format!("{stem}.{ext}")
        }
        None => original_name.to_string(),
    }
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return String::from("0 B");
    }
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut idx = 0usize;
    while size >= 1024.0 && idx < UNITS.len() - 1 {
        size /= 1024.0;
        idx += 1;
    }
    if idx == 0 {
        format!("{bytes} B")
    } else {
        format!("{size:.2} {}", UNITS[idx])
    }
}

fn build_compressed_file_value(
    item: &MainSessionItemInfo,
    media_item_val: &Value,
    result: &MediaCompressionResult,
) -> Option<Value> {
    let original_stem = planning::split_file_name(&item.file_name).0;
    match result {
        MediaCompressionResult::Video(v) => {
            let mut clips_json = Vec::new();
            let mut total_clip_size = 0u64;
            for clip in &v.clips {
                let meta = clip.file_metadata.as_ref();
                let ext = meta.map(|m| m.extension.as_str()).unwrap_or("");
                let name = if original_stem.is_empty() {
                    format!(
                        "Clip {}{}",
                        clip.index,
                        if ext.is_empty() {
                            String::new()
                        } else {
                            format!(".{ext}")
                        }
                    )
                } else {
                    format!(
                        "{original_stem} - Clip {}{}",
                        clip.index,
                        if ext.is_empty() {
                            String::new()
                        } else {
                            format!(".{ext}")
                        }
                    )
                };
                let size = meta.map(|m| m.size).unwrap_or(0);
                total_clip_size += size;
                let path_raw = meta
                    .map(|m| m.path.clone())
                    .unwrap_or_else(|| clip.file_path.clone());
                clips_json.push(json!({
                    "index": clip.index,
                    "startSeconds": clip.start_seconds,
                    "endSeconds": clip.end_seconds,
                    "fileName": meta.map(|m| m.file_name.as_str()).unwrap_or(clip.file_name.as_str()),
                    "fileNameToDisplay": name,
                    "pathRaw": path_raw,
                    "path": path_raw,
                    "mimeType": meta.map(|m| m.mime_type.as_str()),
                    "sizeInBytes": size,
                    "size": format_bytes(size),
                    "extension": ext,
                    "isSaved": false,
                }));
            }
            let meta = v.file_metadata.as_ref()?;
            let size_bytes = if !clips_json.is_empty() {
                total_clip_size
            } else {
                meta.size
            };
            let primary_path = clips_json
                .first()
                .and_then(|c| c.get("pathRaw").and_then(|p| p.as_str()))
                .unwrap_or(&meta.path);
            let primary_name = clips_json
                .first()
                .and_then(|c| c.get("fileNameToDisplay").and_then(|n| n.as_str()))
                .map(str::to_string)
                .unwrap_or_else(|| output_file_name(&item.file_name, Some(&meta.extension)));

            let mut obj = json!({
                "isSuccessful": true,
                "fileName": clips_json.first().and_then(|c| c.get("fileName").and_then(|v| v.as_str())).unwrap_or(&meta.file_name),
                "fileNameToDisplay": primary_name,
                "pathRaw": primary_path,
                "path": primary_path,
                "mimeType": meta.mime_type,
                "sizeInBytes": size_bytes,
                "size": format_bytes(size_bytes),
                "extension": meta.extension,
                "isSaved": false,
            });
            if !clips_json.is_empty() {
                obj["clips"] = Value::Array(clips_json);
            }
            if !v.other_outputs.is_empty() {
                let mut opts: Vec<Value> = std::iter::once(json!({
                    "pathRaw": meta.path,
                    "sizeInBytes": meta.size,
                }))
                .chain(v.other_outputs.iter().map(|o| {
                    json!({
                        "pathRaw": o.file_path,
                        "sizeInBytes": o.size,
                    })
                }))
                .collect();
                opts.sort_by_key(|o| o["sizeInBytes"].as_u64().unwrap_or(0));
                obj["options"] = Value::Array(opts);
                if let Some(mb) = media_item_val
                    .get("config")
                    .and_then(|c| c.get("targetSizeInMB"))
                    .and_then(|v| v.as_f64())
                {
                    obj["targetSizeInBytes"] = json!((mb * 1_000_000.0).floor() as u64);
                }
            }
            Some(obj)
        }
        MediaCompressionResult::Image(i) => {
            let meta = i.file_metadata.as_ref()?;
            Some(json!({
                "isSuccessful": true,
                "fileName": i.file_name,
                "fileNameToDisplay": output_file_name(&item.file_name, Some(&meta.extension)),
                "pathRaw": meta.path,
                "path": meta.path,
                "mimeType": meta.mime_type,
                "sizeInBytes": meta.size,
                "size": format_bytes(meta.size),
                "extension": meta.extension,
                "isSaved": false,
            }))
        }
    }
}

fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn save_session_outputs_headless(
    app_handle: &AppHandle,
    session: &mut ActiveSession,
    settings: &DomainSettings,
    presets: &PresetsStoreData,
) {
    let mut top_folders: HashMap<String, String> = HashMap::new();
    let mut last_saved_path: Option<String> = None;
    let Some(media_arr) = session
        .app_state
        .get_mut("media")
        .and_then(|v| v.as_array_mut())
    else {
        return;
    };

    for media_val in media_arr.iter_mut() {
        let id = media_val
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let original_path = media_val
            .get("pathRaw")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let original_size = media_val
            .get("sizeInBytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let relative_dir = media_val
            .get("relativeDir")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let preset_id = media_val
            .get("config")
            .and_then(|c| c.get("presetId"))
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let resolved: ResolvedPresetOutput =
            resolve_preset_output(preset_id.as_deref(), presets, settings);
        if !resolved.saves_automatically() {
            continue;
        }

        let Some(cf) = media_val
            .get("compressedFile")
            .and_then(|v| v.as_object())
            .cloned()
        else {
            continue;
        };
        if cf.get("isSuccessful").and_then(|v| v.as_bool()) != Some(true)
            || cf.get("isSaved").and_then(|v| v.as_bool()) == Some(true)
        {
            continue;
        }

        let out_size = cf.get("sizeInBytes").and_then(|v| v.as_u64()).unwrap_or(0);
        if !settings.save_larger_outputs && original_size > 0 && out_size > original_size {
            continue;
        }

        let is_fixed = resolved.save_location == SaveLocation::FixedFolder;
        let base_dir = if is_fixed {
            resolved.save_folder.clone().unwrap_or_default()
        } else {
            Path::new(&original_path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default()
        };

        let mut dest_dir = PathBuf::from(&base_dir);
        if is_fixed && settings.preserve_folder_structure && !relative_dir.is_empty() {
            let mut parts = relative_dir.split('/');
            let top = parts.next().unwrap_or("");
            if !top.is_empty() {
                let key = format!("{base_dir}\n{top}");
                let dest_top = if let Some(cached) = top_folders.get(&key) {
                    cached.clone()
                } else {
                    let cand = PathBuf::from(&base_dir)
                        .join(top)
                        .to_string_lossy()
                        .to_string();
                    match get_available_path(&cand, true).await {
                        Ok(avail) => {
                            top_folders.insert(key, avail.clone());
                            avail
                        }
                        Err(_) => continue,
                    }
                };
                let mut dir = PathBuf::from(dest_top);
                for sub in parts {
                    if !sub.is_empty() {
                        dir.push(sub);
                    }
                }
                dest_dir = dir;
            }
        }

        let template_preset = preset_name_for_template(preset_id.as_deref(), presets);
        let replace_orig = if settings.replace_original_files {
            Some(original_path.clone())
        } else {
            None
        };

        let has_clips = cf
            .get("clips")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty());

        if has_clips {
            let mut clips_arr = cf.get("clips").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let mut first_saved: Option<String> = None;
            let mut all_saved = true;
            for clip in clips_arr.iter_mut() {
                if clip.get("isSaved").and_then(|v| v.as_bool()) == Some(true) {
                    continue;
                }
                let src = clip
                    .get("pathRaw")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = clip
                    .get("fileNameToDisplay")
                    .or_else(|| clip.get("fileName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let target_name = apply_file_name_template(
                    &name,
                    Some(&resolved.file_name_template),
                    Some(&template_preset),
                );
                let target = dest_dir.join(&target_name);
                match move_file(
                    app_handle.clone(),
                    &src,
                    &target.to_string_lossy(),
                    replace_orig.clone(),
                )
                .await
                {
                    Ok(moved) => {
                        if first_saved.is_none() {
                            first_saved = Some(moved.path.clone());
                        }
                        clip["savedPath"] = json!(moved.path);
                        clip["isSaved"] = json!(true);
                        clip["replacedOriginal"] = json!(moved.replaced_original);
                    }
                    Err(_) => {
                        all_saved = false;
                    }
                }
            }
            if let Some(cf_mut) = media_val.get_mut("compressedFile").and_then(|v| v.as_object_mut()) {
                cf_mut.insert(String::from("clips"), Value::Array(clips_arr));
                cf_mut.insert(String::from("isSaved"), json!(all_saved));
                if let Some(first) = first_saved {
                    cf_mut.insert(String::from("savedPath"), json!(first.clone()));
                    last_saved_path = Some(first);
                }
            }
            let _ = id;
        } else {
            let src = cf
                .get("pathRaw")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if src.is_empty() {
                continue;
            }
            let display_name = cf
                .get("fileNameToDisplay")
                .or_else(|| media_val.get("fileName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let target_name = apply_file_name_template(
                &display_name,
                Some(&resolved.file_name_template),
                Some(&template_preset),
            );
            let target = dest_dir.join(&target_name);
            if let Ok(moved) = move_file(
                app_handle.clone(),
                &src,
                &target.to_string_lossy(),
                replace_orig,
            )
            .await
            {
                if let Some(cf_mut) = media_val.get_mut("compressedFile").and_then(|v| v.as_object_mut()) {
                    cf_mut.insert(String::from("savedPath"), json!(moved.path));
                    cf_mut.insert(String::from("replacedOriginal"), json!(moved.replaced_original));
                    cf_mut.insert(String::from("isSaved"), json!(true));
                }
                last_saved_path = Some(moved.path);
            }
        }
    }
    if let Some(saved_path) = last_saved_path {
        session.app_state["savedPath"] = json!(saved_path);
    }

    // Record history for main window batch
    let item_contracts: HashMap<String, Value> = session
        .items
        .iter()
        .filter_map(|item| item.contract.clone().map(|c| (item.id.clone(), c)))
        .collect();
    let completed_at = now_epoch_ms();
    let mut history_entries = Vec::new();
    if let Some(media_arr) = session.app_state.get_mut("media").and_then(|v| v.as_array_mut()) {
        for media_val in media_arr.iter_mut() {
            let media_id = media_val
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let orig_path = media_val
                .get("pathRaw")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if orig_path.is_empty() {
                continue;
            }
            let orig_size = media_val.get("sizeInBytes").and_then(|v| v.as_u64());
            let rel_dir = media_val
                .get("relativeDir")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let folder_name = if rel_dir.is_empty() {
                None
            } else {
                rel_dir.split('/').next().map(str::to_string)
            };
            let is_audio = media_val
                .get("isAudioFile")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mtype = if media_val.get("type").and_then(|v| v.as_str()) == Some("image") {
                "image"
            } else if is_audio {
                "audio"
            } else {
                "video"
            };
            let preset_id = media_val
                .get("config")
                .and_then(|c| c.get("presetId"))
                .and_then(|v| v.as_str());
            let preset_name = preset_id
                .filter(|id| *id != "standard")
                .and_then(|id| presets.presets.iter().find(|p| p.id == id))
                .map(|p| p.name.clone());
            let item_contract = item_contracts.get(&media_id).cloned();

            let Some(cf) = media_val
                .get_mut("compressedFile")
                .and_then(|v| v.as_object_mut())
        else {
                continue;
            };
            if cf.get("isSuccessful").and_then(|v| v.as_bool()) != Some(true) {
                continue;
            }

            if let Some(clips) = cf.get_mut("clips").and_then(|v| v.as_array_mut()) {
                if !clips.is_empty() {
                    for clip in clips.iter_mut() {
                        let idx = clip.get("index").and_then(|v| v.as_u64()).unwrap_or(1);
                        let cid = format!("{}:{}:clip-{}", session.batch_id, media_id, idx);
                        clip["historyId"] = json!(cid);
                        history_entries.push(HistoryEntry {
                            id: cid,
                            completed_at,
                            media_type: String::from("video"),
                            source: String::from("main"),
                            watch_folder_name: None,
                            group_id: Some(session.batch_id.clone()),
                            folder_name: folder_name.clone(),
                            relative_dir: if rel_dir.is_empty() {
                                None
                            } else {
                                Some(rel_dir.clone())
                            },
                            original_path: orig_path.clone(),
                            original_size: if idx == 1 { orig_size } else { None },
                            output_path: if clip.get("isSaved").and_then(|v| v.as_bool())
                                == Some(true)
                            {
                                clip.get("savedPath")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string)
                            } else {
                                None
                            },
                            output_size: clip.get("sizeInBytes").and_then(|v| v.as_u64()),
                            preset_name: preset_name.clone(),
                            contract: item_contract.clone(),
                        });
                    }
                    continue;
                }
            }

            let hid = format!("{}:{}", session.batch_id, media_id);
            cf.insert(String::from("historyId"), json!(hid));
            history_entries.push(HistoryEntry {
                id: hid,
                completed_at,
                media_type: String::from(mtype),
                source: String::from("main"),
                watch_folder_name: None,
                group_id: Some(session.batch_id.clone()),
                folder_name,
                relative_dir: if rel_dir.is_empty() {
                    None
                } else {
                    Some(rel_dir)
                },
                original_path: orig_path,
                original_size: orig_size,
                output_path: if cf.get("isSaved").and_then(|v| v.as_bool()) == Some(true) {
                    cf.get("savedPath")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                } else {
                    None
                },
                output_size: cf.get("sizeInBytes").and_then(|v| v.as_u64()),
                preset_name,
                contract: item_contract,
            });
        }
    }
    if !history_entries.is_empty() {
        history::add_entries(app_handle, history_entries);
    }

    // Copy to clipboard if configured
    if settings.copy_output_to_clipboard {
        let media_count = session
            .app_state
            .get("media")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        if media_count == 1 || settings.copy_batch_output_to_clipboard {
            let mut clip_files: Vec<ClipboardFile> = Vec::new();
            if let Some(media_arr) = session.app_state.get("media").and_then(|v| v.as_array()) {
                for m in media_arr {
                    let Some(cf) = m.get("compressedFile").and_then(|v| v.as_object()) else {
                        continue;
                    };
                    if cf.get("isSuccessful").and_then(|v| v.as_bool()) != Some(true) {
                        continue;
                    }
                    if let Some(clips) = cf.get("clips").and_then(|v| v.as_array()) {
                        if !clips.is_empty() {
                            for clip in clips {
                                if let Some(sp) = clip.get("savedPath").and_then(|v| v.as_str()) {
                                    clip_files.push(ClipboardFile {
                                        path: sp.to_string(),
                                        file_name: None,
                                    });
                                } else if let Some(rp) = clip.get("pathRaw").and_then(|v| v.as_str()) {
                                    clip_files.push(ClipboardFile {
                                        path: rp.to_string(),
                                        file_name: clip
                                            .get("fileNameToDisplay")
                                            .and_then(|v| v.as_str())
                                            .map(str::to_string),
                                    });
                                }
                            }
                            continue;
                        }
                    }
                    if let Some(sp) = cf.get("savedPath").and_then(|v| v.as_str()) {
                        clip_files.push(ClipboardFile {
                            path: sp.to_string(),
                            file_name: None,
                        });
                    } else if let Some(rp) = cf.get("pathRaw").and_then(|v| v.as_str()) {
                        clip_files.push(ClipboardFile {
                            path: rp.to_string(),
                            file_name: cf
                                .get("fileNameToDisplay")
                                .and_then(|v| v.as_str())
                                .map(str::to_string),
                        });
                    }
                }
            }
            if !clip_files.is_empty() {
                let _ = copy_files_to_clipboard(app_handle.clone(), clip_files).await;
            }
        }
    }

    let _ = ensure_assets_dir(app_handle);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BatchFinishAction {
    /// Original main window session is still live and awaits `compress_media_batch`.
    SkipForLiveCaller,
    /// Open UI (including a reattached one) or already-completed session owns cancellation cleanup.
    SkipCancelForAttachedUi,
    /// Detached run finished in the background (or after reattach) and needs Rust finalization.
    FinalizeDetached,
}

fn classify_batch_finish(
    session: &ActiveSession,
    has_main_window: bool,
    batch_succeeded: bool,
) -> BatchFinishAction {
    if !session.detached && !session.ever_detached && has_main_window {
        return BatchFinishAction::SkipForLiveCaller;
    }
    if !batch_succeeded && (has_main_window || session.status == MainSessionStatus::Completed) {
        return BatchFinishAction::SkipCancelForAttachedUi;
    }
    BatchFinishAction::FinalizeDetached
}

/// Called when `compress_media_batch_headless` completes. If the session was detached (UI closed
/// during encoding), finalizes outputs/saving/history/sound/`active-session.json` in Rust and
/// exits cleanly once idle.
pub async fn on_batch_finished(
    app_handle: &AppHandle,
    batch_id: &str,
    batch_result: &Result<crate::core::domain::MediaBatchCompressionResult, String>,
) {
    let has_main_window = app_handle.get_webview_window("main").is_some();
    let (action, session_opt) = {
        let Ok(mut guard) = SESSION_STATE.lock() else {
            return;
        };
        let Some(session) = guard.as_mut() else {
            return;
        };
        if session.batch_id != batch_id {
            return;
        }
        let action = classify_batch_finish(session, has_main_window, batch_result.is_ok());
        match action {
            BatchFinishAction::SkipForLiveCaller => {
                if let Ok(res) = batch_result {
                    session.results = res.results.clone();
                }
                (action, None)
            }
            BatchFinishAction::SkipCancelForAttachedUi => (action, None),
            BatchFinishAction::FinalizeDetached => (action, Some(session.clone())),
        }
    };

    match action {
        BatchFinishAction::SkipForLiveCaller => return,
        BatchFinishAction::SkipCancelForAttachedUi => {
            if has_main_window {
                #[cfg(any(target_os = "macos", windows))]
                let _ = clear_dock_badge(app_handle.clone());
                update_compression_status(app_handle, Default::default());
            }
            return;
        }
        BatchFinishAction::FinalizeDetached => {}
    }

    let Some(mut session) = session_opt else {
        return;
    };

    let Ok(res) = batch_result else {
        clear_active_session(app_handle.clone());
        #[cfg(any(target_os = "macos", windows))]
        let _ = clear_dock_badge(app_handle.clone());
        update_compression_status(app_handle, Default::default());
        let _ = app_handle.emit(MAIN_SESSION_COMPLETED_EVENT, Option::<ActiveSession>::None);
        schedule_detached_idle_exit(app_handle);
        return;
    };

    session.results = res.results.clone();
    session.is_paused = false;
    session.status = MainSessionStatus::Completed;
    session.app_state["isCompressing"] = json!(false);
    session.app_state["isBatchPaused"] = json!(false);
    session.app_state["isProcessCompleted"] = json!(true);

    let items_snapshot = session.items.clone();
    let mut any_succeeded = false;
    if let Some(media_arr) = session
        .app_state
        .get_mut("media")
        .and_then(|v| v.as_array_mut())
    {
        for media_val in media_arr.iter_mut() {
            let id = media_val
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            media_val["isProcessCompleted"] = json!(true);
            media_val["isCompressing"] = json!(false);
            media_val["compressionProgress"] = json!(100);
            media_val["targetSizeRound"] = Value::Null;
            if let (Some(item_info), Some(item_res)) = (
                items_snapshot.iter().find(|i| i.id == id),
                session.results.get(&id),
            ) {
                if let Some(cf) = build_compressed_file_value(item_info, media_val, item_res) {
                    any_succeeded = true;
                    media_val["compressedFile"] = cf;
                }
            }
        }
    }

    let settings = crate::core::settings::get(app_handle);
    let presets = crate::core::presets::get(app_handle);
    if settings.play_completion_sound && any_succeeded {
        crate::tauri_commands::sound::play_completion_sound();
    }

    if any_succeeded {
        save_session_outputs_headless(app_handle, &mut session, &settings, &presets).await;
    }

    let has_unsaved = session
        .app_state
        .get("media")
        .and_then(|v| v.as_array())
        .is_some_and(|arr| {
            arr.iter().any(|m| {
                let cf = m.get("compressedFile").and_then(|v| v.as_object());
                cf.is_some_and(|c| {
                    c.get("isSuccessful").and_then(|v| v.as_bool()) == Some(true)
                        && c.get("isSaved").and_then(|v| v.as_bool()) != Some(true)
                })
            })
        });
    session.has_unsaved_output = has_unsaved;
    session.app_state["isSaved"] = json!(!has_unsaved);
    session.detached = false;

    #[cfg(any(target_os = "macos", windows))]
    let _ = clear_dock_badge(app_handle.clone());

    if has_unsaved {
        update_compression_status(
            app_handle,
            CompressionStatus {
                state: CompressionState::Completed,
                progress: 100.0,
                media_count: session.items.len(),
                file_name: if session.items.len() == 1 {
                    Some(session.items[0].file_name.clone())
                } else {
                    None
                },
                has_unsaved_output: true,
                is_paused: false,
            },
        );
        let _ = write_session_file(app_handle, &session);
        if let Ok(mut guard) = SESSION_STATE.lock() {
            *guard = Some(session.clone());
        }
        let _ = app_handle.emit(MAIN_SESSION_COMPLETED_EVENT, Some(session));
    } else {
        update_compression_status(app_handle, Default::default());
        clear_active_session(app_handle.clone());
        if app_handle.get_webview_window("main").is_some() {
            let _ = app_handle.emit(MAIN_SESSION_COMPLETED_EVENT, Some(session));
        } else {
            let _ = app_handle.emit(MAIN_SESSION_COMPLETED_EVENT, Option::<ActiveSession>::None);
        }
    }

    schedule_detached_idle_exit(app_handle);
}

/// If the main window is closed and no tray icon, active queue, or CLI connection keeps the
/// background process busy, exit cleanly once detached encoding settles.
pub fn schedule_detached_idle_exit(app_handle: &AppHandle) {
    let app = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let has_main = app.get_webview_window("main").is_some();
        #[cfg(any(target_os = "macos", windows))]
        let has_tray = app
            .tray_by_id(crate::tray_popover::TRAY_WINDOW_LABEL)
            .is_some();
        #[cfg(target_os = "linux")]
        let has_tray = false;

        if !has_main
            && !has_tray
            && !is_session_compressing()
            && !crate::tauri_commands::drop_queue::is_queue_active(&app)
            && !crate::sys::cli_server::has_connections()
            && !crate::sys::cli_server::is_launched_for_cli()
        {
            log::info!("[session] Detached work completed with no open windows or tray; exiting cleanly");
            app.exit(0);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_paths_collects_results_and_app_state_paths() {
        let mut results = HashMap::new();
        results.insert(
            String::from("v1"),
            MediaCompressionResult::Image(crate::core::domain::ImageCompressionResult {
                image_id: String::from("v1"),
                file_name: String::from("out.webp"),
                file_path: String::from("/tmp/cache/out.webp"),
                file_metadata: None,
                is_target_size_reached: None,
            }),
        );
        let session = ActiveSession {
            batch_id: String::from("b1"),
            status: MainSessionStatus::Completed,
            is_paused: false,
            detached: false,
            ever_detached: false,
            items: Vec::new(),
            app_state: json!({
                "media": [{
                    "thumbnailPathRaw": "/tmp/cache/thumb.png",
                    "compressedFile": { "pathRaw": "/tmp/cache/vid.mp4" }
                }]
            }),
            progress: HashMap::new(),
            results,
            has_unsaved_output: true,
        };
        let mut protected = HashSet::new();
        for res in session.results.values() {
            if let MediaCompressionResult::Image(i) = res {
                protected.insert(PathBuf::from(&i.file_path));
            }
        }
        assert!(protected.contains(&PathBuf::from("/tmp/cache/out.webp")));
    }

    #[test]
    fn session_file_persists_completed_unsaved_outputs_and_skips_stale_sessions() {
        let dir = std::env::temp_dir().join(format!("compresso-session-test-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(FILE_NAME);

        let completed = ActiveSession {
            batch_id: String::from("b-unsaved"),
            status: MainSessionStatus::Completed,
            is_paused: false,
            detached: false,
            ever_detached: false,
            items: Vec::new(),
            app_state: json!({
                "batchId": "b-unsaved",
                "isProcessCompleted": true,
                "isSaved": false,
                "media": [{ "id": "m1", "compressedFile": { "isSuccessful": true, "isSaved": false, "pathRaw": "/tmp/fake.mp4" } }]
            }),
            progress: HashMap::new(),
            results: HashMap::new(),
            has_unsaved_output: true,
        };
        std::fs::write(&file, serde_json::to_string_pretty(&completed).unwrap()).unwrap();
        let parsed: ActiveSession =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(parsed.batch_id, "b-unsaved");
        assert_eq!(parsed.status, MainSessionStatus::Completed);
        assert!(parsed.has_unsaved_output);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_session_asset_paths_restores_input_and_output_paths() {
        #[cfg(windows)]
        let (src_raw, src, thumb, out_p, clip_p) = (
            "C:\\\\tmp\\\\source.mp4",
            "C:\\tmp\\source.mp4",
            "C:\\tmp\\thumb.jpg",
            "C:\\tmp\\out.mp4",
            "C:\\tmp\\clip-1.mp4",
        );
        #[cfg(not(windows))]
        let (src_raw, src, thumb, out_p, clip_p) = (
            "/tmp/source.mp4",
            "/tmp/source.mp4",
            "/tmp/thumb.jpg",
            "/tmp/out.mp4",
            "/tmp/clip-1.mp4",
        );
        let session = ActiveSession {
            batch_id: String::from("b-paths"),
            status: MainSessionStatus::Completed,
            is_paused: false,
            detached: false,
            ever_detached: false,
            items: vec![MainSessionItemInfo {
                id: String::from("v1"),
                media_type: String::from("video"),
                path_raw: String::from(src_raw),
                file_name: String::from("source.mp4"),
                source_extension: String::from("mp4"),
                relative_dir: String::new(),
                size_in_bytes: Some(100),
                preset_id: None,
                output_duration_ms: 1000.0,
                contract: None,
            }],
            app_state: json!({
                "media": [{
                    "id": "v1",
                    "pathRaw": src_raw,
                    "thumbnailPathRaw": thumb,
                    "compressedFile": {
                        "pathRaw": out_p,
                        "clips": [{ "pathRaw": clip_p }]
                    }
                }]
            }),
            progress: HashMap::new(),
            results: HashMap::new(),
            has_unsaved_output: true,
        };
        let collected = collect_session_asset_paths(&session);
        assert!(collected.contains(&PathBuf::from(src)));
        assert!(collected.contains(&PathBuf::from(thumb)));
        assert!(collected.contains(&PathBuf::from(out_p)));
        assert!(collected.contains(&PathBuf::from(clip_p)));
    }

    fn dummy_session(
        status: MainSessionStatus,
        detached: bool,
        ever_detached: bool,
    ) -> ActiveSession {
        ActiveSession {
            batch_id: String::from("b-test"),
            status,
            is_paused: false,
            detached,
            ever_detached,
            items: Vec::new(),
            app_state: json!({}),
            progress: HashMap::new(),
            results: HashMap::new(),
            has_unsaved_output: false,
        }
    }

    #[test]
    fn reattached_cancel_keeps_partial_outputs_instead_of_clearing_session() {
        // After closing and reopening the main window (`detached == false`, `ever_detached == true`),
        // cancelling must NOT clear the session or reset the UI (`FinalizeDetached` on Err).
        let reattached = dummy_session(MainSessionStatus::Compressing, false, true);
        assert_eq!(
            classify_batch_finish(&reattached, true, false),
            BatchFinishAction::SkipCancelForAttachedUi
        );

        // Even if the UI immediately completed partial outputs (`Completed`) before closing,
        // `on_batch_finished` must preserve that completed-unsaved session.
        let finalized_by_ui = dummy_session(MainSessionStatus::Completed, true, true);
        assert_eq!(
            classify_batch_finish(&finalized_by_ui, false, false),
            BatchFinishAction::SkipCancelForAttachedUi
        );

        // When the user does NOT cancel after reopening and the batch finishes normally, Rust
        // still finalizes results/auto-save because the original caller promise disappeared on close.
        assert_eq!(
            classify_batch_finish(&reattached, true, true),
            BatchFinishAction::FinalizeDetached
        );

        // Non-detached live window keeps delegating completion/cancel to StartCompression.
        let live = dummy_session(MainSessionStatus::Compressing, false, false);
        assert_eq!(
            classify_batch_finish(&live, true, true),
            BatchFinishAction::SkipForLiveCaller
        );
        assert_eq!(
            classify_batch_finish(&live, true, false),
            BatchFinishAction::SkipForLiveCaller
        );

        // Truly detached error while main window is still closed finalizes/clears in Rust.
        let detached = dummy_session(MainSessionStatus::Compressing, true, true);
        assert_eq!(
            classify_batch_finish(&detached, false, false),
            BatchFinishAction::FinalizeDetached
        );
    }
}
