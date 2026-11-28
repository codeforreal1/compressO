//! Preset & contract commands asked for by the command line or MCP (`cli_server`): executes
//! directly inside Rust `core::contract` + `core::presets`, working identically whether WebViews
//! are open or CompressO is running headlessly.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::core::contract;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum PresetCommand {
    #[serde(rename = "getPreset")]
    GetPreset {
        #[serde(rename = "idOrName")]
        id_or_name: String,
        #[serde(rename = "mediaType", skip_serializing_if = "Option::is_none")]
        media_type: Option<String>,
    },
    #[serde(rename = "validateContract")]
    ValidateContract {
        contract: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(rename = "requireName", skip_serializing_if = "Option::is_none")]
        require_name: Option<bool>,
    },
    #[serde(rename = "createPreset")]
    CreatePreset {
        contract: Value,
        #[serde(rename = "onConflict", skip_serializing_if = "Option::is_none")]
        on_conflict: Option<String>,
    },
    #[serde(rename = "updatePreset")]
    UpdatePreset {
        #[serde(rename = "idOrName")]
        id_or_name: String,
        patch: Value,
        #[serde(rename = "mediaType", skip_serializing_if = "Option::is_none")]
        media_type: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        replace: Option<bool>,
        #[serde(rename = "ifRevision", skip_serializing_if = "Option::is_none")]
        if_revision: Option<u64>,
    },
    #[serde(rename = "deletePreset")]
    DeletePreset {
        #[serde(rename = "idOrName")]
        id_or_name: String,
        #[serde(rename = "mediaType", skip_serializing_if = "Option::is_none")]
        media_type: Option<String>,
    },
    #[serde(rename = "setDefaultPreset")]
    SetDefaultPreset {
        #[serde(rename = "idOrName")]
        id_or_name: String,
        #[serde(rename = "mediaType")]
        media_type: String,
    },
}

pub async fn forward(app_handle: &AppHandle, command: PresetCommand) -> Result<Value, String> {
    match command {
        PresetCommand::GetPreset {
            id_or_name,
            media_type,
        } => Ok(contract::get_preset(
            app_handle,
            &id_or_name,
            media_type.as_deref(),
        )),
        PresetCommand::ValidateContract {
            contract: raw,
            mode,
            require_name,
        } => Ok(contract::validate_contract_value(
            &raw,
            mode.as_deref(),
            require_name,
        )),
        PresetCommand::CreatePreset {
            contract: raw,
            on_conflict,
        } => contract::create_preset(app_handle, &raw, on_conflict.as_deref()),
        PresetCommand::UpdatePreset {
            id_or_name,
            patch,
            media_type,
            replace,
            if_revision,
        } => contract::update_preset(
            app_handle,
            &id_or_name,
            &patch,
            media_type.as_deref(),
            replace,
            if_revision,
        ),
        PresetCommand::DeletePreset {
            id_or_name,
            media_type,
        } => contract::delete_preset(app_handle, &id_or_name, media_type.as_deref()),
        PresetCommand::SetDefaultPreset {
            id_or_name,
            media_type,
        } => contract::set_default_preset(app_handle, &id_or_name, &media_type),
    }
}
