//! Socket commands and human output for diagnostics, media inspection, cache, history, queue,
//! and logs.
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::client::Connection;
use crate::error::CliError;
use crate::job::absolute_path;
use crate::output::format_bytes;

pub async fn capabilities() -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "getCapabilities" })).await
}

pub async fn inspect(inputs: Vec<PathBuf>) -> Result<Value, CliError> {
    if inputs.is_empty() {
        return Err(CliError::usage(
            "Give at least one file or folder to inspect. Run compresso --help.",
        ));
    }
    let missing: Vec<String> = inputs
        .iter()
        .filter(|path| !path.exists())
        .map(|path| path.display().to_string())
        .collect();
    if !missing.is_empty() {
        return Err(CliError::new(
            crate::error::exit_code::USAGE,
            "missingInput",
            format!("Does not exist: {}", missing.join(", ")),
        ));
    }
    let resolved: Vec<String> = inputs
        .into_iter()
        .map(|p| absolute_path(&p).display().to_string())
        .collect();
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "inspect", "inputs": resolved }))
        .await
}

pub async fn clear_cache() -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "clearCache" })).await
}

pub async fn history_list(limit: Option<usize>) -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "getHistory", "limit": limit }))
        .await
}

pub async fn history_clear() -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "clearHistory" })).await
}

pub async fn queue_status() -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "getQueue" })).await
}

pub async fn queue_action(action: &str) -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "queueAction", "action": action }))
        .await
}

pub async fn logs(tail: Option<usize>) -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "getLogs", "tail": tail }))
        .await
}

pub async fn settings_get(key: Option<String>) -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "getSettingsConfig", "key": key }))
        .await
}

pub async fn settings_update(patch: Value) -> Result<Value, CliError> {
    let mut conn = Connection::open(|_| {}).await?;
    conn.request(json!({ "type": "updateSettingsConfig", "patch": patch }))
        .await
}

pub fn about_info() -> Value {
    json!({
        "name": "CompressO",
        "tagline": "Compress any image/video into a tiny size.",
        "version": crate::VERSION,
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "offline": true,
        "author": {
            "name": "Code For Real",
            "url": "https://codeforreal.com",
        },
        "license": {
            "spdx": "AGPL-3.0-only",
            "summary": "Free and open-source (Licensed under AGPL-3.0)",
            "url": "https://github.com/codeforreal1/compressO/blob/main/LICENSE",
        },
        "links": {
            "website": "https://compresso.codeforreal.com",
            "changelog": "https://compresso.codeforreal.com/changelog",
            "repository": "https://github.com/codeforreal1/compressO",
            "releases": "https://github.com/codeforreal1/compressO/releases",
            "license": "https://github.com/codeforreal1/compressO/blob/main/LICENSE",
            "thirdPartyNotices": "https://github.com/codeforreal1/compressO/blob/main/THIRD_PARTY_NOTICES.md",
            "author": "https://codeforreal.com",
        },
        "credits": [
            {
                "name": "FFmpeg & FFprobe",
                "copyright": "Copyright © 2000-2024 Fabrice Bellard, et al.",
                "license": "GPL v2+, LGPL v2.1+",
                "website": "https://ffmpeg.org/",
                "github": "https://github.com/FFmpeg/FFmpeg",
            },
            {
                "name": "pngquant",
                "copyright": "Copyright © 2009-2024 Kornel Lesiński",
                "license": "GPL v3+",
                "website": "https://pngquant.org/",
                "github": "https://github.com/kornelski/pngquant",
            },
            {
                "name": "jpegoptim",
                "copyright": "Copyright © 1996-2024 Timo Kokkonen",
                "license": "GPL v3+",
                "website": Value::Null,
                "github": "https://github.com/tjko/jpegoptim",
            },
            {
                "name": "gifski",
                "copyright": "Copyright © 2019-2024 ImageOptim LLC, Kornel Lesiński",
                "license": "AGPL v3+",
                "website": "https://gif.ski/",
                "github": "https://github.com/ImageOptim/gifski/",
            },
        ],
    })
}

