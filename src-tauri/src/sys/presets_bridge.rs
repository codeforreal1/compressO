//! Preset & contract commands sent from the command line / MCP server to the frontend window.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::core::domain::CustomEvents;

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
    crate::sys::window_bridge::forward(
        app_handle,
        CustomEvents::PresetsCommand.as_ref(),
        &command,
        "presets",
    )
    .await
}

#[tauri::command]
pub fn complete_presets_command(request_id: String, result: Value) {
    crate::sys::window_bridge::complete(request_id, result);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_preset_commands_for_frontend() {
        let cmd = PresetCommand::CreatePreset {
            contract: json!({ "version": 1, "mediaType": "video", "name": "Web" }),
            on_conflict: Some(String::from("rename")),
        };
        assert_eq!(
            serde_json::to_value(cmd).unwrap(),
            json!({
                "type": "createPreset",
                "contract": { "version": 1, "mediaType": "video", "name": "Web" },
                "onConflict": "rename",
            })
        );

        let upd = PresetCommand::UpdatePreset {
            id_or_name: String::from("Web"),
            patch: json!({ "settings": { "format": "mp4" } }),
            media_type: Some(String::from("video")),
            replace: Some(false),
            if_revision: Some(2),
        };
        assert_eq!(
            serde_json::to_value(upd).unwrap(),
            json!({
                "type": "updatePreset",
                "idOrName": "Web",
                "patch": { "settings": { "format": "mp4" } },
                "mediaType": "video",
                "replace": false,
                "ifRevision": 2,
            })
        );
    }
}
