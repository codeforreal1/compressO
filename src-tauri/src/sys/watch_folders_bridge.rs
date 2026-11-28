//! Watched folder mutations asked for by the command line or MCP (`cli_server`): executes
//! directly against `core::settings` and `core::presets` in Rust so it works identically whether
//! a WebView window is open or CompressO is running headlessly.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::core::presets::{self, PresetsStoreData};
use crate::core::settings::{
    self, DomainSettings, StoredWatchedFolder, WatchedFolderPresetIds,
};

/// A change to one of the watched folders' presets, by media type; omitted ones stay unchanged
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PresetChanges {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio: Option<String>,
}

/// A change to the watched folders
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum WatchFolderCommand {
    #[serde(rename = "addWatchedFolder")]
    Add {
        path: String,
        #[serde(rename = "isEnabled", skip_serializing_if = "Option::is_none")]
        is_enabled: Option<bool>,
        #[serde(rename = "presetIds", skip_serializing_if = "Option::is_none")]
        preset_ids: Option<PresetChanges>,
    },
    #[serde(rename = "updateWatchedFolder")]
    Update {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        #[serde(rename = "isEnabled", skip_serializing_if = "Option::is_none")]
        is_enabled: Option<bool>,
        #[serde(rename = "presetIds", skip_serializing_if = "Option::is_none")]
        preset_ids: Option<PresetChanges>,
    },
    #[serde(rename = "removeWatchedFolder")]
    Remove {
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        path.trim().to_string()
    } else {
        trimmed.to_string()
    }
}

fn format_choices(folders: &[StoredWatchedFolder]) -> Vec<Value> {
    folders
        .iter()
        .map(|folder| {
            let pids = folder.preset_ids.as_ref();
            json!({
                "id": folder.id,
                "path": folder.path,
                "isEnabled": folder.is_enabled,
                "presetIds": {
                    "video": pids.and_then(|p| p.video.as_deref()).unwrap_or("default"),
                    "image": pids.and_then(|p| p.image.as_deref()).unwrap_or("default"),
                    "audio": pids.and_then(|p| p.audio.as_deref()).unwrap_or("default"),
                }
            })
        })
        .collect()
}

fn resolve_preset_changes(
    changes: Option<&PresetChanges>,
    presets_snapshot: &PresetsStoreData,
) -> Result<WatchedFolderPresetIds, (&'static str, String)> {
    let mut resolved = WatchedFolderPresetIds::default();
    let Some(changes) = changes else {
        return Ok(resolved);
    };
    let resolve_one = |value: Option<&String>, media_type: &str| -> Result<Option<String>, (&'static str, String)> {
        let Some(value) = value else {
            return Ok(None);
        };
        let id = presets::resolve_preset_choice(value, media_type, presets_snapshot).ok_or_else(|| {
            let available = presets::preset_names_for_media_type(media_type, presets_snapshot);
            (
                "unknownPreset",
                format!(
                    "There is no {media_type} preset named \"{value}\". The {media_type} presets are {}. Use \"default\" to follow the default preset.",
                    available.join(", ")
                ),
            )
        })?;
        Ok(Some(id))
    };
    resolved.video = resolve_one(changes.video.as_ref(), "video")?;
    resolved.image = resolve_one(changes.image.as_ref(), "image")?;
    resolved.audio = resolve_one(changes.audio.as_ref(), "audio")?;
    Ok(resolved)
}

fn find_folder_index(
    folders: &[StoredWatchedFolder],
    id: Option<&str>,
    path: Option<&str>,
) -> Option<usize> {
    if let Some(id) = id {
        return folders.iter().position(|folder| folder.id == id);
    }
    let path = path?;
    let wanted = normalize_path(path);
    folders
        .iter()
        .position(|folder| normalize_path(&folder.path) == wanted)
}

fn has_preset_changes(changes: &WatchedFolderPresetIds) -> bool {
    changes.video.is_some() || changes.image.is_some() || changes.audio.is_some()
}

