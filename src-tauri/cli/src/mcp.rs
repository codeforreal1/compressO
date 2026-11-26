//! `compresso mcp`: an MCP server (Model Context Protocol) on stdin/stdout, so AI agents can
//! compress media with CompressO's presets. JSON-RPC 2.0, one message per line. Its tools do what
//! the command line does (see `job.rs`).
use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::rc::Rc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::error::{exit_code, CliError};
use crate::job::{self, CompressOptions, Event, Overrides};
use crate::settings::MEDIA_TYPES;
use crate::watched_folders::PresetChanges;

/// The protocol versions this server speaks, the latest last
const PROTOCOL_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];

const INSTRUCTIONS: &str = "Compresses videos, images and audio files with CompressO's presets or one-shot \
CompressO JSON contracts on this computer, as if they were dropped on the app. Use \
get_contract_schema (for video, image or audio) to inspect every supported setting, limits, and \
one-shot-only fields (metadata.set, video.thumbnail, subtitles), get_capabilities to inspect \
available CPU threads and hardware encoders, and inspect_media to probe files before compressing. \
You can create_preset, update_preset, delete_preset, set_default_preset, or pass videoContract / \
imageContract / audioContract directly to compress for one-shot compression (single file or batch). \
Outputs follow the user's CompressO settings (save location, file name template, skipping larger \
outputs, replacing original files) unless overridden. Watched folders can also be listed and \
managed: new media in them is compressed with the folder's presets while CompressO runs.";

/// Writes a message to stdout (one line)
fn write_message(message: &Value) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{message}");
    let _ = stdout.flush();
}

fn respond(id: &Value, result: Value) {
    write_message(&json!({ "jsonrpc": "2.0", "id": id, "result": result }));
}

fn respond_error(id: &Value, code: i64, message: &str) {
    write_message(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    }));
}

