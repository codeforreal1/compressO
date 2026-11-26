//! Preset management via CompressO JSON contracts (`compresso presets ...` and MCP tools).
use serde_json::{json, Value};

use crate::client::Connection;
use crate::contract::{check_media_type, contract_error, read_json_input};
use crate::error::CliError;
use crate::settings::Settings;

pub async fn get(id_or_name: &str, media_type: Option<&str>) -> Result<Value, CliError> {
    let media_type = match media_type {
        Some(value) => Some(check_media_type(value)?),
        None => None,
    };

    // Offline lookup from cli-settings.json when available
    if let Some(settings) = Settings::from_file() {
        let trimmed = id_or_name.trim();
        let lower = trimmed.to_lowercase();
        let matches: Vec<_> = settings
            .presets
            .iter()
            .filter(|preset| media_type.is_none_or(|mt| preset.media_type == mt))
            .filter(|preset| preset.id == trimmed || preset.name.to_lowercase() == lower)
            .collect();
        if matches.len() == 1 {
            if let Some(contract) = &matches[0].contract {
                return Ok(json!({
                    "preset": {
                        "id": matches[0].id,
                        "name": matches[0].name,
                        "mediaType": matches[0].media_type,
                        "isDefault": matches[0].is_default,
                        "revision": matches[0].revision.unwrap_or(1),
                        "updatedAt": matches[0].updated_at,
                        "output": matches[0].output,
                        "summary": matches[0].summary,
                        "contract": contract,
                    }
                }));
            }
        }
    }

    let mut connection = Connection::open(|_| {}).await?;
    connection
        .send(json!({
            "type": "getPreset",
            "idOrName": id_or_name,
            "mediaType": media_type,
        }))
        .await?;
    let answer = connection.recv().await?;
    if answer["type"] == "error" {
        return Err(contract_error(&answer));
    }
    Ok(strip_type(answer))
}

pub async fn create_from_file(
    source: &str,
    on_conflict: Option<&str>,
) -> Result<Value, CliError> {
    let contract = read_json_input(source)?;
    create(contract, on_conflict).await
}

pub async fn create(contract: Value, on_conflict: Option<&str>) -> Result<Value, CliError> {
    let mut connection = Connection::open(|_| {}).await?;
    connection
        .send(json!({
            "type": "createPreset",
            "contract": contract,
            "onConflict": on_conflict,
        }))
        .await?;
    let answer = connection.recv().await?;
    if answer["type"] == "error" {
        return Err(contract_error(&answer));
    }
    Ok(strip_type(answer))
}

pub async fn update_from_file(
    id_or_name: &str,
    source: &str,
    media_type: Option<&str>,
    replace: bool,
    if_revision: Option<u64>,
) -> Result<Value, CliError> {
    let patch = read_json_input(source)?;
    update(id_or_name, patch, media_type, replace, if_revision).await
}

pub async fn update(
    id_or_name: &str,
    patch: Value,
    media_type: Option<&str>,
    replace: bool,
    if_revision: Option<u64>,
) -> Result<Value, CliError> {
    let media_type = match media_type {
        Some(value) => Some(check_media_type(value)?),
        None => None,
    };
    let mut connection = Connection::open(|_| {}).await?;
    connection
        .send(json!({
            "type": "updatePreset",
            "idOrName": id_or_name,
            "patch": patch,
            "mediaType": media_type,
            "replace": replace,
            "ifRevision": if_revision,
        }))
        .await?;
    let answer = connection.recv().await?;
    if answer["type"] == "error" {
        return Err(contract_error(&answer));
    }
    Ok(strip_type(answer))
}

pub async fn delete(id_or_name: &str, media_type: Option<&str>) -> Result<Value, CliError> {
    let media_type = match media_type {
        Some(value) => Some(check_media_type(value)?),
        None => None,
    };
    let mut connection = Connection::open(|_| {}).await?;
    connection
        .send(json!({
            "type": "deletePreset",
            "idOrName": id_or_name,
            "mediaType": media_type,
        }))
        .await?;
    let answer = connection.recv().await?;
    if answer["type"] == "error" {
        return Err(contract_error(&answer));
    }
    Ok(strip_type(answer))
}

pub async fn set_default(id_or_name: &str, media_type: &str) -> Result<Value, CliError> {
    let media_type = check_media_type(media_type)?;
    let mut connection = Connection::open(|_| {}).await?;
    connection
        .send(json!({
            "type": "setDefaultPreset",
            "idOrName": id_or_name,
            "mediaType": media_type,
        }))
        .await?;
    let answer = connection.recv().await?;
    if answer["type"] == "error" {
        return Err(contract_error(&answer));
    }
    Ok(strip_type(answer))
}

fn strip_type(mut value: Value) -> Value {
    if let Some(obj) = value.as_object_mut() {
        obj.remove("type");
    }
    value
}
