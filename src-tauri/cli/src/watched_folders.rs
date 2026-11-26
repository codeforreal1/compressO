//! Watched folders (Settings -> Watch Folder): listed from the settings the app wrote, and changed
//! through the app's connection (see `cli_server.rs` in the app).
use std::path::Path;

use serde_json::{json, Value};

use crate::client::Connection;
use crate::error::{exit_code, CliError};
use crate::settings::{Settings, WatchedFolder, MEDIA_TYPES};

/// The presets chosen for a watched folder, by media type, as given to the command line
#[derive(Default, Clone, Debug)]
pub struct PresetChanges {
    pub video: Option<String>,
    pub image: Option<String>,
    pub audio: Option<String>,
}

impl PresetChanges {
    pub fn is_empty(&self) -> bool {
        self.video.is_none() && self.image.is_none() && self.audio.is_none()
    }
}

/// The folders the app watches, with the presets used for each media type
pub async fn list() -> Result<Value, CliError> {
    let settings = load_settings().await?;
    let folders = settings.watched_folders.as_deref().unwrap_or(&[]);
    Ok(json!({ "watchedFolders": statuses(&settings, folders) }))
}

/// The settings the app wrote last; the app is started only when it never wrote them (or wrote them
/// before watched folders were kept there)
async fn load_settings() -> Result<Settings, CliError> {
    match Settings::from_file() {
        Some(settings) if settings.watched_folders.is_some() => Ok(settings),
        _ => crate::fetch_settings().await,
    }
}

async fn settings_from(connection: &mut Connection) -> Result<Settings, CliError> {
    let answer = connection.request(json!({ "type": "getSettings" })).await?;
    serde_json::from_value(answer["settings"].clone())
        .map_err(|_| CliError::app("CompressO sent settings this command line cannot read."))
}

/// Adds a folder to watch, with the presets chosen for its media (the default ones otherwise)
pub async fn add(
    path: String,
    is_enabled: Option<bool>,
    presets: Option<PresetChanges>,
) -> Result<Value, CliError> {
    let path = checked_path(&path)?;
    let mut connection = Connection::open(|_| {}).await?;
    let settings = settings_from(&mut connection).await?;
    let preset_ids = resolve_presets(&settings, presets)?;
    let answer = connection
        .request(json!({
            "type": "addWatchedFolder",
            "path": path,
            "isEnabled": is_enabled,
            "presetIds": preset_ids,
        }))
        .await?;
    mutation_result(&settings, &answer)
}

/// Enables or disables a watched folder, or changes its presets
pub async fn update(
    id: Option<String>,
    path: Option<String>,
    is_enabled: Option<bool>,
    presets: Option<PresetChanges>,
) -> Result<Value, CliError> {
    if is_empty(&id) && is_empty(&path) {
        return Err(CliError::usage(
            "Give the watched folder's id (from list_watched_folders) or its path.",
        ));
    }
    if is_enabled.is_none() && presets.as_ref().is_none_or(PresetChanges::is_empty) {
        return Err(CliError::usage(
            "Give enabled, videoPreset, imagePreset or audioPreset to update.",
        ));
    }
    let mut connection = Connection::open(|_| {}).await?;
    let settings = settings_from(&mut connection).await?;
    let preset_ids = resolve_presets(&settings, presets)?;
    let answer = connection
        .request(json!({
            "type": "updateWatchedFolder",
            "id": id,
            "path": path,
            "isEnabled": is_enabled,
            "presetIds": preset_ids,
        }))
        .await?;
    mutation_result(&settings, &answer)
}

/// Stops watching a folder; its files are left alone
pub async fn remove(id: Option<String>, path: Option<String>) -> Result<Value, CliError> {
    if is_empty(&id) && is_empty(&path) {
        return Err(CliError::usage(
            "Give the watched folder's id (from list_watched_folders) or its path.",
        ));
    }
    let mut connection = Connection::open(|_| {}).await?;
    let settings = settings_from(&mut connection).await?;
    let answer = connection
        .request(json!({
            "type": "removeWatchedFolder",
            "id": id,
            "path": path,
        }))
        .await?;
    mutation_result(&settings, &answer)
}

fn is_empty(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|value| value.trim().is_empty())
}