pub fn print_about(value: &Value) {
    let name = value["name"].as_str().unwrap_or("CompressO");
    let version = value["version"].as_str().unwrap_or("?");
    let os = value["platform"]["os"].as_str().unwrap_or("?");
    let arch = value["platform"]["arch"].as_str().unwrap_or("?");
    let tagline = value["tagline"].as_str().unwrap_or("");
    let author_name = value["author"]["name"].as_str().unwrap_or("Code For Real");
    let author_url = value["author"]["url"].as_str().unwrap_or("");
    let license_summary = value["license"]["summary"].as_str().unwrap_or("AGPL-3.0");

    println!("{name} {version} ({os}/{arch})");
    println!("{tagline}");
    println!("Made in public by {author_name} ({author_url})");
    println!("License: {license_summary}");
    println!();
    println!("Links:");
    println!("  Website:    {}", value["links"]["website"].as_str().unwrap_or(""));
    println!("  Changelog:  {}", value["links"]["changelog"].as_str().unwrap_or(""));
    println!("  GitHub:     {}", value["links"]["repository"].as_str().unwrap_or(""));
    println!("  Releases:   {}", value["links"]["releases"].as_str().unwrap_or(""));
    println!("  License:    {}", value["links"]["license"].as_str().unwrap_or(""));
    println!("  Notices:    {}", value["links"]["thirdPartyNotices"].as_str().unwrap_or(""));
    if let Some(credits) = value["credits"].as_array() {
        println!();
        println!("Open-source tools:");
        for tool in credits {
            let tname = tool["name"].as_str().unwrap_or("?");
            let tlic = tool["license"].as_str().unwrap_or("?");
            let url = tool["website"]
                .as_str()
                .or_else(|| tool["github"].as_str())
                .unwrap_or("");
            println!("  {tname} ({tlic}) - {url}");
        }
    }
}

