//! Central domain settings persisted in `app_data_dir/settings.json` (shared across the GUI,
//! CLI, MCP server, and watched folders). UI-only appearance preferences (`theme`, `primaryColor`,
//! `tintedWindow`, `tintOpacity`, `language`) stay in frontend `localStorage` so the UI paints
//! without flash.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::{cpu_limit, domain::CustomEvents, hardware_encoder, presets};

const FILE_NAME: &str = "settings.json";
const SCHEMA_VERSION: u32 = 1;
const DEFAULT_FILE_NAME_TEMPLATE: &str = "compressO-{name}";
const DEFAULT_PRESET_CHOICE: &str = "default";

const UI_ONLY_KEYS: [&str; 5] = [
    "theme",
    "primaryColor",
    "tintedWindow",
    "tintOpacity",
    "language",
];

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SaveLocation {
    #[default]
    SameFolder,
    Ask,
    FixedFolder,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolderPresetIds {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredWatchedFolder {
    pub id: String,
    pub path: String,
    pub is_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preset_ids: Option<WatchedFolderPresetIds>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct DomainSettings {
    pub output_file_name_template: String,
    pub save_location: SaveLocation,
    pub save_folder: Option<String>,
    pub preserve_folder_structure: bool,
    pub save_larger_outputs: bool,
    pub replace_original_files: bool,
    pub copy_output_to_clipboard: bool,
    pub copy_batch_output_to_clipboard: bool,
    pub show_menu_bar_icon: bool,
    pub watch_clipboard: bool,
    pub play_completion_sound: bool,
    pub enable_audio_waveforms: bool,
    pub auto_compress: bool,
    pub drop_zone_video_preset_id: String,
    pub drop_zone_image_preset_id: String,
    pub drop_zone_audio_preset_id: String,
    pub watched_folders: Vec<StoredWatchedFolder>,
    pub use_hardware_acceleration: bool,
    pub cpu_thread_limit: Option<usize>,
    pub retry_target_size_on_cpu: bool,
    pub enable_video_previews: bool,
    pub prevent_sleep_while_compressing: bool,
    pub keep_screen_on_while_compressing: bool,
    pub open_in_menu_bar_only: bool,
}

impl Default for DomainSettings {
    fn default() -> Self {
        Self {
            output_file_name_template: String::from(DEFAULT_FILE_NAME_TEMPLATE),
            save_location: SaveLocation::SameFolder,
            save_folder: None,
            preserve_folder_structure: true,
            save_larger_outputs: true,
            replace_original_files: false,
            copy_output_to_clipboard: false,
            copy_batch_output_to_clipboard: true,
            show_menu_bar_icon: true,
            watch_clipboard: false,
            play_completion_sound: false,
            enable_audio_waveforms: true,
            auto_compress: true,
            drop_zone_video_preset_id: String::from(DEFAULT_PRESET_CHOICE),
            drop_zone_image_preset_id: String::from(DEFAULT_PRESET_CHOICE),
            drop_zone_audio_preset_id: String::from(DEFAULT_PRESET_CHOICE),
            watched_folders: Vec::new(),
            use_hardware_acceleration: false,
            cpu_thread_limit: None,
            retry_target_size_on_cpu: true,
            enable_video_previews: false,
            prevent_sleep_while_compressing: true,
            keep_screen_on_while_compressing: false,
            open_in_menu_bar_only: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct SettingsEnvelope {
    schema_version: u32,
    settings: DomainSettings,
}

static STATE: Mutex<Option<DomainSettings>> = Mutex::new(None);

fn store_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|err| err.to_string())
}

fn write_atomically(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())
}

fn bootstrap_from_cli_settings(app_handle: &AppHandle) -> Option<DomainSettings> {
    let dir = app_handle.path().app_data_dir().ok()?;
    let cli_path = dir.join(crate::sys::cli_settings::FILE_NAME);
    let raw = std::fs::read_to_string(cli_path).ok()?;
    let cli_json = serde_json::from_str::<Value>(&raw).ok()?;
    Some(domain_settings_from_cli_json(&cli_json))
}

fn domain_settings_from_cli_json(cli_json: &Value) -> DomainSettings {
    let mut settings = DomainSettings::default();
    if let Some(output) = cli_json.get("output").and_then(|v| v.as_object()) {
        if let Some(v) = output.get("skipLargerOutputs").and_then(|v| v.as_bool()) {
            settings.save_larger_outputs = !v;
        }
        if let Some(v) = output
            .get("preserveFolderStructure")
            .and_then(|v| v.as_bool())
        {
            settings.preserve_folder_structure = v;
        }
        if let Some(v) = output.get("replaceOriginalFiles").and_then(|v| v.as_bool()) {
            settings.replace_original_files = v;
        }
        if let Some(v) = output
            .get("useHardwareAcceleration")
            .and_then(|v| v.as_bool())
        {
            settings.use_hardware_acceleration = v;
        }
        if let Some(v) = output
            .get("reachTargetSizesWithoutAcceleration")
            .and_then(|v| v.as_bool())
        {
            settings.retry_target_size_on_cpu = v;
        }
    }
    if let Some(show) = cli_json.get("showMenuBarIcon").and_then(|v| v.as_bool()) {
        settings.show_menu_bar_icon = show;
    }
    if let Some(folders) = cli_json.get("watchedFolders").and_then(|v| v.as_array()) {
        settings.watched_folders = folders
            .iter()
            .filter_map(|folder| {
                let id = folder.get("id")?.as_str()?.to_string();
                let path = folder.get("path")?.as_str()?.to_string();
                let is_enabled = folder.get("isEnabled")?.as_bool()?;
                let preset_ids = folder.get("presetIds").map(|pids| WatchedFolderPresetIds {
                    video: pids
                        .get("video")
                        .and_then(|v| v.as_str())
                        .filter(|s| *s != DEFAULT_PRESET_CHOICE)
                        .map(String::from),
                    image: pids
                        .get("image")
                        .and_then(|v| v.as_str())
                        .filter(|s| *s != DEFAULT_PRESET_CHOICE)
                        .map(String::from),
                    audio: pids
                        .get("audio")
                        .and_then(|v| v.as_str())
                        .filter(|s| *s != DEFAULT_PRESET_CHOICE)
                        .map(String::from),
                });
                Some(StoredWatchedFolder {
                    id,
                    path,
                    is_enabled,
                    preset_ids,
                })
            })
            .collect();
    }
    settings
}

fn load_from_disk_or_default(app_handle: &AppHandle) -> DomainSettings {
    if let Ok(path) = store_path(app_handle) {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(env) = serde_json::from_str::<SettingsEnvelope>(&raw) {
                return sanitize_settings(env.settings);
            }
            if let Ok(direct) = serde_json::from_str::<DomainSettings>(&raw) {
                return sanitize_settings(direct);
            }
            log::warn!(
                "[settings] Could not parse {}; using fallback defaults",
                path.display()
            );
        }
    }
    bootstrap_from_cli_settings(app_handle).unwrap_or_default()
}

fn sanitize_settings(mut settings: DomainSettings) -> DomainSettings {
    if settings.cpu_thread_limit == Some(0) {
        settings.cpu_thread_limit = None;
    }
    if settings.save_folder.as_deref() == Some("") {
        settings.save_folder = None;
    }
    if settings.save_location == SaveLocation::FixedFolder && settings.save_folder.is_none() {
        settings.save_location = SaveLocation::SameFolder;
    }
    settings
}

fn apply_runtime_side_effects(app_handle: &AppHandle, settings: &DomainSettings) {
    cpu_limit::set_thread_limit(settings.cpu_thread_limit.unwrap_or(0));
    hardware_encoder::set_enabled(settings.use_hardware_acceleration);
    crate::sys::cli_settings::patch_from_domain_settings(app_handle, settings);
    crate::sys::watch_folders::sync_from_core(app_handle);
    crate::tauri_commands::drop_queue::sync_auto_compress_from_core(app_handle);
}

fn persist_and_notify(
    app_handle: &AppHandle,
    settings: &DomainSettings,
    emit_event: bool,
) -> Result<(), String> {
    let path = store_path(app_handle)?;
    let envelope = SettingsEnvelope {
        schema_version: SCHEMA_VERSION,
        settings: settings.clone(),
    };
    let text = serde_json::to_string_pretty(&envelope).map_err(|err| err.to_string())?;
    write_atomically(&path, &text)?;
    apply_runtime_side_effects(app_handle, settings);
    if emit_event {
        let _ = app_handle.emit(CustomEvents::CoreSettingsChanged.as_ref(), settings);
    }
    Ok(())
}

fn load_cached(app_handle: &AppHandle) -> DomainSettings {
    let mut guard = STATE.lock().unwrap();
    guard
        .get_or_insert_with(|| load_from_disk_or_default(app_handle))
        .clone()
}

/// Initializes cached settings from `settings.json` (or `cli-settings.json` / defaults) and
/// applies Rust-side runtime knobs (`cpu_limit`, `hardware_encoder`, watchers, drop queue).
pub fn init_or_get(app_handle: &AppHandle) -> DomainSettings {
    let settings = load_cached(app_handle);
    apply_runtime_side_effects(app_handle, &settings);
    settings
}

pub fn get(app_handle: &AppHandle) -> DomainSettings {
    load_cached(app_handle)
}

pub fn exists_on_disk(app_handle: &AppHandle) -> bool {
    store_path(app_handle).is_ok_and(|path| path.exists())
}

/// One-time migration from frontend `localStorage`. If `settings.json` already exists on disk
/// (written earlier by the UI or a headless CLI/MCP run), returns the authoritative disk state
/// rather than overwriting it with potentially stale `localStorage`.
pub fn migrate_from_frontend(
    app_handle: &AppHandle,
    legacy: DomainSettings,
) -> Result<(DomainSettings, bool), String> {
    let mut guard = STATE.lock().unwrap();
    if exists_on_disk(app_handle) {
        let authoritative = guard
            .get_or_insert_with(|| load_from_disk_or_default(app_handle))
            .clone();
        drop(guard);
        apply_runtime_side_effects(app_handle, &authoritative);
        return Ok((authoritative, false));
    }
    let clean = sanitize_settings(legacy);
    *guard = Some(clean.clone());
    drop(guard);
    persist_and_notify(app_handle, &clean, false)?;
    log::info!("[settings] Migrated domain settings to settings.json");
    Ok((clean, true))
}

/// Replaces domain settings (used by GUI edits) and persists `settings.json`.
pub fn save(app_handle: &AppHandle, next: DomainSettings) -> Result<DomainSettings, String> {
    let clean = sanitize_settings(next);
    {
        let mut guard = STATE.lock().unwrap();
        if guard.as_ref() == Some(&clean) && exists_on_disk(app_handle) {
            return Ok(clean);
        }
        *guard = Some(clean.clone());
    }
    persist_and_notify(app_handle, &clean, true)?;
    Ok(clean)
}

/// Mutates domain settings atomically inside Rust (e.g. watched folder edits from CLI/MCP).
pub fn update_with<F, R>(app_handle: &AppHandle, f: F) -> Result<(DomainSettings, R), String>
where
    F: FnOnce(&mut DomainSettings) -> Result<R, String>,
{
    let (next, result) = {
        let mut guard = STATE.lock().unwrap();
        let current = guard
            .get_or_insert_with(|| load_from_disk_or_default(app_handle))
            .clone();
        let mut draft = current;
        let res = f(&mut draft)?;
        let clean = sanitize_settings(draft);
        *guard = Some(clean.clone());
        (clean, res)
    };
    persist_and_notify(app_handle, &next, true)?;
    Ok((next, result))
}

fn require_bool(key: &str, value: &Value) -> Result<bool, (&'static str, String)> {
    value.as_bool().ok_or_else(|| {
        (
            "invalidRequest",
            format!("Setting `{key}` must be a boolean (true or false)."),
        )
    })
}

fn require_string(key: &str, value: &Value) -> Result<String, (&'static str, String)> {
    value
        .as_str()
        .map(String::from)
        .ok_or_else(|| ("invalidRequest", format!("Setting `{key}` must be a string.")))
}

pub const WRITABLE_SETTING_KEYS: &[&str] = &[
    "outputFileNameTemplate",
    "saveLocation",
    "saveFolder",
    "preserveFolderStructure",
    "saveLargerOutputs",
    "replaceOriginalFiles",
    "copyOutputToClipboard",
    "copyBatchOutputToClipboard",
    "showMenuBarIcon",
    "watchClipboard",
    "playCompletionSound",
    "enableAudioWaveforms",
    "autoCompress",
    "dropZoneVideoPresetId",
    "dropZoneImagePresetId",
    "dropZoneAudioPresetId",
    "useHardwareAcceleration",
    "cpuThreadLimit",
    "retryTargetSizeOnCpu",
    "enableVideoPreviews",
    "preventSleepWhileCompressing",
    "keepScreenOnWhileCompressing",
    "openInMenuBarOnly",
];

/// Validates and applies a partial settings object (from CLI `compresso settings set` or MCP
/// `update_settings`). Rejects unknown keys and UI-only appearance preferences cleanly.
pub fn patch_from_json(
    app_handle: &AppHandle,
    patch: &Value,
) -> Result<DomainSettings, (&'static str, String)> {
    let Some(obj) = patch.as_object() else {
        return Err((
            "invalidRequest",
            String::from("Settings patch must be a JSON object."),
        ));
    };
    if obj.is_empty() {
        return Err((
            "invalidRequest",
            String::from("Provide at least one setting to update."),
        ));
    }

    let current = get(app_handle);
    let mut draft = current;
    let presets_snapshot = presets::get(app_handle);

    apply_patch_fields(&mut draft, obj, &presets_snapshot)?;

    let clean = sanitize_settings(draft.clone());
    // Re-check explicit fixedFolder constraint before sanitizing fallback hides it.
    if draft.save_location == SaveLocation::FixedFolder
        && draft.save_folder.as_deref().unwrap_or("").trim().is_empty()
    {
        return Err((
            "invalidRequest",
            String::from(
                "Setting `saveLocation` to \"fixedFolder\" requires a non-empty `saveFolder`.",
            ),
        ));
    }

    {
        let mut guard = STATE.lock().unwrap();
        *guard = Some(clean.clone());
    }
    persist_and_notify(app_handle, &clean, true)
        .map_err(|err| ("invalidRequest", err))?;
    Ok(clean)
}

fn apply_patch_fields(
    draft: &mut DomainSettings,
    obj: &serde_json::Map<String, Value>,
    presets_snapshot: &presets::PresetsStoreData,
) -> Result<(), (&'static str, String)> {
    for (key, value) in obj {
        if UI_ONLY_KEYS.contains(&key.as_str()) {
            return Err((
                "invalidRequest",
                format!(
                    "`{key}` is a UI-only appearance preference and cannot be changed via headless settings."
                ),
            ));
        }
        match key.as_str() {
            "watchedFolders" => {
                return Err((
                    "invalidRequest",
                    String::from(
                        "Manage `watchedFolders` using `compresso watch add|update|remove` (or the watched folder MCP tools).",
                    ),
                ));
            }
            "outputFileNameTemplate" => {
                draft.output_file_name_template = require_string(key, value)?;
            }
            "saveLocation" => {
                let raw = require_string(key, value)?;
                draft.save_location = match raw.as_str() {
                    "sameFolder" => SaveLocation::SameFolder,
                    "ask" => SaveLocation::Ask,
                    "fixedFolder" => SaveLocation::FixedFolder,
                    _ => {
                        return Err((
                            "invalidRequest",
                            format!(
                                "Invalid `saveLocation` \"{raw}\". Use \"sameFolder\", \"ask\", or \"fixedFolder\"."
                            ),
                        ));
                    }
                };
            }
            "saveFolder" => {
                if value.is_null() {
                    draft.save_folder = None;
                } else {
                    let folder = require_string(key, value)?;
                    let trimmed = folder.trim();
                    if trimmed.is_empty() {
                        draft.save_folder = None;
                    } else {
                        draft.save_folder = Some(trimmed.to_string());
                    }
                }
            }
            "preserveFolderStructure" => {
                draft.preserve_folder_structure = require_bool(key, value)?;
            }
            "saveLargerOutputs" => draft.save_larger_outputs = require_bool(key, value)?,
            "replaceOriginalFiles" => draft.replace_original_files = require_bool(key, value)?,
            "copyOutputToClipboard" => draft.copy_output_to_clipboard = require_bool(key, value)?,
            "copyBatchOutputToClipboard" => {
                draft.copy_batch_output_to_clipboard = require_bool(key, value)?;
            }
            "showMenuBarIcon" => draft.show_menu_bar_icon = require_bool(key, value)?,
            "watchClipboard" => draft.watch_clipboard = require_bool(key, value)?,
            "playCompletionSound" => draft.play_completion_sound = require_bool(key, value)?,
            "enableAudioWaveforms" => draft.enable_audio_waveforms = require_bool(key, value)?,
            "autoCompress" => draft.auto_compress = require_bool(key, value)?,
            "dropZoneVideoPresetId" => {
                let raw = require_string(key, value)?;
                draft.drop_zone_video_preset_id =
                    resolve_drop_zone_preset(&raw, "video", presets_snapshot)?;
            }
            "dropZoneImagePresetId" => {
                let raw = require_string(key, value)?;
                draft.drop_zone_image_preset_id =
                    resolve_drop_zone_preset(&raw, "image", presets_snapshot)?;
            }
            "dropZoneAudioPresetId" => {
                let raw = require_string(key, value)?;
                draft.drop_zone_audio_preset_id =
                    resolve_drop_zone_preset(&raw, "audio", presets_snapshot)?;
            }
            "useHardwareAcceleration" => {
                draft.use_hardware_acceleration = require_bool(key, value)?;
            }
            "cpuThreadLimit" => {
                if value.is_null() {
                    draft.cpu_thread_limit = None;
                } else if let Some(n) = value.as_u64() {
                    if n == 0 {
                        draft.cpu_thread_limit = None;
                    } else {
                        draft.cpu_thread_limit = Some(n as usize);
                    }
                } else {
                    return Err((
                        "invalidRequest",
                        String::from(
                            "`cpuThreadLimit` must be null, 0 (all threads), or a positive integer.",
                        ),
                    ));
                }
            }
            "retryTargetSizeOnCpu" => draft.retry_target_size_on_cpu = require_bool(key, value)?,
            "enableVideoPreviews" => draft.enable_video_previews = require_bool(key, value)?,
            "preventSleepWhileCompressing" => {
                draft.prevent_sleep_while_compressing = require_bool(key, value)?;
            }
            "keepScreenOnWhileCompressing" => {
                draft.keep_screen_on_while_compressing = require_bool(key, value)?;
            }
            "openInMenuBarOnly" => draft.open_in_menu_bar_only = require_bool(key, value)?,
            _ => {
                return Err((
                    "invalidRequest",
                    format!(
                        "Unknown setting `{key}`. Supported keys: {}",
                        WRITABLE_SETTING_KEYS.join(", ")
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn resolve_drop_zone_preset(
    raw: &str,
    media_type: &str,
    presets_snapshot: &presets::PresetsStoreData,
) -> Result<String, (&'static str, String)> {
    presets::resolve_preset_choice(raw, media_type, presets_snapshot).ok_or_else(|| {
        (
            "unknownPreset",
            format!(
                "There is no {media_type} preset named or with id \"{raw}\". Use \"default\", \"standard\", or an existing {media_type} preset."
            ),
        )
    })
}

/// Filters `DomainSettings` to a single requested key for `settings get <key>`.
pub fn read_key(settings: &DomainSettings, key: &str) -> Result<Value, (&'static str, String)> {
    let val = serde_json::to_value(settings).map_err(|err| ("invalidRequest", err.to_string()))?;
    let Some(obj) = val.as_object() else {
        return Err(("invalidRequest", String::from("Could not inspect settings.")));
    };
    if UI_ONLY_KEYS.contains(&key) {
        return Err((
            "invalidRequest",
            format!("`{key}` is a UI-only appearance preference stored in the interface."),
        ));
    }
    obj.get(key).cloned().ok_or_else(|| {
        (
            "invalidRequest",
            format!(
                "Unknown setting `{key}`. Supported keys: {}",
                obj.keys().cloned().collect::<Vec<_>>().join(", ")
            ),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_match_frontend_settings_store() {
        let defaults = DomainSettings::default();
        assert_eq!(defaults.output_file_name_template, "compressO-{name}");
        assert_eq!(defaults.save_location, SaveLocation::SameFolder);
        assert!(defaults.save_larger_outputs);
        assert!(defaults.preserve_folder_structure);
        assert!(!defaults.replace_original_files);
        assert!(defaults.retry_target_size_on_cpu);
        assert_eq!(defaults.cpu_thread_limit, None);
    }

    #[test]
    fn bootstraps_from_legacy_cli_settings_json() {
        let cli_json = json!({
            "output": {
                "skipLargerOutputs": true,
                "preserveFolderStructure": false,
                "replaceOriginalFiles": true,
                "useHardwareAcceleration": true,
                "reachTargetSizesWithoutAcceleration": false,
            },
            "showMenuBarIcon": false,
            "watchedFolders": [{
                "id": "wf-1",
                "path": "/tmp/videos",
                "isEnabled": true,
                "presetIds": { "video": "Web", "image": "default", "audio": "standard" }
            }]
        });
        let settings = domain_settings_from_cli_json(&cli_json);
        assert!(!settings.save_larger_outputs);
        assert!(!settings.preserve_folder_structure);
        assert!(settings.replace_original_files);
        assert!(settings.use_hardware_acceleration);
        assert!(!settings.retry_target_size_on_cpu);
        assert!(!settings.show_menu_bar_icon);
        assert_eq!(settings.watched_folders.len(), 1);
        assert_eq!(
            settings.watched_folders[0]
                .preset_ids
                .as_ref()
                .unwrap()
                .video
                .as_deref(),
            Some("Web")
        );
        assert_eq!(
            settings.watched_folders[0]
                .preset_ids
                .as_ref()
                .unwrap()
                .image,
            None
        );
    }

    #[test]
    fn patch_rejects_ui_only_and_unknown_keys() {
        let mut draft = DomainSettings::default();
        let presets = presets::PresetsStoreData::default();
        let ui_err = apply_patch_fields(
            &mut draft,
            json!({ "theme": "dark" }).as_object().unwrap(),
            &presets,
        )
        .unwrap_err();
        assert_eq!(ui_err.0, "invalidRequest");
        assert!(ui_err.1.contains("UI-only"));

        let unknown_err = apply_patch_fields(
            &mut draft,
            json!({ "doesNotExist": 1 }).as_object().unwrap(),
            &presets,
        )
        .unwrap_err();
        assert_eq!(unknown_err.0, "invalidRequest");
    }

    #[test]
    fn patch_updates_cpu_limit_and_validates_types() {
        let mut draft = DomainSettings::default();
        let presets = presets::PresetsStoreData::default();
        apply_patch_fields(
            &mut draft,
            json!({ "cpuThreadLimit": 4, "useHardwareAcceleration": true })
                .as_object()
                .unwrap(),
            &presets,
        )
        .unwrap();
        assert_eq!(draft.cpu_thread_limit, Some(4));
        assert!(draft.use_hardware_acceleration);

        apply_patch_fields(
            &mut draft,
            json!({ "cpuThreadLimit": 0 }).as_object().unwrap(),
            &presets,
        )
        .unwrap();
        assert_eq!(draft.cpu_thread_limit, None);
    }
}