/// A folder to watch: an existing, readable folder that is not a filesystem root
fn checked_path(path: &str) -> Result<String, CliError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(CliError::usage("Give the folder to watch."));
    }
    let folder = Path::new(path);
    if !folder.is_absolute() {
        return Err(CliError::usage(
            "Use an absolute path for the folder to watch.",
        ));
    }
    if folder.parent().is_none() {
        return Err(CliError::new(
            exit_code::USAGE,
            "rootFolder",
            "Watching a filesystem root is not supported. Choose a folder inside it.",
        ));
    }
    match std::fs::metadata(folder) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => {
            return Err(CliError::new(
                exit_code::USAGE,
                "missingFolder",
                format!("{} is not a folder.", folder.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(CliError::new(
                exit_code::USAGE,
                "missingFolder",
                format!("The folder {} does not exist.", folder.display()),
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(CliError::new(
                exit_code::APP,
                "accessDenied",
                format!(
                    "CompressO cannot read {}. Allow it access in the system's settings.",
                    folder.display()
                ),
            ));
        }
        Err(error) => {
            return Err(CliError::app(format!(
                "CompressO cannot read {}: {}",
                folder.display(),
                error
            )));
        }
    }
    Ok(folder
        .to_string_lossy()
        .trim_end_matches(['/', '\\'])
        .to_string())
}

/// The preset ids of the choices given, by media type; `None` when nothing was chosen
fn resolve_presets(
    settings: &Settings,
    presets: Option<PresetChanges>,
) -> Result<Option<Value>, CliError> {
    let Some(presets) = presets else {
        return Ok(None);
    };
    let mut resolved = serde_json::Map::new();
    for (media_type, value) in [
        ("video", presets.video),
        ("image", presets.image),
        ("audio", presets.audio),
    ] {
        if let Some(value) = value.filter(|value| !value.trim().is_empty()) {
            let id = settings.preset_choice_id(media_type, &value)?;
            resolved.insert(media_type.to_string(), json!(id));
        }
    }
    Ok(if resolved.is_empty() {
        None
    } else {
        Some(Value::Object(resolved))
    })
}

fn mutation_result(settings: &Settings, answer: &Value) -> Result<Value, CliError> {
    let folders: Vec<WatchedFolder> = serde_json::from_value(answer["watchedFolders"].clone())
        .map_err(|_| {
            CliError::app("CompressO sent watched folders this command line cannot read.")
        })?;
    let folders = statuses(settings, &folders);
    let mut result = json!({ "watchedFolders": folders });
    if let Some(folder_id) = answer["folderId"].as_str() {
        if let Some(folder) = result["watchedFolders"].as_array().and_then(|folders| {
            folders
                .iter()
                .find(|folder| folder["id"].as_str() == Some(folder_id))
        }) {
            result["folder"] = folder.clone();
        }
    }
    for key in ["added", "updated", "removed"] {
        if let Some(value) = answer.get(key) {
            if !value.is_null() {
                result[key] = value.clone();
            }
        }
    }
    Ok(result)
}

fn statuses(settings: &Settings, folders: &[WatchedFolder]) -> Vec<Value> {
    folders
        .iter()
        .map(|folder| status(settings, folder))
        .collect()
}

fn status(settings: &Settings, folder: &WatchedFolder) -> Value {
    let exists = Path::new(&folder.path).is_dir();
    let has_tray = cfg!(any(target_os = "macos", windows));
    let mut can_save = true;
    let mut preset_ids = serde_json::Map::new();
    let mut presets = serde_json::Map::new();
    for media_type in MEDIA_TYPES {
        let (choice, preset) =
            settings.resolve_watched_preset(media_type, folder.preset_choice(media_type));
        preset_ids.insert(media_type.to_string(), json!(choice));
        match preset {
            Some(preset) => {
                presets.insert(
                    media_type.to_string(),
                    json!({ "id": preset.id, "name": preset.name }),
                );
                if !preset.output.saves_automatically() {
                    can_save = false;
                }
            }
            None => can_save = false,
        }
    }
    let mut warnings = Vec::new();
    if !exists {
        warnings.push("missingFolder");
    }
    if !can_save {
        warnings.push("saveLocation");
    }
    if has_tray && !settings.show_menu_bar_icon {
        warnings.push("menuBarIconOff");
    }
    let is_watched =
        folder.is_enabled && exists && can_save && (!has_tray || settings.show_menu_bar_icon);
    json!({
        "id": folder.id,
        "path": folder.path,
        "name": folder_name(&folder.path),
        "isEnabled": folder.is_enabled,
        "isWatched": is_watched,
        "exists": exists,
        "presetIds": preset_ids,
        "presets": presets,
        "canSave": can_save,
        "warnings": warnings,
    })
}

fn folder_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Preset, PresetOutput, DEFAULT_PRESET_CHOICE};
    use std::collections::HashMap;

    fn fixed_output() -> PresetOutput {
        PresetOutput {
            save_location: "sameFolder".to_string(),
            save_folder: None,
            file_name_template: None,
            file_prefix: String::new(),
        }
    }

    fn ask_output() -> PresetOutput {
        PresetOutput {
            save_location: "ask".to_string(),
            save_folder: None,
            file_name_template: None,
            file_prefix: String::new(),
        }
    }

    fn settings() -> Settings {
        Settings {
            presets: vec![
                Preset {
                    id: "standard".to_string(),
                    name: "Standard".to_string(),
                    media_type: "video".to_string(),
                    is_default: true,
                    revision: None,
                    updated_at: None,
                    output: fixed_output(),
                    summary: Vec::new(),
                    contract: None,
                },
                Preset {
                    id: "web".to_string(),
                    name: "Web".to_string(),
                    media_type: "image".to_string(),
                    is_default: false,
                    revision: None,
                    updated_at: None,
                    output: fixed_output(),
                    summary: Vec::new(),
                    contract: None,
                },
                Preset {
                    id: "audio".to_string(),
                    name: "Audio".to_string(),
                    media_type: "audio".to_string(),
                    is_default: false,
                    revision: None,
                    updated_at: None,
                    output: fixed_output(),
                    summary: Vec::new(),
                    contract: None,
                },
            ],
            default_preset_ids: HashMap::new(),
            output: crate::settings::OutputSettings {
                skip_larger_outputs: false,
                preserve_folder_structure: true,
                replace_original_files: false,
                use_hardware_acceleration: false,
                reach_target_sizes_without_acceleration: true,
            },
            extensions: HashMap::new(),
            output_extensions: HashMap::new(),
            show_menu_bar_icon: true,
            watched_folders: None,
            contract_schemas: None,
            contract_capabilities: None,
        }
    }

    fn watched_folder(path: &str, video: &str, image: &str) -> WatchedFolder {
        WatchedFolder {
            id: "folder".to_string(),
            path: path.to_string(),
            is_enabled: true,
            preset_ids: crate::settings::WatchedFolderPresetIds {
                video: video.to_string(),
                image: image.to_string(),
                audio: String::new(),
            },
        }
    }

    fn existing_folder() -> String {
        std::env::temp_dir()
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .to_string()
    }

    #[test]
    fn resolves_default_and_named_presets() {
        let settings = settings();
        let folder = watched_folder(&existing_folder(), "standard", "web");
        let status = status(&settings, &folder);
        assert_eq!(status["presetIds"]["video"], "standard");
        assert_eq!(status["presetIds"]["image"], "web");
        assert_eq!(status["presetIds"]["audio"], DEFAULT_PRESET_CHOICE);
        assert_eq!(status["presets"]["image"]["name"], "Web");
        assert_eq!(status["canSave"], true);
        assert_eq!(status["isWatched"], true);
    }

    #[test]
    fn resolves_preset_names_to_ids() {
        let settings = settings();
        assert_eq!(settings.preset_choice_id("image", "Web").unwrap(), "web");
        assert_eq!(
            settings.preset_choice_id("video", "Standard").unwrap(),
            "standard"
        );
        assert_eq!(
            settings.preset_choice_id("audio", "default").unwrap(),
            DEFAULT_PRESET_CHOICE
        );
    }

    #[test]
    fn a_missing_folder_is_not_watched() {
        let settings = settings();
        let folder = watched_folder("/this/folder/does/not/exist", "", "");
        let status = status(&settings, &folder);
        assert_eq!(status["exists"], false);
        assert_eq!(status["isWatched"], false);
        assert!(status["warnings"]
            .as_array()
            .unwrap()
            .contains(&json!("missingFolder")));
    }

    #[test]
    fn a_folder_whose_presets_ask_where_to_save_is_not_watched() {
        let mut settings = settings();
        settings.presets[1].output = ask_output();
        let folder = watched_folder(&existing_folder(), "", "Web");
        let status = status(&settings, &folder);
        assert_eq!(status["canSave"], false);
        assert_eq!(status["isWatched"], false);
        assert!(status["warnings"]
            .as_array()
            .unwrap()
            .contains(&json!("saveLocation")));
    }
}