pub fn print_capabilities(value: &Value) {
    let version = value["version"].as_str().unwrap_or("?");
    let os = value["platform"]["os"].as_str().unwrap_or("?");
    let arch = value["platform"]["arch"].as_str().unwrap_or("?");
    let available = value["cpuThreads"]["available"].as_u64().unwrap_or(0);
    let global_limit = value["cpuThreads"]["globalLimit"]
        .as_u64()
        .map(|n| n.to_string())
        .unwrap_or_else(|| "all".to_string());
    let encoders: Vec<&str> = value["hardwareEncoders"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let hw_enabled = value["hardwareEncodingGlobalEnabled"]
        .as_bool()
        .unwrap_or(false);
    let can_clear = value["cache"]["canClear"].as_bool().unwrap_or(false);
    let block_reason = value["cache"]["blockReason"].as_str();

    println!("CompressO {version} ({os}/{arch})");
    println!(
        "CPU threads: {available} available (global limit: {global_limit}, per-run: --cpu-threads=<n>)"
    );
    println!(
        "Hardware encoders: {} (global setting: {})",
        if encoders.is_empty() {
            "none".to_string()
        } else {
            encoders.join(", ")
        },
        if hw_enabled { "on" } else { "off" }
    );
    if let Some(log_path) = value["logFilePath"].as_str() {
        println!("Log file: {log_path}");
    }
    match (can_clear, block_reason) {
        (true, _) => println!("Cache: ready to clear (compresso cache clear)"),
        (false, Some(reason)) => println!("Cache: busy ({reason})"),
        (false, None) => println!("Cache: busy"),
    }
}

pub fn print_inspect(value: &Value) {
    let files = value["files"].as_array().cloned().unwrap_or_default();
    if files.is_empty() {
        println!("No supported media files found.");
    }
    for file in &files {
        let path = file["path"].as_str().unwrap_or("?");
        let media_type = file["mediaType"].as_str().unwrap_or("?");
        let size = file["metadata"]["size"].as_u64().map(format_bytes);
        println!("{path}  [{media_type}{}]", size.map(|s| format!(", {s}")).unwrap_or_default());

        if media_type == "image" {
            let w = file["dimensions"]["width"]
                .as_u64()
                .or_else(|| file["basicInfo"]["width"].as_u64());
            let h = file["dimensions"]["height"]
                .as_u64()
                .or_else(|| file["basicInfo"]["height"].as_u64());
            if let (Some(w), Some(h)) = (w, h) {
                println!("  dimensions: {w}x{h}");
            }
            if let Some(dr) = file["dynamicRange"]["dynamicRange"].as_str() {
                println!("  dynamic range: {dr}");
            }
        } else {
            if let Some(dims) = file["basicInfo"]["dimensions"].as_array() {
                if let (Some(w), Some(h)) = (
                    dims.first().and_then(|v| v.as_u64()),
                    dims.get(1).and_then(|v| v.as_u64()),
                ) {
                    print!("  dimensions: {w}x{h}");
                    if let Some(fps) = file["basicInfo"]["fps"].as_f64() {
                        print!(" @ {fps:.2} fps");
                    }
                    println!();
                }
            }
            if let Some(duration) = file["basicInfo"]["duration"].as_f64() {
                println!("  duration: {duration:.2}s");
            }
            if let Some(vstreams) = file["videoStreams"].as_array() {
                let codecs: Vec<&str> = vstreams
                    .iter()
                    .filter_map(|s| s["codecName"].as_str())
                    .collect();
                if !codecs.is_empty() {
                    println!("  video: {}", codecs.join(", "));
                }
            }
            if let Some(astreams) = file["audioStreams"].as_array() {
                println!("  audio tracks: {}", astreams.len());
            }
            if let Some(sstreams) = file["subtitleStreams"].as_array() {
                if !sstreams.is_empty() {
                    println!("  subtitles: {} track(s)", sstreams.len());
                }
            }
            if let Some(dr) = file["dynamicRange"]["dynamicRange"].as_str() {
                println!("  dynamic range: {dr}");
            }
        }
    }
    if let Some(unsupported) = value["unsupported"].as_array().filter(|a| !a.is_empty()) {
        let paths: Vec<&str> = unsupported.iter().filter_map(|v| v.as_str()).collect();
        println!("Unsupported: {}", paths.join(", "));
    }
}

pub fn print_history(value: &Value) {
    let entries = value["entries"].as_array().cloned().unwrap_or_default();
    let total = value["total"].as_u64().unwrap_or(entries.len() as u64);
    if entries.is_empty() {
        println!("No compression history.");
        return;
    }
    println!("Showing {} of {total} history entries:", entries.len());
    for entry in &entries {
        let media_type = entry["mediaType"].as_str().unwrap_or("?");
        let source = entry["source"].as_str().unwrap_or("?");
        let orig = entry["originalPath"].as_str().unwrap_or("?");
        let out = entry["outputPath"].as_str().unwrap_or("(not saved)");
        let preset = entry["presetName"].as_str().unwrap_or("Standard");
        println!("- [{media_type} · {source} · {preset}] {orig} -> {out}");
    }
}

pub fn print_queue(value: &Value) {
    let paused = value["paused"].as_bool().unwrap_or(false);
    let active = value["active"].as_bool().unwrap_or(false);
    let items = value["items"].as_array().cloned().unwrap_or_default();
    println!(
        "Queue: {} item(s) ({})",
        items.len(),
        if paused {
            "paused"
        } else if active {
            "running"
        } else {
            "idle"
        }
    );
    for item in &items {
        let status = item["status"].as_str().unwrap_or("?");
        let path = item["path"].as_str().unwrap_or("?");
        let progress = item["progress"].as_f64().unwrap_or(0.0).round();
        println!("- [{status} {progress}%] {path}");
    }
}

pub fn print_logs(value: &Value, path_only: bool) {
    let path = value["path"].as_str().unwrap_or("?");
    if path_only {
        println!("{path}");
        return;
    }
    println!("Log file: {path}");
    if let Some(lines) = value["lines"].as_array() {
        for line in lines.iter().filter_map(|v| v.as_str()) {
            println!("{line}");
        }
    }
}

pub fn print_settings(value: &Value) {
    if let Some(key) = value["key"].as_str() {
        println!("{key} = {}", format_setting_value(&value["value"]));
        return;
    }
    if let Some(obj) = value["settings"].as_object() {
        let mut keys: Vec<&String> = obj.keys().collect();
        keys.sort();
        for key in keys {
            println!("{key} = {}", format_setting_value(&obj[key]));
        }
    }
}

fn format_setting_value(value: &Value) -> String {
    match value {
        Value::Null => String::from("null"),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| s.clone()),
        Value::Array(arr) => format!("[{} item(s)]", arr.len()),
        Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}
