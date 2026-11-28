//! Central preset persistence in `app_data_dir/presets.json`. Keeps user presets (their v2
//! JSON Contract data alongside UI preset settings) synchronized across open windows and headless
//! CLI/MCP runs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::domain::CustomEvents;

const FILE_NAME: &str = "presets.json";
const SCHEMA_VERSION: u32 = 2;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultPresetIds {
    #[serde(default = "standard_id")]
    pub video: String,
    #[serde(default = "standard_id")]
    pub image: String,
    #[serde(default = "standard_id")]
    pub audio: String,
}

fn standard_id() -> String {
    String::from("standard")
}

impl Default for DefaultPresetIds {
    fn default() -> Self {
        Self {
            video: standard_id(),
            image: standard_id(),
            audio: standard_id(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredPreset {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub settings: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresetsStoreData {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub presets: Vec<StoredPreset>,
    #[serde(default)]
    pub default_preset_ids: DefaultPresetIds,
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

impl Default for PresetsStoreData {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            presets: Vec::new(),
            default_preset_ids: DefaultPresetIds::default(),
        }
    }
}

static STATE: Mutex<Option<PresetsStoreData>> = Mutex::new(None);

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

fn sanitize(mut data: PresetsStoreData) -> PresetsStoreData {
    data.schema_version = SCHEMA_VERSION;
    let pick = |id: &str, media_type: &str| {
        if data
            .presets
            .iter()
            .any(|p| p.id == id && p.media_type == media_type)
        {
            id.to_string()
        } else {
            standard_id()
        }
    };
    data.default_preset_ids.video = pick(&data.default_preset_ids.video, "video");
    data.default_preset_ids.image = pick(&data.default_preset_ids.image, "image");
    data.default_preset_ids.audio = pick(&data.default_preset_ids.audio, "audio");
    data
}

fn load_from_disk_or_default(app_handle: &AppHandle) -> PresetsStoreData {
    if let Ok(path) = store_path(app_handle) {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(data) = serde_json::from_str::<PresetsStoreData>(&raw) {
                return sanitize(data);
            }
            log::warn!(
                "[presets] Could not parse {}; using empty presets state",
                path.display()
            );
        }
    }
    PresetsStoreData::default()
}

pub fn exists_on_disk(app_handle: &AppHandle) -> bool {
    store_path(app_handle).is_ok_and(|path| path.exists())
}

pub fn get(app_handle: &AppHandle) -> PresetsStoreData {
    let mut guard = STATE.lock().unwrap();
    guard
        .get_or_insert_with(|| load_from_disk_or_default(app_handle))
        .clone()
}

pub fn migrate_from_frontend(
    app_handle: &AppHandle,
    legacy: PresetsStoreData,
) -> Result<(PresetsStoreData, bool), String> {
    let mut guard = STATE.lock().unwrap();
    if exists_on_disk(app_handle) {
        let authoritative = guard
            .get_or_insert_with(|| load_from_disk_or_default(app_handle))
            .clone();
        return Ok((authoritative, false));
    }
    let clean = sanitize(legacy);
    *guard = Some(clean.clone());
    drop(guard);
    let path = store_path(app_handle)?;
    let text = serde_json::to_string_pretty(&clean).map_err(|err| err.to_string())?;
    write_atomically(&path, &text)?;
    log::info!(
        "[presets] Migrated {} preset(s) to presets.json",
        clean.presets.len()
    );
    crate::sys::watch_folders::sync_from_core(app_handle);
    crate::tauri_commands::drop_queue::sync_auto_compress_from_core(app_handle);
    Ok((clean, true))
}

pub fn save(app_handle: &AppHandle, next: PresetsStoreData) -> Result<PresetsStoreData, String> {
    let clean = sanitize(next);
    {
        let mut guard = STATE.lock().unwrap();
        if guard.as_ref() == Some(&clean) && exists_on_disk(app_handle) {
            return Ok(clean);
        }
        *guard = Some(clean.clone());
    }
    let path = store_path(app_handle)?;
    let text = serde_json::to_string_pretty(&clean).map_err(|err| err.to_string())?;
    write_atomically(&path, &text)?;
    crate::sys::watch_folders::sync_from_core(app_handle);
    crate::tauri_commands::drop_queue::sync_auto_compress_from_core(app_handle);
    let _ = app_handle.emit(CustomEvents::CorePresetsChanged.as_ref(), &clean);
    Ok(clean)
}

/// Resolves `"default"`, `"standard"`, a preset id, or a case-insensitive preset name for
/// `media_type` (`"video"`, `"image"`, `"audio"`). Returns `None` if unknown.
pub fn resolve_preset_choice(
    raw: &str,
    media_type: &str,
    data: &PresetsStoreData,
) -> Option<String> {
    let wanted = raw.trim();
    if wanted.is_empty() || wanted.eq_ignore_ascii_case("default") {
        return Some(String::from("default"));
    }
    if wanted.eq_ignore_ascii_case("standard") {
        return Some(String::from("standard"));
    }
    data.presets
        .iter()
        .find(|preset| {
            preset.media_type == media_type
                && (preset.id == wanted || preset.name.eq_ignore_ascii_case(wanted))
        })
        .map(|preset| preset.id.clone())
}

pub fn preset_names_for_media_type(media_type: &str, data: &PresetsStoreData) -> Vec<String> {
    let mut names = vec![String::from("Standard")];
    names.extend(
        data.presets
            .iter()
            .filter(|preset| preset.media_type == media_type)
            .map(|preset| preset.name.clone()),
    );
    names
}

pub fn get_name_by_id(data: &PresetsStoreData, id: &str) -> Option<String> {
    data.presets
        .iter()
        .find(|preset| preset.id == id)
        .map(|preset| preset.name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_default_standard_id_and_name() {
        let data = PresetsStoreData {
            schema_version: 2,
            presets: vec![StoredPreset {
                id: String::from("p1"),
                name: String::from("Web Optimized"),
                media_type: String::from("video"),
                settings: json!({}),
                output: None,
                revision: Some(1),
                updated_at: None,
            }],
            default_preset_ids: DefaultPresetIds {
                video: String::from("p1"),
                image: String::from("standard"),
                audio: String::from("missing"),
            },
        };
        let sanitized = sanitize(data);
        assert_eq!(sanitized.default_preset_ids.video, "p1");
        assert_eq!(sanitized.default_preset_ids.audio, "standard");
        assert_eq!(
            resolve_preset_choice("default", "video", &sanitized).as_deref(),
            Some("default")
        );
        assert_eq!(
            resolve_preset_choice("Standard", "video", &sanitized).as_deref(),
            Some("standard")
        );
        assert_eq!(
            resolve_preset_choice("web optimized", "video", &sanitized).as_deref(),
            Some("p1")
        );
        assert_eq!(
            resolve_preset_choice("web optimized", "image", &sanitized),
            None
        );
    }
}