fn tools() -> Value {
    let switch = |description: &str| json!({ "type": "boolean", "description": description });
    let mut all = json!([
        {
            "name": "compress",
            "title": "Compress media",
            "description": "Compresses videos, images and audio files (and the media in folders, read as when dropped on the app) with CompressO's presets, and saves them as the presets do: next to the originals, or in the presets' folders, unless output is given. Waits until done and returns each file's result (saved path, sizes, or why it was not saved). Settings left out follow the user's CompressO settings, including replacing original files when that setting is on.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "inputs": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 1,
                        "description": "Absolute paths of files and folders",
                    },
                    "preset": { "type": "string", "description": "For a single input file: its preset, by name or id, whatever its media type (instead of videoPreset, imagePreset or audioPreset)" },
                    "videoPreset": { "type": "string", "description": "Preset for videos, by name or id (see list_presets); the default video preset otherwise" },
                    "imagePreset": { "type": "string", "description": "Preset for images; the default image preset otherwise" },
                    "audioPreset": { "type": "string", "description": "Preset for audio files; the default audio preset otherwise" },
                    "videoContract": { "type": "object", "description": "One-shot CompressO JSON contract for videos (single file or batch, instead of videoPreset). Call get_contract_schema with mediaType=\"video\" for the full schema. Supports one-shot-only fields (metadata.set, video.thumbnail, subtitles)." },
                    "imageContract": { "type": "object", "description": "One-shot CompressO JSON contract for images (instead of imagePreset). Call get_contract_schema with mediaType=\"image\" for the full schema." },
                    "audioContract": { "type": "object", "description": "One-shot CompressO JSON contract for audio files (instead of audioPreset). Call get_contract_schema with mediaType=\"audio\" for the full schema. Supports metadata.set." },
                    "output": { "type": "string", "description": "Absolute path of a folder to save to, instead of the presets' save locations (required when a preset asks where to save). For a single file it can be the file to save, whose extension is the format it is converted to, e.g. /Users/me/Desktop/small.png for a JPEG." },
                    "skipLargerOutputs": switch("Do not save outputs larger than their originals"),
                    "preserveFolderStructure": switch("Keep the folders of folder inputs when saving to a folder"),
                    "replaceOriginalFiles": switch("Move an original to the Trash when its output is saved under the same name in the same folder"),
                    "filenameTemplate": { "type": "string", "description": "Naming template for saved files (without extension), supporting {name}, {date}, {time}, {preset}; an empty text keeps the original names" },
                    "filenamePrefix": { "type": "string", "description": "Text added to the start of saved file names (an empty text keeps the original names)" },
                    "hardwareAcceleration": switch("Compress videos on the graphics card when possible"),
                    "reachTargetSizesWithoutAcceleration": switch("Compress again without hardware acceleration when a video misses its target size"),
                    "cpuThreads": { "type": "integer", "minimum": 0, "description": "Maximum CPU threads for CPU encoding on this job (0 = all available threads)" },
                    "dryRun": switch("Only list the files, their presets and where they would be saved"),
                },
                "required": ["inputs"],
            },
        },
        {
            "name": "list_presets",
            "title": "List presets",
            "description": "Lists CompressO's presets: their names, media type, whether each is the default of its media type, where they save, and what they change.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mediaType": { "type": "string", "enum": MEDIA_TYPES, "description": "Only the presets of this media type" },
                },
            },
        },
        {
            "name": "get_contract_schema",
            "title": "Get CompressO JSON contract schema",
            "description": "Returns the JSON Schema (Draft 2020-12) and capabilities for a CompressO JSON contract (video, image, or audio), including allowed formats, codecs, value ranges, and x-compresso-scope=\"oneShot\" annotations.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mediaType": { "type": "string", "enum": MEDIA_TYPES },
                },
                "required": ["mediaType"],
            },
        },
        {
            "name": "validate_contract",
            "title": "Validate a CompressO JSON contract",
            "description": "Validates and normalizes a CompressO JSON contract without saving or compressing. Returns the normalized contract and any warnings, or field-level errors.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "contract": { "type": "object", "description": "CompressO JSON contract (partial or full)" },
                    "mode": { "type": "string", "enum": ["oneShot", "preset"], "description": "Validation mode: oneShot (default) allows metadata.set, video.thumbnail, and subtitles; preset rejects them." },
                    "requireName": switch("Require a non-empty preset name (not Standard)"),
                },
                "required": ["contract"],
            },
        },
        {
            "name": "get_preset",
            "title": "Get preset contract",
            "description": "Returns a preset's full normalized CompressO JSON contract (by id or name, including \"Standard\" when mediaType is given).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "idOrName": { "type": "string", "description": "Preset id or name (case-insensitive), or \"Standard\"" },
                    "mediaType": { "type": "string", "enum": MEDIA_TYPES, "description": "Disambiguates when multiple media types share the same preset name or for Standard" },
                },
                "required": ["idOrName"],
            },
        },
        {
            "name": "create_preset",
            "title": "Create a preset from a JSON contract",
            "description": "Creates a new CompressO preset from a CompressO JSON contract (partial contracts are filled with Standard defaults). One-shot-only fields (metadata.set, video.thumbnail, subtitles) are rejected.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "contract": {
                        "type": "object",
                        "description": "CompressO JSON contract with version=1, mediaType (video|image|audio), name, settings, and optional output. Call get_contract_schema for the full schema.",
                    },
                    "onConflict": { "type": "string", "enum": ["error", "rename", "replace"], "description": "What to do if a preset of that mediaType with the same name exists (default: error)" },
                },
                "required": ["contract"],
            },
        },
        {
            "name": "update_preset",
            "title": "Update a preset with a JSON contract",
            "description": "Updates an existing user preset (Standard is read-only) using JSON Merge Patch (default) or full replacement (replace=true). Preserves the preset id so watched folders continue working.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "idOrName": { "type": "string", "description": "Existing preset id or name" },
                    "patch": { "type": "object", "description": "Partial JSON Merge Patch or full contract (when replace=true)" },
                    "mediaType": { "type": "string", "enum": MEDIA_TYPES, "description": "Disambiguates by media type" },
                    "replace": switch("Replace the entire preset contract instead of merge-patching"),
                    "ifRevision": { "type": "integer", "description": "Optional optimistic concurrency check against preset.revision" },
                },
                "required": ["idOrName", "patch"],
            },
        },
        {
            "name": "delete_preset",
            "title": "Delete a preset",
            "description": "Deletes a user preset (Standard cannot be deleted). Resets the default to Standard if it was starred, and reports any watched folders that fall back to the default.",
            "annotations": { "destructiveHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "idOrName": { "type": "string", "description": "Preset id or name" },
                    "mediaType": { "type": "string", "enum": MEDIA_TYPES },
                },
                "required": ["idOrName"],
            },
        },
        {
            "name": "set_default_preset",
            "title": "Set the default preset",
            "description": "Sets which preset is used by default for newly added media (and watched folders/CLI using default) for a media type.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "idOrName": { "type": "string", "description": "Preset id or name, or \"standard\"" },
                    "mediaType": { "type": "string", "enum": MEDIA_TYPES },
                },
                "required": ["idOrName", "mediaType"],
            },
        },
        {
            "name": "list_watched_folders",
            "title": "List watched folders",
            "description": "Lists the folders whose new media CompressO compresses automatically (Settings > Watch Folder), with the presets used for videos, images and audio. Shows whether each folder is enabled and actually watched. Folders are watched while CompressO runs.",
            "inputSchema": {
                "type": "object",
                "properties": {},
            },
        },
        {
            "name": "add_watched_folder",
            "title": "Add a watched folder",
            "description": "Adds an existing absolute folder to watch: new media that lands in it (and its subfolders) is compressed with the folder's presets while CompressO runs. Files already in the folder are not compressed. Adding a folder that is already watched returns it with added false. Presets are names or ids (see list_presets), or default to follow the default preset. A folder whose presets ask where to save is not watched until its presets or the app's save location can save automatically.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of an existing folder" },
                    "enabled": switch("Watch it right away (on by default)"),
                    "videoPreset": { "type": "string", "description": "Preset for videos in it, by name or id, or default" },
                    "imagePreset": { "type": "string", "description": "Preset for images in it, by name or id, or default" },
                    "audioPreset": { "type": "string", "description": "Preset for audio files in it, by name or id, or default" },
                },
                "required": ["path"],
            },
        },
        {
            "name": "update_watched_folder",
            "title": "Update a watched folder",
            "description": "Turns a watched folder on or off, or changes the preset used for its videos, images or audio, by the folder's id (from list_watched_folders or add_watched_folder) or its exact path. Omitted settings stay unchanged. Use default to follow the default preset. Does not change or delete any files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The watched folder's id (preferred)" },
                    "path": { "type": "string", "description": "The watched folder's exact path, instead of its id" },
                    "enabled": switch("Watch the folder (true) or stop watching it (false)"),
                    "videoPreset": { "type": "string", "description": "Preset for videos in it, by name or id, or default" },
                    "imagePreset": { "type": "string", "description": "Preset for images in it, by name or id, or default" },
                    "audioPreset": { "type": "string", "description": "Preset for audio files in it, by name or id, or default" },
                },
                "anyOf": [
                    { "required": ["id"] },
                    { "required": ["path"] },
                ],
            },
        },
        {
            "name": "remove_watched_folder",
            "title": "Remove a watched folder",
            "description": "Stops watching a folder and removes it from CompressO's watched folders, by id (from list_watched_folders) or exact path. Does not delete the folder or its files, and does not remove media already queued.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "The watched folder's id (preferred)" },
                    "path": { "type": "string", "description": "The watched folder's exact path, instead of its id" },
                },
                "anyOf": [
                    { "required": ["id"] },
                    { "required": ["path"] },
                ],
            },
        },
    ])
    .as_array()
    .cloned()
    .unwrap_or_default();
    if let Some(extra) = json!([
        {
            "name": "get_capabilities",
            "title": "Get CompressO capabilities",
            "description": "Returns CompressO version, platform, available CPU threads, global thread limit, detected hardware encoders, tool status, log path, and cache state.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {},
            },
        },
        {
            "name": "inspect_media",
            "title": "Inspect media files",
            "description": "Probes media files or folders for dimensions, codecs, streams, duration, audio tracks, subtitles, EXIF, and HDR dynamic range without compressing.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "inputs": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 1,
                        "description": "Absolute paths of files or folders to inspect",
                    },
                },
                "required": ["inputs"],
            },
        },
        {
            "name": "get_history",
            "title": "Get compression history",
            "description": "Returns recent compression history entries recorded by CompressO (newest first).",
            "annotations": { "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Maximum number of entries to return (default: all)",
                    },
                },
            },
        },
        {
            "name": "get_queue",
            "title": "Get drop queue status",
            "description": "Returns whether the background drop/watch queue is paused or active, main window compression status, and queued items.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {},
            },
        },
        {
            "name": "get_logs",
            "title": "Get CompressO logs",
            "description": "Returns the current CompressO log file path and recent log lines.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tail": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Number of recent log lines to return (default: 100; 0 returns only the file path)",
                    },
                },
            },
        },
        {
            "name": "about",
            "title": "About CompressO",
            "description": "Returns information about CompressO: version, tagline, platform, license, author, official links (website, changelog, GitHub, releases, third-party notices), and open-source tool credits.",
            "annotations": { "readOnlyHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {},
            },
        },
        {
            "name": "clear_cache",
            "title": "Clear temporary cache",
            "description": "Clears CompressO's temporary cache directory. Refused with an error if any compression, active queue job, open media, or unsaved output is currently present.",
            "annotations": { "destructiveHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {},
            },
        },
        {
            "name": "clear_history",
            "title": "Clear compression history",
            "description": "Clears all compression history entries recorded by CompressO.",
            "annotations": { "destructiveHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {},
            },
        },
        {
            "name": "manage_queue",
            "title": "Manage drop queue",
            "description": "Controls the background drop/watch compression queue: pause, resume, clear (remove finished items), or cancel (stop active queue items).",
            "annotations": { "destructiveHint": true },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["pause", "resume", "clear", "cancel"],
                        "description": "Queue action to perform",
                    },
                },
                "required": ["action"],
            },
        },
        {
            "name": "cancel_compression",
            "title": "Cancel a compression",
            "description": "Cancels the media of a running compress call that is not compressed yet, by the job id reported in its progress.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "jobId": { "type": "string" },
                },
                "required": ["jobId"],
            },
        },
    ])
    .as_array()
    {
        all.extend(extra.iter().cloned());
    }
    Value::Array(all)
}

