//! The presets & settings of the app (see `cli_settings.rs` in the app)
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::CliError;

pub const MEDIA_TYPES: [&str; 3] = ["video", "image", "audio"];

/// The preset choice of a watched folder that follows the default preset
pub const DEFAULT_PRESET_CHOICE: &str = "default";

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub presets: Vec<Preset>,
    #[serde(default)]
    pub default_preset_ids: HashMap<String, String>,
    pub output: OutputSettings,
    #[serde(default)]
    pub extensions: HashMap<String, Vec<String>>,
    /// The formats each media type can be saved in (a video also as audio)
    #[serde(default)]
    pub output_extensions: HashMap<String, Vec<String>>,
    /// Settings -> General, needed to tell whether watched folders are actually watched (macOS &
    /// Windows need the menu bar / tray icon)
    #[serde(default = "default_true")]
    pub show_menu_bar_icon: bool,
    /// Settings -> Watch Folder; `None` when written by an older app
    #[serde(default)]
    pub watched_folders: Option<Vec<WatchedFolder>>,
}

/// A folder whose new media the app compresses, as the app stores it
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: String,
    pub path: String,
    pub is_enabled: bool,
    #[serde(default)]
    pub preset_ids: WatchedFolderPresetIds,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolderPresetIds {
    #[serde(default)]
    pub video: String,
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub audio: String,
}

impl WatchedFolder {
    /// The stored preset choice of a media type (`default` when none was chosen)
    pub fn preset_choice(&self, media_type: &str) -> &str {
        let choice = match media_type {
            "video" => &self.preset_ids.video,
            "image" => &self.preset_ids.image,
            _ => &self.preset_ids.audio,
        };
        if choice.is_empty() {
            DEFAULT_PRESET_CHOICE
        } else {
            choice
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub is_default: bool,
    pub output: PresetOutput,
    #[serde(default)]
    pub summary: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PresetOutput {
    /// `sameFolder`, `fixedFolder` or `ask`
    pub save_location: String,
    pub save_folder: Option<String>,
    pub file_prefix: String,
}

impl PresetOutput {
    /// Whether outputs are saved without asking where (see `savesAutomatically` in the app)
    pub fn saves_automatically(&self) -> bool {
        self.save_location == "sameFolder"
            || (self.save_location == "fixedFolder"
                && self
                    .save_folder
                    .as_deref()
                    .is_some_and(|folder| !folder.is_empty()))
    }
}

/// Settings -> Output, by the names of the command line's options
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputSettings {
    pub skip_larger_outputs: bool,
    pub preserve_folder_structure: bool,
    pub replace_original_files: bool,
    /// `useHardwareAcceleration` in the app's settings, `hardwareAcceleration` as the command line
    /// shows it (`--hardware-acceleration`)
    #[serde(rename(
        serialize = "hardwareAcceleration",
        deserialize = "useHardwareAcceleration"
    ))]
    pub use_hardware_acceleration: bool,
    pub reach_target_sizes_without_acceleration: bool,
}

