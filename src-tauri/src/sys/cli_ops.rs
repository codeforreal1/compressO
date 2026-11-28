//! Diagnostic, inspection, cache, history, queue, and log handlers for the CLI socket server.
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::core::{
    cpu_limit, ffprobe, hardware_encoder, image_codecs, image_dynamic_range,
    image_info::ImageInfo,
    tool_bundle, video_dynamic_range,
};
use crate::tauri_commands::compression_status;
use crate::tauri_commands::drop_queue;
use crate::tauri_commands::fs as fs_commands;

pub async fn capabilities(
    app_handle: &AppHandle,
    protocol_version: u64,
    source: &str,
) -> Value {
    let available = cpu_limit::available_cpu_threads();
    let global_limit = cpu_limit::thread_limit();
    let encoders = hardware_encoder::available_encoders(app_handle)
        .await
        .iter()
        .map(|enc| enc.name)
        .collect::<Vec<_>>();
    let log_file = crate::sys::logging::log_file_path()
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let cache_block = fs_commands::cache_clear_block_reason(app_handle);

    log::info!(
        "[{source}] Reported capabilities ({} CPU threads, {} hardware encoders)",
        available,
        encoders.len()
    );
    json!({
        "type": "capabilities",
        "version": app_handle.package_info().version.to_string(),
        "protocol": protocol_version,
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "cpuThreads": {
            "available": available,
            "globalLimit": global_limit,
        },
        "hardwareEncodingGlobalEnabled": hardware_encoder::is_enabled(),
        "hardwareEncoders": encoders,
        "tools": tool_bundle::get_tool_status(app_handle.clone()),
        "settingsReady": crate::sys::cli_settings::get().is_some(),
        "logFilePath": log_file,
        "cache": {
            "canClear": cache_block.is_none(),
            "blockReason": cache_block,
        },
    })
}

async fn inspect_single_file(app_handle: &AppHandle, path: &str, media_type: &str) -> Value {
    let metadata = crate::sys::fs::get_file_metadata(path).ok();
    if media_type == "image" {
        let basic = ImageInfo::get_basic_info(path).ok();
        let ext = image_codecs::extension(path);
        let dimensions = if image_codecs::is_modern(&ext) {
            match Box::pin(image_codecs::decoded_png(app_handle, path, None, &[])).await {
                Ok(decoded) => decoded
                    .to_str()
                    .and_then(|s| ImageInfo::get_dimensions(s).ok()),
                Err(_) => None,
            }
        } else {
            ImageInfo::get_dimensions(path).ok()
        };
        let dynamic_range = Box::pin(image_dynamic_range::inspect_source(
            app_handle, path, None, &[],
        ))
        .await
        .ok()
        .map(|(info, _)| info);
        let exif = ImageInfo::get_exif_info(path).ok();
        return json!({
            "path": path,
            "mediaType": media_type,
            "metadata": metadata,
            "basicInfo": basic,
            "dimensions": dimensions,
            "dynamicRange": dynamic_range,
            "exif": exif,
        });
    }

    let Ok(mut probe) = ffprobe::FFPROBE::new(app_handle) else {
        return json!({
            "path": path,
            "mediaType": media_type,
            "metadata": metadata,
            "error": "Could not initialize ffprobe.",
        });
    };
    let basic = probe.get_video_basic_info(path).await.ok();
    let container = probe.get_container_info(path).await.ok();
    let video_streams = if media_type == "video" {
        probe.get_video_streams(path).await.ok()
    } else {
        None
    };
    let audio_streams = probe.get_audio_streams(path).await.ok();
    let subtitle_streams = if media_type == "video" {
        probe.get_subtitle_streams(path).await.ok()
    } else {
        None
    };
    let dynamic_range = if media_type == "video" {
        probe
            .get_video_color(path)
            .await
            .ok()
            .flatten()
            .map(|color| video_dynamic_range::classify(&color))
    } else {
        None
    };

    json!({
        "path": path,
        "mediaType": media_type,
        "metadata": metadata,
        "basicInfo": basic,
        "container": container,
        "videoStreams": video_streams,
        "audioStreams": audio_streams,
        "subtitleStreams": subtitle_streams,
        "dynamicRange": dynamic_range,
    })
}

pub async fn inspect(app_handle: &AppHandle, inputs: &[String], source: &str) -> Value {
    let mut inspected = Vec::new();
    let mut unsupported = Vec::new();
    let mut unreadable = Vec::new();

    for input in inputs {
        match fs_commands::allow_asset_scopes(app_handle, vec![input.clone()]) {
            Ok(files) => {
                for file in files {
                    match crate::sys::cli_settings::media_type(&file.path) {
                        Some(media_type) => {
                            inspected
                                .push(inspect_single_file(app_handle, &file.path, media_type).await);
                        }
                        None => unsupported.push(file.path),
                    }
                }
            }
            Err(err) => unreadable.push(json!({ "path": input, "error": err })),
        }
    }

    log::info!(
        "[{source}] Inspected {} file(s) ({} unsupported, {} unreadable)",
        inspected.len(),
        unsupported.len(),
        unreadable.len()
    );
    json!({
        "type": "inspectResult",
        "files": inspected,
        "unsupported": unsupported,
        "unreadable": unreadable,
    })
}