/// A tool's result: the JSON both as text & as structured content
fn tool_result(value: Value, is_error: bool) -> Value {
    json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&value).unwrap_or_default(),
        }],
        "structuredContent": value,
        "isError": is_error,
    })
}

fn audit_log(level: &'static str, message: String) {
    tokio::task::spawn_local(async move {
        crate::client::log_if_running(level, &message).await;
    });
}

fn tool_error(err: &CliError) -> Value {
    audit_log("warn", format!("tool failed ({}): {}", err.code, err.message));
    tool_result(err.to_json(), true)
}

fn compress_options(arguments: &Value) -> Result<CompressOptions, CliError> {
    let inputs: Vec<PathBuf> = arguments["inputs"]
        .as_array()
        .map(|inputs| {
            inputs
                .iter()
                .filter_map(|input| input.as_str())
                .map(|input| job::absolute_path(&PathBuf::from(input)))
                .collect()
        })
        .unwrap_or_default();
    let text = |key: &str| arguments[key].as_str().map(String::from);
    let switch = |key: &str| arguments[key].as_bool();
    let mut presets = HashMap::new();
    for (media_type, key) in [
        ("video", "videoPreset"),
        ("image", "imagePreset"),
        ("audio", "audioPreset"),
    ] {
        if let Some(name) = text(key).filter(|name| !name.is_empty()) {
            presets.insert(media_type, name);
        }
    }
    let mut contracts = HashMap::new();
    for (media_type, key) in [
        ("video", "videoContract"),
        ("image", "imageContract"),
        ("audio", "audioContract"),
    ] {
        if let Some(value) = arguments.get(key).filter(|v| !v.is_null()) {
            if !value.is_object() {
                return Err(CliError::usage(format!("{key} must be a JSON object.")));
            }
            contracts.insert(media_type, value.clone());
        }
    }
    let cpu_threads = match arguments.get("cpuThreads").filter(|v| !v.is_null()) {
        Some(val) => {
            let n = val.as_u64().ok_or_else(|| {
                CliError::usage("cpuThreads must be a non-negative integer.")
            })?;
            Some(n as usize)
        }
        None => None,
    };
    Ok(CompressOptions {
        inputs,
        presets,
        preset: text("preset").filter(|name| !name.is_empty()),
        contract_files: Vec::new(),
        contracts,
        output: text("output").map(|folder| job::absolute_path(&PathBuf::from(folder))),
        output_is_folder: text("output")
            .is_some_and(|output| output.ends_with('/') || output.ends_with('\\')),
        overrides: Overrides {
            skip_larger_outputs: switch("skipLargerOutputs"),
            preserve_folder_structure: switch("preserveFolderStructure"),
            replace_original_files: switch("replaceOriginalFiles"),
            file_name_prefix: text("filenamePrefix"),
            file_name_template: text("filenameTemplate"),
            use_hardware_acceleration: switch("hardwareAcceleration"),
            reach_target_sizes_without_acceleration: switch("reachTargetSizesWithoutAcceleration"),
            cpu_threads,
        },
        dry_run: switch("dryRun").unwrap_or(false),
    })
}

