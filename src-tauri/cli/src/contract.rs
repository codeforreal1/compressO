//! CompressO JSON contract helpers: schema lookup, reading JSON from file or stdin, and
//! validating contracts via the app.
use std::io::Read;

use serde_json::{json, Value};

use crate::client::Connection;
use crate::error::{exit_code, CliError};
use crate::settings::{Settings, MEDIA_TYPES};

pub fn read_json_input(source: &str) -> Result<Value, CliError> {
    let raw = if source == "-" {
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|err| CliError::usage(format!("Could not read JSON from stdin: {err}")))?;
        buf
    } else {
        std::fs::read_to_string(source).map_err(|err| {
            CliError::new(
                exit_code::USAGE,
                "missingInput",
                format!("Could not read {source}: {err}"),
            )
        })?
    };
    serde_json::from_str(&raw).map_err(|err| {
        CliError::new(
            exit_code::USAGE,
            "invalidJson",
            format!("Invalid JSON in {source}: {err}"),
        )
    })
}

pub fn check_media_type(media_type: &str) -> Result<&'static str, CliError> {
    MEDIA_TYPES
        .into_iter()
        .find(|value| *value == media_type)
        .ok_or_else(|| {
            CliError::usage(format!(
                "Unknown media type \"{media_type}\". Use video, image, or audio."
            ))
        })
}

pub async fn load_settings() -> Result<Settings, CliError> {
    match Settings::from_file() {
        Some(settings) if settings.contract_schemas.is_some() => Ok(settings),
        _ => crate::fetch_settings().await,
    }
}

pub async fn schema(media_type: &str) -> Result<Value, CliError> {
    let media_type = check_media_type(media_type)?;
    let settings = load_settings().await?;
    settings
        .contract_schemas
        .as_ref()
        .and_then(|schemas| schemas.get(media_type))
        .cloned()
        .ok_or_else(|| CliError::app("CompressO has not synced its contract schemas yet."))
}

pub async fn validate_value(
    contract: Value,
    mode: Option<&str>,
    require_name: bool,
) -> Result<Value, CliError> {
    let mut connection = Connection::open(|_| {}).await?;
    validate_with_connection(&mut connection, contract, mode, require_name).await
}

pub async fn validate_with_connection(
    connection: &mut Connection,
    contract: Value,
    mode: Option<&str>,
    require_name: bool,
) -> Result<Value, CliError> {
    connection
        .send(json!({
            "type": "validateContract",
            "contract": contract,
            "mode": mode,
            "requireName": require_name,
        }))
        .await?;
    let answer = connection.recv().await?;
    if answer["type"] == "error" {
        return Err(contract_error(&answer));
    }
    Ok(answer)
}

pub fn contract_error(message: &Value) -> CliError {
    if let Some(errors) = message["errors"].as_array().filter(|list| !list.is_empty()) {
        let details: Vec<String> = errors
            .iter()
            .map(|entry| {
                let path = entry["path"].as_str().unwrap_or("/");
                let msg = entry["message"].as_str().unwrap_or("Invalid field");
                format!("{path}: {msg}")
            })
            .collect();
        let code = match message["code"].as_str() {
            Some("presetDisallowedField") => "presetDisallowedField",
            Some("presetExists") => "presetExists",
            Some("unknownPreset") => "unknownPreset",
            Some("ambiguousPreset") => "ambiguousPreset",
            Some("standardPresetReadOnly") => "standardPresetReadOnly",
            Some("mediaTypeMismatch") => "mediaTypeMismatch",
            Some("revisionConflict") => "revisionConflict",
            _ => "invalidContract",
        };
        return CliError::new(exit_code::USAGE, code, details.join("; "));
    }
    crate::client::app_error(message)
}