pub async fn clear_cache(
    app_handle: &AppHandle,
    source: &str,
) -> Result<Value, (&'static str, String)> {
    if let Some(reason) = fs_commands::cache_clear_block_reason(app_handle) {
        log::warn!("[{source}] Refused cache clear: {}", reason);
        return Err(("busy", reason.to_string()));
    }
    fs_commands::clear_cache_if_idle(app_handle)
        .await
        .map_err(|err| ("cacheClearFailed", err))?;
    log::info!("[{source}] Cache cleared");
    Ok(json!({
        "type": "cacheCleared",
        "cleared": true,
    }))
}

pub fn history_list(app_handle: &AppHandle, limit: Option<usize>, source: &str) -> Value {
    let all = crate::sys::history::get_history(app_handle.clone());
    let total = all.len();
    let max = limit.filter(|n| *n > 0);
    // Stored oldest-first; return newest-first so recent compressions appear at the top
    let entries: Vec<_> = match max {
        Some(n) => all.into_iter().rev().take(n).collect(),
        None => all.into_iter().rev().collect(),
    };
    log::info!(
        "[{source}] Listed {} of {} history entries",
        entries.len(),
        total
    );
    json!({
        "type": "history",
        "total": total,
        "entries": entries,
    })
}

pub fn history_clear(app_handle: &AppHandle, source: &str) -> Value {
    crate::sys::history::clear_history(app_handle.clone());
    log::info!("[{source}] Cleared compression history");
    json!({
        "type": "historyCleared",
        "cleared": true,
    })
}

pub fn queue_status(app_handle: &AppHandle, source: &str) -> Value {
    let items = drop_queue::get_drop_queue(app_handle.clone());
    let paused = drop_queue::is_drop_queue_paused();
    let active = drop_queue::is_queue_active(app_handle);
    let main_status = compression_status::get_compression_status(app_handle.clone());
    log::info!(
        "[{source}] Reported queue status ({} items, paused={})",
        items.len(),
        paused
    );
    json!({
        "type": "queue",
        "paused": paused,
        "active": active,
        "mainStatus": main_status,
        "items": items,
    })
}

pub fn queue_action(
    app_handle: &AppHandle,
    action: &str,
    source: &str,
) -> Result<Value, (&'static str, String)> {
    match action {
        "pause" => {
            drop_queue::set_drop_queue_paused(app_handle.clone(), true);
            log::info!("[{source}] Paused drop queue");
        }
        "resume" => {
            drop_queue::set_drop_queue_paused(app_handle.clone(), false);
            log::info!("[{source}] Resumed drop queue");
        }
        "clear" => {
            drop_queue::clear_finished_drop_queue(app_handle.clone());
            log::info!("[{source}] Cleared finished drop queue items");
        }
        "cancel" => {
            drop_queue::cancel_drop_queue(app_handle.clone());
            log::info!("[{source}] Cancelled active drop queue items");
        }
        other => {
            log::warn!("[{source}] Rejected unknown queue action: {other}");
            return Err((
                "invalidRequest",
                format!("Unknown queue action: {other}"),
            ));
        }
    }
    Ok(json!({
        "type": "queueUpdated",
        "action": action,
        "paused": drop_queue::is_drop_queue_paused(),
        "active": drop_queue::is_queue_active(app_handle),
    }))
}

pub fn logs(tail: Option<usize>, source: &str) -> Result<Value, (&'static str, String)> {
    log::logger().flush();
    let path = crate::sys::logging::log_file_path()
        .map_err(|err| ("logsUnavailable", err))?;
    let path_str = path.to_string_lossy().to_string();
    let lines: Vec<String> = match tail {
        Some(0) => Vec::new(),
        Some(n) => {
            let contents = std::fs::read_to_string(&path)
                .map_err(|err| ("logsUnavailable", err.to_string()))?;
            let collected: Vec<String> = contents.lines().map(String::from).collect();
            let start = collected.len().saturating_sub(n);
            collected[start..].to_vec()
        }
        None => {
            let contents = std::fs::read_to_string(&path)
                .map_err(|err| ("logsUnavailable", err.to_string()))?;
            let collected: Vec<String> = contents.lines().map(String::from).collect();
            let start = collected.len().saturating_sub(100);
            collected[start..].to_vec()
        }
    };
    log::info!(
        "[{source}] Read log file ({} line(s) returned)",
        lines.len()
    );
    Ok(json!({
        "type": "logs",
        "path": path_str,
        "lines": lines,
    }))
}

pub fn settings_get(
    app_handle: &AppHandle,
    key: Option<&str>,
    source: &str,
) -> Result<Value, (&'static str, String)> {
    let current = crate::core::settings::get(app_handle);
    if let Some(key) = key {
        let value = crate::core::settings::read_key(&current, key)?;
        log::info!("[{source}] Read domain setting `{key}`");
        return Ok(json!({
            "type": "domainSetting",
            "key": key,
            "value": value,
            "settings": current,
        }));
    }
    log::info!("[{source}] Read domain settings");
    Ok(json!({
        "type": "domainSettings",
        "settings": current,
    }))
}

pub fn settings_update(
    app_handle: &AppHandle,
    patch: &Value,
    source: &str,
) -> Result<Value, (&'static str, String)> {
    let keys: Vec<String> = patch
        .as_object()
        .map(|obj| obj.keys().cloned().collect())
        .unwrap_or_default();
    let updated = crate::core::settings::patch_from_json(app_handle, patch)?;
    log::info!(
        "[{source}] Updated domain setting(s): {}",
        keys.join(", ")
    );
    Ok(json!({
        "type": "domainSettings",
        "settings": updated,
        "updatedKeys": keys,
    }))
}
