//! The presets & settings of the app (see `cli_settings.rs` in the app)
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::CliError;

pub const MEDIA_TYPES: [&str; 3] = ["video", "image", "audio"];

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
}