/// Executes a watched folder change directly against `core::settings` + `core::presets`.
pub async fn forward(
    app_handle: &AppHandle,
    command: WatchFolderCommand,
) -> Result<Value, String> {
    let presets_snapshot = presets::get(app_handle);

    match command {
        WatchFolderCommand::Add {
            path,
            is_enabled,
            preset_ids,
        } => {
            let normalized = match normalized_folder_path(&path) {
                Ok(p) => p,
                Err((code, message)) => {
                    return Ok(json!({ "ok": false, "code": code, "message": message }));
                }
            };
            let resolved_presets = match resolve_preset_changes(preset_ids.as_ref(), &presets_snapshot) {
                Ok(p) => p,
                Err((code, message)) => {
                    return Ok(json!({ "ok": false, "code": code, "message": message }));
                }
            };

            let (updated, (folder_id, added)) =
                settings::update_with(app_handle, |draft: &mut DomainSettings| {
                    if let Some(idx) = find_folder_index(&draft.watched_folders, None, Some(&normalized)) {
                        return Ok((draft.watched_folders[idx].id.clone(), false));
                    }
                    let id = nanoid::nanoid!(10);
                    let folder = StoredWatchedFolder {
                        id: id.clone(),
                        path: normalized,
                        is_enabled: is_enabled.unwrap_or(true),
                        preset_ids: has_preset_changes(&resolved_presets).then_some(resolved_presets),
                    };
                    draft.watched_folders.push(folder);
                    Ok((id, true))
                })?;

            Ok(json!({
                "ok": true,
                "watchedFolders": format_choices(&updated.watched_folders),
                "folderId": folder_id,
                "added": added,
            }))
        }
        WatchFolderCommand::Update {
            id,
            path,
            is_enabled,
            preset_ids,
        } => {
            let resolved_presets = match resolve_preset_changes(preset_ids.as_ref(), &presets_snapshot) {
                Ok(p) => p,
                Err((code, message)) => {
                    return Ok(json!({ "ok": false, "code": code, "message": message }));
                }
            };
            if is_enabled.is_none() && !has_preset_changes(&resolved_presets) {
                return Ok(json!({
                    "ok": false,
                    "code": "invalidRequest",
                    "message": "Give enabled, videoPreset, imagePreset or audioPreset to update.",
                }));
            }

            let current = settings::get(app_handle);
            let Some(idx) = find_folder_index(&current.watched_folders, id.as_deref(), path.as_deref()) else {
                return Ok(json!({
                    "ok": false,
                    "code": "unknownWatchedFolder",
                    "message": "There is no watched folder with that id or path. Call list_watched_folders for the current ones.",
                }));
            };
            let target = &current.watched_folders[idx];
            if is_enabled == Some(true) && !target.is_enabled {
                let missing = crate::sys::watch_folders::missing_watched_folders(vec![target.path.clone()]).await;
                if missing.iter().any(|m| m == &target.path) {
                    return Ok(json!({
                        "ok": false,
                        "code": "missingFolder",
                        "message": format!("The folder {} does not exist.", target.path),
                    }));
                }
            }

            let target_id = target.id.clone();
            let (updated, _) = settings::update_with(app_handle, |draft: &mut DomainSettings| {
                let Some(folder) = draft.watched_folders.iter_mut().find(|f| f.id == target_id) else {
                    return Err(String::from("Watched folder disappeared during update"));
                };
                if let Some(enabled) = is_enabled {
                    folder.is_enabled = enabled;
                }
                if has_preset_changes(&resolved_presets) {
                    let mut merged = folder.preset_ids.clone().unwrap_or_default();
                    if let Some(v) = resolved_presets.video {
                        merged.video = Some(v);
                    }
                    if let Some(i) = resolved_presets.image {
                        merged.image = Some(i);
                    }
                    if let Some(a) = resolved_presets.audio {
                        merged.audio = Some(a);
                    }
                    folder.preset_ids = Some(merged);
                }
                Ok(())
            })?;

            Ok(json!({
                "ok": true,
                "watchedFolders": format_choices(&updated.watched_folders),
                "folderId": target_id,
                "updated": true,
            }))
        }
        WatchFolderCommand::Remove { id, path } => {
            let (updated, removed) = settings::update_with(app_handle, |draft: &mut DomainSettings| {
                let Some(idx) = find_folder_index(&draft.watched_folders, id.as_deref(), path.as_deref()) else {
                    return Ok(false);
                };
                draft.watched_folders.remove(idx);
                Ok(true)
            })?;
            Ok(json!({
                "ok": true,
                "watchedFolders": format_choices(&updated.watched_folders),
                "removed": removed,
            }))
        }
    }
}

/// A folder to watch: an existing, readable folder that is not a filesystem root, with a trailing
/// separator removed (the path as the user chose it is kept, not a Windows `\\?\` path)
fn normalized_folder_path(path: &str) -> Result<String, (&'static str, String)> {
    let path = path.trim();
    if path.is_empty() {
        return Err(("invalidRequest", String::from("Give the folder to watch.")));
    }
    let folder = Path::new(path);
    if !folder.is_absolute() {
        return Err((
            "invalidRequest",
            String::from("Use an absolute path for the folder to watch."),
        ));
    }
    if folder.parent().is_none() {
        return Err((
            "rootFolder",
            String::from("Watching a filesystem root is not supported. Choose a folder inside it."),
        ));
    }
    match std::fs::metadata(folder) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err((
                "missingFolder",
                format!("{} is not a folder.", folder.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err((
                "missingFolder",
                format!("The folder {} does not exist.", folder.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err((
                "accessDenied",
                format!(
                    "CompressO cannot read {}. Allow it access in the system's settings.",
                    folder.display()
                ),
            ));
        }
        Err(error) => {
            return Err((
                "invalidRequest",
                format!("CompressO cannot read {}: {}", folder.display(), error),
            ));
        }
    }
    if let Err(error) = std::fs::read_dir(folder) {
        let code = if error.kind() == std::io::ErrorKind::PermissionDenied {
            "accessDenied"
        } else {
            "invalidRequest"
        };
        return Err((
            code,
            format!("CompressO cannot read {}: {}", folder.display(), error),
        ));
    }
    Ok(folder
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string())
}