/// The compress calls running, by their request id (JSON) & their job id, to cancel them
#[derive(Default)]
struct Running {
    by_request: HashMap<String, tokio::sync::watch::Sender<bool>>,
    by_job: HashMap<String, String>,
}

type SharedRunning = Rc<RefCell<Running>>;

async fn call_compress(
    id: Value,
    arguments: Value,
    progress_token: Option<Value>,
    running: SharedRunning,
) {
    let request_key = id.to_string();
    let options = match compress_options(&arguments) {
        Ok(options) => options,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let (cancel_sender, cancel) = tokio::sync::watch::channel(false);
    running
        .borrow_mut()
        .by_request
        .insert(request_key.clone(), cancel_sender);

    // Progress in files: those done, & the parts of those being compressed
    let mut done: Vec<bool> = Vec::new();
    let mut percents: Vec<u8> = Vec::new();
    let mut current_job = String::new();
    let send_progress = |done: &[bool], percents: &[u8], job_id: &str| {
        let Some(token) = &progress_token else {
            return;
        };
        let finished = done.iter().filter(|is_done| **is_done).count();
        let partial: f64 = done
            .iter()
            .zip(percents)
            .filter(|(is_done, _)| !**is_done)
            .map(|(_, percent)| f64::from(*percent) / 100.0)
            .sum();
        write_message(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": token,
                "progress": finished as f64 + partial,
                "total": done.len(),
                "message": format!("Job {job_id}: {finished} of {} files done", done.len()),
            },
        }));
    };
    let result = job::run(
        &options,
        |event| match event {
            Event::Accepted { job_id, files } => {
                current_job = job_id.to_string();
                running
                    .borrow_mut()
                    .by_job
                    .insert(current_job.clone(), request_key.clone());
                done = vec![false; files.len()];
                percents = vec![0; files.len()];
                send_progress(&done, &percents, &current_job);
            }
            Event::Progress { index, percent } => {
                if let Some(value) = percents.get_mut(index) {
                    *value = percent;
                }
                send_progress(&done, &percents, &current_job);
            }
            Event::Finished { index, .. } => {
                if let Some(value) = done.get_mut(index) {
                    *value = true;
                }
                send_progress(&done, &percents, &current_job);
            }
            _ => {}
        },
        cancel,
    )
    .await;
    {
        let mut running = running.borrow_mut();
        running.by_request.remove(&request_key);
        running.by_job.retain(|_, request| request != &request_key);
    }
    match result {
        Ok(report) => respond(&id, tool_result(report.to_json(), false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn call_list_presets(id: Value, arguments: Value) {
    let settings = match crate::settings::Settings::from_file() {
        Some(settings) => Ok(settings),
        None => crate::fetch_settings().await,
    };
    let settings = match settings {
        Ok(settings) => settings,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let media_type = arguments["mediaType"].as_str();
    let presets: Vec<_> = settings
        .presets
        .iter()
        .filter(|preset| media_type.is_none_or(|media_type| preset.media_type == media_type))
        .map(|preset| {
            let mut value = serde_json::to_value(preset).unwrap_or(Value::Null);
            value["isDefault"] = json!(settings
                .default_preset(&preset.media_type)
                .is_some_and(|default| default.id == preset.id));
            value["savesAutomatically"] = json!(preset.output.saves_automatically());
            value
        })
        .collect();
    respond(&id, tool_result(json!({ "presets": presets }), false));
}

async fn call_get_contract_schema(id: Value, arguments: Value) {
    let media_type = match required_text(&arguments, "mediaType") {
        Ok(value) => value,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let settings = match crate::contract::load_settings().await {
        Ok(settings) => settings,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let mt = match crate::contract::check_media_type(&media_type) {
        Ok(mt) => mt,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let Some(schema) = settings
        .contract_schemas
        .as_ref()
        .and_then(|s| s.get(mt))
        .cloned()
    else {
        return respond(
            &id,
            tool_error(&CliError::app("CompressO has not synced its contract schemas yet.")),
        );
    };
    respond(
        &id,
        tool_result(
            json!({
                "mediaType": mt,
                "schema": schema,
                "capabilities": settings.contract_capabilities,
            }),
            false,
        ),
    );
}

async fn call_validate_contract(id: Value, arguments: Value) {
    let contract = arguments.get("contract").cloned().unwrap_or(Value::Null);
    let mode = optional_text(&arguments, "mode");
    let require_name = arguments["requireName"].as_bool().unwrap_or(false);
    match crate::contract::validate_value(contract, mode.as_deref(), require_name).await {
        Ok(mut res) => {
            if let Some(obj) = res.as_object_mut() {
                obj.remove("type");
                obj.remove("ok");
                obj.insert("valid".to_string(), json!(true));
            }
            respond(&id, tool_result(res, false));
        }
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn call_get_preset(id: Value, arguments: Value) {
    let id_or_name = match required_text(&arguments, "idOrName") {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let media_type = optional_text(&arguments, "mediaType");
    match crate::presets::get(&id_or_name, media_type.as_deref()).await {
        Ok(value) => respond(&id, tool_result(value, false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn call_create_preset(id: Value, arguments: Value) {
    let contract = arguments.get("contract").cloned().unwrap_or(Value::Null);
    let on_conflict = optional_text(&arguments, "onConflict");
    match crate::presets::create(contract, on_conflict.as_deref()).await {
        Ok(value) => respond(&id, tool_result(value, false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn call_update_preset(id: Value, arguments: Value) {
    let id_or_name = match required_text(&arguments, "idOrName") {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let patch = arguments.get("patch").cloned().unwrap_or(Value::Null);
    let media_type = optional_text(&arguments, "mediaType");
    let replace = arguments["replace"].as_bool().unwrap_or(false);
    let if_revision = arguments["ifRevision"].as_u64();
    match crate::presets::update(
        &id_or_name,
        patch,
        media_type.as_deref(),
        replace,
        if_revision,
    )
    .await
    {
        Ok(value) => respond(&id, tool_result(value, false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn call_delete_preset(id: Value, arguments: Value) {
    let id_or_name = match required_text(&arguments, "idOrName") {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let media_type = optional_text(&arguments, "mediaType");
    match crate::presets::delete(&id_or_name, media_type.as_deref()).await {
        Ok(value) => respond(&id, tool_result(value, false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn call_set_default_preset(id: Value, arguments: Value) {
    let id_or_name = match required_text(&arguments, "idOrName") {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    let media_type = match required_text(&arguments, "mediaType") {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    match crate::presets::set_default(&id_or_name, &media_type).await {
        Ok(value) => respond(&id, tool_result(value, false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

enum WatchedFoldersAction {
    List,
    Add,
    Update,
    Remove,
}

fn respond_system_result(id: &Value, result: Result<Value, CliError>) {
    match result {
        Ok(value) => respond(id, tool_result(value, false)),
        Err(err) => respond(id, tool_error(&err)),
    }
}

fn optional_usize(arguments: &Value, key: &str, min: u64) -> Result<Option<usize>, CliError> {
    let Some(val) = arguments.get(key).filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let n = val
        .as_u64()
        .filter(|n| *n >= min)
        .ok_or_else(|| CliError::usage(format!("{key} must be an integer >= {min}.")))?;
    Ok(Some(n as usize))
}

async fn call_get_capabilities(id: Value) {
    respond_system_result(&id, crate::system::capabilities().await);
}

async fn call_get_history(id: Value, arguments: Value) {
    let limit = match optional_usize(&arguments, "limit", 1) {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    respond_system_result(&id, crate::system::history_list(limit).await);
}

async fn call_get_queue(id: Value) {
    respond_system_result(&id, crate::system::queue_status().await);
}

async fn call_get_logs(id: Value, arguments: Value) {
    let tail = match optional_usize(&arguments, "tail", 0) {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    respond_system_result(&id, crate::system::logs(tail).await);
}

async fn call_clear_cache(id: Value) {
    respond_system_result(&id, crate::system::clear_cache().await);
}

async fn call_clear_history(id: Value) {
    respond_system_result(&id, crate::system::history_clear().await);
}

async fn call_manage_queue(id: Value, arguments: Value) {
    let action = match required_text(&arguments, "action") {
        Ok(v) => v,
        Err(err) => return respond(&id, tool_error(&err)),
    };
    if !matches!(action.as_str(), "pause" | "resume" | "clear" | "cancel") {
        return respond(
            &id,
            tool_error(&CliError::usage(
                "action must be one of pause, resume, clear, or cancel.",
            )),
        );
    }
    respond_system_result(&id, crate::system::queue_action(&action).await);
}

async fn call_inspect_media(id: Value, arguments: Value) {
    let inputs: Vec<PathBuf> = arguments["inputs"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|p| job::absolute_path(&PathBuf::from(p)))
                .collect()
        })
        .unwrap_or_default();
    respond_system_result(&id, crate::system::inspect(inputs).await);
}

async fn call_watched_folders(id: Value, arguments: Value, action: WatchedFoldersAction) {
    match watched_folders_result(action, arguments).await {
        Ok(value) => respond(&id, tool_result(value, false)),
        Err(err) => respond(&id, tool_error(&err)),
    }
}

async fn watched_folders_result(
    action: WatchedFoldersAction,
    arguments: Value,
) -> Result<Value, CliError> {
    match action {
        WatchedFoldersAction::List => crate::watched_folders::list().await,
        WatchedFoldersAction::Add => {
            let path = required_text(&arguments, "path")?;
            crate::watched_folders::add(
                path,
                arguments["enabled"].as_bool(),
                preset_changes(&arguments),
            )
            .await
        }
        WatchedFoldersAction::Update => {
            let id = optional_text(&arguments, "id");
            let path = optional_text(&arguments, "path");
            let presets = preset_changes(&arguments);
            let is_enabled = arguments["enabled"].as_bool();
            if is_enabled.is_none() && presets.is_none() {
                return Err(CliError::usage(
                    "Give enabled, videoPreset, imagePreset or audioPreset to update.",
                ));
            }
            crate::watched_folders::update(id, path, is_enabled, presets).await
        }
        WatchedFoldersAction::Remove => {
            crate::watched_folders::remove(
                optional_text(&arguments, "id"),
                optional_text(&arguments, "path"),
            )
            .await
        }
    }
}

fn optional_text(arguments: &Value, key: &str) -> Option<String> {
    arguments[key]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(String::from)
}

fn required_text(arguments: &Value, key: &str) -> Result<String, CliError> {
    optional_text(arguments, key).ok_or_else(|| CliError::usage(format!("Give {key}.")))
}

fn preset_changes(arguments: &Value) -> Option<PresetChanges> {
    let changes = PresetChanges {
        video: optional_text(arguments, "videoPreset"),
        image: optional_text(arguments, "imagePreset"),
        audio: optional_text(arguments, "audioPreset"),
    };
    (!changes.is_empty()).then_some(changes)
}

fn cancel_job(running: &SharedRunning, job_id: &str) -> bool {
    let running = running.borrow();
    let Some(request) = running.by_job.get(job_id) else {
        return false;
    };
    running
        .by_request
        .get(request)
        .is_some_and(|sender| sender.send(true).is_ok())
}

pub async fn serve() -> i32 {
    crate::client::set_mcp_mode();
    let local = tokio::task::LocalSet::new();
    local.run_until(serve_messages()).await
}

async fn serve_messages() -> i32 {
    let running: SharedRunning = Rc::default();
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            audit_log("warn", "Invalid JSON-RPC message on MCP stdin".to_string());
            respond_error(&Value::Null, -32700, "Parse error");
            continue;
        };
        let id = message.get("id").cloned();
        let method = message["method"].as_str().unwrap_or_default();
        let params = message.get("params").cloned().unwrap_or(json!({}));
        match (method, id) {
            ("initialize", Some(id)) => {
                let requested = params["protocolVersion"].as_str().unwrap_or_default();
                let version = PROTOCOL_VERSIONS
                    .iter()
                    .find(|version| **version == requested)
                    .unwrap_or(&PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.len() - 1]);
                audit_log("info", format!("Initialized session (protocol {version})"));
                respond(
                    &id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": { "tools": { "listChanged": false } },
                        "serverInfo": {
                            "name": "compresso",
                            "title": "CompressO",
                            "version": crate::VERSION,
                        },
                        "instructions": INSTRUCTIONS,
                    }),
                );
            }
            ("ping", Some(id)) => respond(&id, json!({})),
            ("tools/list", Some(id)) => respond(&id, json!({ "tools": tools() })),
            ("tools/call", Some(id)) => {
                let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
                let tool_name = params["name"].as_str().unwrap_or_default();
                audit_log("info", format!("tools/call {tool_name}"));
                match tool_name {
                    "compress" => {
                        let progress_token = params["_meta"].get("progressToken").cloned();
                        tokio::task::spawn_local(call_compress(
                            id,
                            arguments,
                            progress_token,
                            running.clone(),
                        ));
                    }
                    "list_presets" => {
                        tokio::task::spawn_local(call_list_presets(id, arguments));
                    }
                    "get_contract_schema" => {
                        tokio::task::spawn_local(call_get_contract_schema(id, arguments));
                    }
                    "validate_contract" => {
                        tokio::task::spawn_local(call_validate_contract(id, arguments));
                    }
                    "get_preset" => {
                        tokio::task::spawn_local(call_get_preset(id, arguments));
                    }
                    "create_preset" => {
                        tokio::task::spawn_local(call_create_preset(id, arguments));
                    }
                    "update_preset" => {
                        tokio::task::spawn_local(call_update_preset(id, arguments));
                    }
                    "delete_preset" => {
                        tokio::task::spawn_local(call_delete_preset(id, arguments));
                    }
                    "set_default_preset" => {
                        tokio::task::spawn_local(call_set_default_preset(id, arguments));
                    }
                    "list_watched_folders" => {
                        tokio::task::spawn_local(call_watched_folders(
                            id,
                            arguments,
                            WatchedFoldersAction::List,
                        ));
                    }
                    "add_watched_folder" => {
                        tokio::task::spawn_local(call_watched_folders(
                            id,
                            arguments,
                            WatchedFoldersAction::Add,
                        ));
                    }
                    "update_watched_folder" => {
                        tokio::task::spawn_local(call_watched_folders(
                            id,
                            arguments,
                            WatchedFoldersAction::Update,
                        ));
                    }
                    "remove_watched_folder" => {
                        tokio::task::spawn_local(call_watched_folders(
                            id,
                            arguments,
                            WatchedFoldersAction::Remove,
                        ));
                    }
                    "get_capabilities" => {
                        tokio::task::spawn_local(call_get_capabilities(id));
                    }
                    "inspect_media" => {
                        tokio::task::spawn_local(call_inspect_media(id, arguments));
                    }
                    "get_history" => {
                        tokio::task::spawn_local(call_get_history(id, arguments));
                    }
                    "get_queue" => {
                        tokio::task::spawn_local(call_get_queue(id));
                    }
                    "get_logs" => {
                        tokio::task::spawn_local(call_get_logs(id, arguments));
                    }
                    "about" => {
                        respond(&id, tool_result(crate::system::about_info(), false));
                    }
                    "clear_cache" => {
                        tokio::task::spawn_local(call_clear_cache(id));
                    }
                    "clear_history" => {
                        tokio::task::spawn_local(call_clear_history(id));
                    }
                    "manage_queue" => {
                        tokio::task::spawn_local(call_manage_queue(id, arguments));
                    }
                    "cancel_compression" => {
                        let job_id = arguments["jobId"].as_str().unwrap_or_default();
                        let is_cancelled = cancel_job(&running, job_id);
                        respond(
                            &id,
                            tool_result(
                                json!({ "jobId": job_id, "cancelled": is_cancelled }),
                                !is_cancelled,
                            ),
                        );
                    }
                    name => {
                        audit_log("warn", format!("Unknown MCP tool requested: {name}"));
                        respond_error(&id, -32602, &format!("Unknown tool: {name}"));
                    }
                }
            }
            ("notifications/cancelled", None) => {
                let request = params["requestId"].to_string();
                if let Some(sender) = running.borrow().by_request.get(&request) {
                    let _ = sender.send(true);
                }
            }
            // Notifications needing no answer (e.g. `notifications/initialized`)
            (_, None) => {}
            (_, Some(id)) => respond_error(&id, -32601, &format!("Method not found: {method}")),
        }
    }
    // The client left: running compressions are cancelled with their connections to the app
    exit_code::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::tools;

    #[test]
    fn exposes_all_expected_mcp_tools() {
        let listed = tools();
        let names: Vec<&str> = listed
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["name"].as_str())
            .collect();
        for expected in [
            "compress",
            "list_presets",
            "get_contract_schema",
            "validate_contract",
            "get_preset",
            "create_preset",
            "update_preset",
            "delete_preset",
            "set_default_preset",
            "list_watched_folders",
            "add_watched_folder",
            "update_watched_folder",
            "remove_watched_folder",
            "get_capabilities",
            "inspect_media",
            "get_history",
            "clear_history",
            "get_queue",
            "manage_queue",
            "get_logs",
            "about",
            "clear_cache",
            "cancel_compression",
        ] {
            assert!(names.contains(&expected), "missing MCP tool: {expected}");
        }
    }
}