impl Settings {
    /// The settings the app wrote last (without starting it), if it ever ran
    pub fn from_file() -> Option<Self> {
        let text = std::fs::read_to_string(crate::app::settings_file()?).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn presets_of<'a>(&'a self, media_type: &str) -> impl Iterator<Item = &'a Preset> {
        let media_type = media_type.to_string();
        self.presets
            .iter()
            .filter(move |preset| preset.media_type == media_type)
    }

    /// The default preset of a media type (the Standard preset unless another is starred)
    pub fn default_preset(&self, media_type: &str) -> Option<&Preset> {
        let id = self.default_preset_ids.get(media_type);
        self.presets_of(media_type)
            .find(|preset| Some(&preset.id) == id)
            .or_else(|| self.presets_of(media_type).find(|preset| preset.is_default))
            .or_else(|| self.presets_of(media_type).next())
    }

    /// A preset of a media type by its name (in any case) or id, or the default preset
    pub fn find_preset(&self, media_type: &str, name: Option<&str>) -> Result<&Preset, CliError> {
        let Some(name) = name else {
            return self
                .default_preset(media_type)
                .ok_or_else(|| CliError::app(format!("CompressO has no {media_type} presets.")));
        };
        let wanted = name.trim().to_lowercase();
        self.presets_of(media_type)
            .find(|preset| preset.name.to_lowercase() == wanted)
            .or_else(|| self.presets_of(media_type).find(|preset| preset.id == name))
            .ok_or_else(|| {
                let names: Vec<String> = self
                    .presets_of(media_type)
                    .map(|preset| format!("\"{}\"", preset.name))
                    .collect();
                CliError::new(
                    crate::error::exit_code::USAGE,
                    "unknownPreset",
                    format!(
                        "There is no {media_type} preset named \"{name}\". The {media_type} presets are {}.",
                        names.join(", ")
                    ),
                )
            })
    }

    /// The preset id a watched folder's choice stands for: `default`, or a preset by name or id
    pub fn preset_choice_id(&self, media_type: &str, value: &str) -> Result<String, CliError> {
        let value = value.trim();
        if value.is_empty() || value.eq_ignore_ascii_case(DEFAULT_PRESET_CHOICE) {
            return Ok(DEFAULT_PRESET_CHOICE.to_string());
        }
        self.find_preset(media_type, Some(value))
            .map(|preset| preset.id.clone())
    }

    /// A watched folder's preset choice, normalized (`default` for none or a deleted preset),
    /// with the preset it stands for now
    pub fn resolve_watched_preset<'a>(
        &'a self,
        media_type: &str,
        choice: &str,
    ) -> (String, Option<&'a Preset>) {
        let is_default = choice.is_empty() || choice.eq_ignore_ascii_case(DEFAULT_PRESET_CHOICE);
        let preset = if is_default {
            self.default_preset(media_type)
        } else {
            self.presets_of(media_type)
                .find(|preset| preset.id == choice || preset.name.eq_ignore_ascii_case(choice))
        };
        match preset {
            Some(preset) if is_default => (DEFAULT_PRESET_CHOICE.to_string(), Some(preset)),
            Some(preset) => (preset.id.clone(), Some(preset)),
            None => (
                DEFAULT_PRESET_CHOICE.to_string(),
                self.default_preset(media_type),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with_watched_folders() -> serde_json::Value {
        serde_json::json!({
            "presets": [],
            "defaultPresetIds": {},
            "output": {
                "skipLargerOutputs": false,
                "preserveFolderStructure": true,
                "replaceOriginalFiles": false,
                "useHardwareAcceleration": false,
                "reachTargetSizesWithoutAcceleration": true,
            },
            "extensions": {},
            "outputExtensions": {},
            "showMenuBarIcon": false,
            "watchedFolders": [{
                "id": "folder-1",
                "path": "/Users/me/Desktop/Screenshots",
                "isEnabled": true,
                "presetIds": { "video": "default", "image": "web", "audio": "" },
            }],
        })
    }

    #[test]
    fn reads_watched_folders_and_the_menu_bar_setting() {
        let settings: Settings = serde_json::from_value(settings_with_watched_folders()).unwrap();
        assert!(!settings.show_menu_bar_icon);
        let folders = settings.watched_folders.unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].preset_choice("video"), "default");
        assert_eq!(folders[0].preset_choice("image"), "web");
        assert_eq!(folders[0].preset_choice("audio"), "default");
    }

    #[test]
    fn reads_settings_written_before_watched_folders() {
        let mut value = settings_with_watched_folders();
        value.as_object_mut().unwrap().remove("watchedFolders");
        value.as_object_mut().unwrap().remove("showMenuBarIcon");
        let settings: Settings = serde_json::from_value(value).unwrap();
        assert!(settings.watched_folders.is_none());
        // The app's default, so folders are not reported as unwatched on macOS & Windows
        assert!(settings.show_menu_bar_icon);
    }
}
