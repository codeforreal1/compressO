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

/// The protocol versions this server speaks, the latest last
const PROTOCOL_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];

const INSTRUCTIONS: &str = "Compresses videos, images and audio files with the presets of the \
CompressO app on this computer, as if they were dropped on the app. Use list_presets to see the \
presets, then compress with absolute paths. Outputs follow the user's CompressO settings (save \
location, file name prefix, skipping larger outputs, replacing original files) unless a setting \
is given.";

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
    json!([
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
                    "output": { "type": "string", "description": "Absolute path of a folder to save to, instead of the presets' save locations (required when a preset asks where to save). For a single file it can be the file to save, whose extension is the format it is converted to, e.g. /Users/me/Desktop/small.png for a JPEG." },
                    "skipLargerOutputs": switch("Do not save outputs larger than their originals"),
                    "preserveFolderStructure": switch("Keep the folders of folder inputs when saving to a folder"),
                    "replaceOriginalFiles": switch("Move an original to the Trash when its output is saved under the same name in the same folder"),
                    "filenamePrefix": { "type": "string", "description": "Text added to the start of saved file names (an empty text keeps the original names)" },
                    "hardwareAcceleration": switch("Compress videos on the graphics card when possible"),
                    "reachTargetSizesWithoutAcceleration": switch("Compress again without hardware acceleration when a video misses its target size"),
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

fn tool_error(err: &CliError) -> Value {
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
    Ok(CompressOptions {
        inputs,
        presets,
        preset: text("preset").filter(|name| !name.is_empty()),
        output: text("output").map(|folder| job::absolute_path(&PathBuf::from(folder))),
        output_is_folder: text("output")
            .is_some_and(|output| output.ends_with('/') || output.ends_with('\\')),
        overrides: Overrides {
            skip_larger_outputs: switch("skipLargerOutputs"),
            preserve_folder_structure: switch("preserveFolderStructure"),
            replace_original_files: switch("replaceOriginalFiles"),
            file_name_prefix: text("filenamePrefix"),
            use_hardware_acceleration: switch("hardwareAcceleration"),
            reach_target_sizes_without_acceleration: switch("reachTargetSizesWithoutAcceleration"),
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
                match params["name"].as_str().unwrap_or_default() {
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
                    name => respond_error(&id, -32602, &format!("Unknown tool: {name}")),
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
