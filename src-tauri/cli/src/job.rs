//! A compression: checks the inputs & presets, then has the app compress the media (through its
//! drop zone's queue) & follows it. Shared by the command line & the MCP server.
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::client::{Connection, StartupStatus};
use crate::error::{exit_code, CliError};
use crate::settings::{OutputSettings, Preset, Settings, MEDIA_TYPES};

/// The output settings chosen for one compression; each one left out follows the app's
#[derive(Default, Clone, Debug)]
pub struct Overrides {
    pub skip_larger_outputs: Option<bool>,
    pub preserve_folder_structure: Option<bool>,
    pub replace_original_files: Option<bool>,
    pub file_name_prefix: Option<String>,
    pub use_hardware_acceleration: Option<bool>,
    pub reach_target_sizes_without_acceleration: Option<bool>,
}

#[derive(Default, Clone, Debug)]
pub struct CompressOptions {
    /// Files & folders, absolute
    pub inputs: Vec<PathBuf>,
    /// The preset name (or id) chosen for each media type; the others use their default preset
    pub presets: HashMap<&'static str, String>,
    /// For a single file: its preset, whatever its media type (`--preset=`)
    pub preset: Option<String>,
    /// Saved here instead of the presets' save locations: a folder, or for a single file the file
    /// to save, whose extension is the format it is converted to
    pub output: Option<PathBuf>,
    /// `output` ended with `/` (or `\\`): a folder, even with a dot in its name (`v1.2/`)
    pub output_is_folder: bool,
    pub overrides: Overrides,
    /// Only checks & lists what would be done
    pub dry_run: bool,
}

/// What happens during a compression, to show it
pub enum Event<'a> {
    Startup(StartupStatus),
    /// The presets & settings the media is about to be compressed with
    Plan(&'a Report),
    /// The media is queued in the app, as the job `job_id`
    Accepted {
        job_id: &'a str,
        files: &'a [FileResult],
    },
    /// A media is being compressed (0 to 100)
    Progress {
        index: usize,
        percent: u8,
    },
    /// A media is done (saved, not saved, failed or cancelled)
    Finished {
        index: usize,
        file: &'a FileResult,
    },
    /// The app's queue was paused or resumed (in the app)
    Paused(bool),
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    pub input: String,
    pub media_type: String,
    pub preset: String,
    /// `planned` (dry run), `waiting`, `saved`, `notSaved`, `failed` or `cancelled`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    /// Where it would be saved (dry run)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_size: Option<u64>,
    /// Why it was not saved or failed: `larger`, `noSaveLocation`, `saveFailed`, `accessDenied`,
    /// `compressFailed`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The original was moved to the Trash (Recycle Bin), the output taking its place
    pub replaced_original: bool,
    #[serde(skip)]
    pub id: String,
    #[serde(skip)]
    pub progress: u8,
}

/// The effective settings of a compression, shown with it
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveSettings {
    #[serde(flatten)]
    pub output: OutputSettings,
    /// The file saved, when `--output=` names one (its prefix is not used)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    /// Set when a prefix was chosen; otherwise each preset's prefix is used
    #[serde(rename = "filenamePrefix", skip_serializing_if = "Option::is_none")]
    pub file_name_prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_folder: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// `ok`, `partial` (some files failed), `failed` (all failed), `cancelled` or `dryRun`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    /// The preset used for each media type compressed
    pub presets: BTreeMap<String, String>,
    pub settings: EffectiveSettings,
    pub files: Vec<FileResult>,
    /// Files skipped as their format is not supported
    pub skipped: Vec<String>,
    pub summary: Summary,
    #[serde(skip)]
    pub is_interrupted: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub saved: usize,
    pub not_saved: usize,
    pub failed: usize,
    pub cancelled: usize,
    /// Bytes saved by the saved outputs, compared with their originals
    pub bytes_saved: i64,
}

impl Report {
    pub fn exit_code(&self) -> i32 {
        if self.is_interrupted {
            exit_code::INTERRUPTED
        } else if self.summary.failed > 0 || self.summary.cancelled > 0 {
            exit_code::FAILED
        } else {
            exit_code::SUCCESS
        }
    }

    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    fn finish(&mut self) {
        let mut summary = Summary::default();
        for file in &self.files {
            match file.status.as_str() {
                "saved" => {
                    summary.saved += 1;
                    if let (Some(original), Some(output)) = (file.original_size, file.output_size) {
                        summary.bytes_saved += original as i64 - output as i64;
                    }
                }
                "notSaved" => summary.not_saved += 1,
                "failed" => summary.failed += 1,
                "cancelled" | "waiting" => summary.cancelled += 1,
                _ => {}
            }
        }
        let total = self.files.len();
        self.status = if self.is_interrupted || (summary.cancelled > 0 && summary.failed == 0) {
            "cancelled"
        } else if summary.failed > 0 && summary.failed + summary.cancelled == total {
            "failed"
        } else if summary.failed > 0 || summary.cancelled > 0 {
            "partial"
        } else {
            "ok"
        }
        .to_string();
        self.summary = summary;
    }
}

/// Inputs given relative to the current folder, made absolute (the app has another one)
pub fn absolute_path(path: &Path) -> PathBuf {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };
    // Without `.` parts, so paths read as typed (`./out` -> `/…/out`)
    path.components()
        .filter(|component| !matches!(component, std::path::Component::CurDir))
        .collect()
}

/// Checks what can be checked before reaching the app
fn check_inputs(options: &CompressOptions) -> Result<(), CliError> {
    if options.inputs.is_empty() {
        return Err(CliError::usage(
            "No files or folders were given. Run compresso --help for the usage.",
        ));
    }
    let missing: Vec<String> = options
        .inputs
        .iter()
        .filter(|path| !path.exists())
        .map(|path| path.display().to_string())
        .collect();
    if !missing.is_empty() {
        return Err(CliError::new(
            exit_code::USAGE,
            "missingInput",
            format!("Not found: {}", missing.join(", ")),
        ));
    }
    Ok(())
}

/// The extension of a path, in lower case
fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
}

/// Whether `--output=` names a file to save (with an extension of a format CompressO saves in),
/// not a folder
fn is_file_output(path: &Path, settings: &Settings) -> bool {
    !path.is_dir()
        && extension_of(path).is_some_and(|extension| {
            settings
                .output_extensions
                .values()
                .any(|extensions| extensions.contains(&extension))
        })
}

/// The folder a media would be saved in (see `saveQueueOutput` in the app)
fn destination_folder(
    file_path: &str,
    relative_dir: &str,
    preset: &Preset,
    options: &CompressOptions,
    preserve_folder_structure: bool,
) -> String {
    let folder = match &options.output {
        Some(folder) => Some(folder.display().to_string()),
        None if preset.output.save_location == "fixedFolder" => preset.output.save_folder.clone(),
        None => None,
    };
    match folder {
        Some(folder) if preserve_folder_structure && !relative_dir.is_empty() => {
            Path::new(&folder).join(relative_dir).display().to_string()
        }
        Some(folder) => folder,
        None => Path::new(file_path)
            .parent()
            .map(|parent| parent.display().to_string())
            .unwrap_or_default(),
    }
}

/// Compresses the media of the inputs, telling `on_event` what happens. Stops early (cancelling the
/// media not compressed yet) once `cancel` turns true.
pub async fn run(
    options: &CompressOptions,
    mut on_event: impl FnMut(Event),
    mut cancel: tokio::sync::watch::Receiver<bool>,
) -> Result<Report, CliError> {
    check_inputs(options)?;
    let mut connection = Connection::open(|status| on_event(Event::Startup(status))).await?;
    let answer = connection.request(json!({ "type": "getSettings" })).await?;
    let settings: Settings = serde_json::from_value(answer["settings"].clone())
        .map_err(|_| CliError::app("CompressO sent settings this command line cannot read."))?;

    // Every preset chosen must exist, even for media types not among the inputs
    let mut presets: HashMap<&str, &Preset> = HashMap::new();
    for media_type in MEDIA_TYPES {
        let name = options.presets.get(media_type).map(String::as_str);
        presets.insert(media_type, settings.find_preset(media_type, name)?);
    }

    let inputs: Vec<String> = options
        .inputs
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    let expanded = connection
        .request(json!({ "type": "expand", "inputs": inputs }))
        .await?;
    if let Some(unreadable) = expanded["unreadable"]
        .as_array()
        .filter(|list| !list.is_empty())
    {
        let paths: Vec<String> = unreadable
            .iter()
            .map(|entry| {
                format!(
                    "{} ({})",
                    entry["path"].as_str().unwrap_or_default(),
                    entry["error"].as_str().unwrap_or_default()
                )
            })
            .collect();
        return Err(CliError::new(
            exit_code::USAGE,
            "unreadableInput",
            format!("Could not read: {}", paths.join(", ")),
        ));
    }
    let skipped: Vec<String> = expanded["unsupported"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|path| path.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let files = expanded["files"].as_array().cloned().unwrap_or_default();
    if files.is_empty() {
        let message = if skipped.is_empty() {
            String::from("No supported media was found in the given files and folders.")
        } else {
            format!("Not a supported format: {}", skipped.join(", "))
        };
        return Err(CliError::new(exit_code::USAGE, "noMedia", message));
    }

    // The media types whose preset was chosen (the others use their default preset)
    let mut chosen: std::collections::HashSet<&str> = options.presets.keys().copied().collect();
    // `--preset=`: the preset of a single file, for its media type
    if let Some(name) = &options.preset {
        if options.inputs.len() != 1 || !options.inputs[0].is_file() || files.len() != 1 {
            return Err(CliError::new(
                exit_code::USAGE,
                "presetNeedsOneFile",
                "--preset= works with one file only. For several files or a folder, use --video-preset=, --image-preset= or --audio-preset=.",
            ));
        }
        let media_type = MEDIA_TYPES
            .into_iter()
            .find(|media_type| Some(*media_type) == files[0]["mediaType"].as_str())
            .unwrap_or("video");
        if options.presets.contains_key(media_type) {
            return Err(CliError::usage(format!(
                "Use either --preset= or --{media_type}-preset=, not both."
            )));
        }
        presets.insert(media_type, settings.find_preset(media_type, Some(name))?);
        chosen.insert(media_type);
    }

    // `--output=` names a folder, or for a single file the file to save, in the format of its
    // extension (e.g. `--output=small.png` for a JPEG)
    let output_file = options
        .output
        .as_ref()
        .filter(|path| !options.output_is_folder && is_file_output(path, &settings))
        .cloned();
    let mut convert_to_extension: Option<String> = None;
    if let Some(path) = &output_file {
        if options.inputs.len() != 1 || !options.inputs[0].is_file() || files.len() != 1 {
            return Err(CliError::new(
                exit_code::USAGE,
                "fileOutput",
                "A file name in --output= works with one file only. Use a folder for several files or a folder.",
            ));
        }
        let media_type = files[0]["mediaType"].as_str().unwrap_or("video");
        let extension = extension_of(path).unwrap_or_default();
        let allowed = settings
            .output_extensions
            .get(media_type)
            .cloned()
            .unwrap_or_default();
        if !allowed.contains(&extension) {
            let media = match media_type {
                "image" => "An image",
                "audio" => "An audio file",
                _ => "A video",
            };
            return Err(CliError::new(
                exit_code::USAGE,
                "unsupportedFormat",
                format!(
                    "{media} cannot be saved as .{extension}. It can be saved as {}.",
                    allowed.join(", ")
                ),
            ));
        }
        convert_to_extension = Some(extension);
    } else if let Some(path) = options.output.as_ref().filter(|path| path.is_file()) {
        return Err(CliError::new(
            exit_code::USAGE,
            "outputFolder",
            format!(
                "The output {} is a file of a format CompressO does not save in, not a folder.",
                path.display()
            ),
        ));
    } else if let Some(path) = options.output.as_ref() {
        // A new folder named like a file (e.g. a typo, `--output=clip.web`) is not made: it is
        // most likely a file name in a format CompressO does not save in
        let extension = extension_of(path);
        if !options.output_is_folder && !path.is_dir() && extension.is_some() {
            let extension = extension.unwrap_or_default();
            let formats = match files.as_slice() {
                [file] if options.inputs.len() == 1 && options.inputs[0].is_file() => settings
                    .output_extensions
                    .get(file["mediaType"].as_str().unwrap_or("video"))
                    .map(|formats| format!(" It can be saved as {}.", formats.join(", ")))
                    .unwrap_or_default(),
                _ => String::new(),
            };
            return Err(CliError::new(
                exit_code::USAGE,
                "unsupportedFormat",
                format!(
                    "--output= ends in \".{extension}\", which is not a format CompressO saves in.{formats} For a folder with a dot in its name, end it with a slash, for example --output=\"{}/\".",
                    path.file_name()
                        .map(|name| name.to_string_lossy().to_string())
                        .unwrap_or_default()
                ),
            ));
        }
    }

    // The media types among the inputs, & the presets they are compressed with
    let mut used: BTreeMap<String, String> = BTreeMap::new();
    for file in &files {
        let media_type = file["mediaType"].as_str().unwrap_or("video");
        if let Some(preset) = presets.get(media_type) {
            used.insert(media_type.to_string(), preset.name.clone());
        }
    }
    // Nothing here can ask where to save
    if options.output.is_none() {
        for media_type in used.keys() {
            let preset = presets[media_type.as_str()];
            if !preset.output.saves_automatically() {
                return Err(CliError::new(
                    exit_code::NEEDS_OUTPUT,
                    "needsOutput",
                    format!(
                        "The {media_type} preset \"{}\" asks where to save each time. Choose a folder with --output=<folder>.",
                        preset.name
                    ),
                ));
            }
        }
    }

    let overrides = &options.overrides;
    let effective = EffectiveSettings {
        output: OutputSettings {
            skip_larger_outputs: overrides
                .skip_larger_outputs
                .unwrap_or(settings.output.skip_larger_outputs),
            preserve_folder_structure: overrides
                .preserve_folder_structure
                .unwrap_or(settings.output.preserve_folder_structure),
            replace_original_files: overrides
                .replace_original_files
                .unwrap_or(settings.output.replace_original_files),
            use_hardware_acceleration: overrides
                .use_hardware_acceleration
                .unwrap_or(settings.output.use_hardware_acceleration),
            reach_target_sizes_without_acceleration: overrides
                .reach_target_sizes_without_acceleration
                .unwrap_or(settings.output.reach_target_sizes_without_acceleration),
        },
        file_name_prefix: overrides.file_name_prefix.clone(),
        // The file's folder, for a file
        output_folder: match &output_file {
            Some(path) => path.parent().map(|folder| folder.display().to_string()),
            None => options
                .output
                .as_ref()
                .map(|folder| folder.display().to_string()),
        },
        output_file: output_file.as_ref().map(|path| path.display().to_string()),
    };

    let mut report = Report {
        status: String::new(),
        job_id: None,
        presets: used,
        settings: effective,
        files: Vec::new(),
        skipped,
        summary: Summary::default(),
        is_interrupted: false,
    };

    let file_result = |file: &Value, status: &str| {
        let media_type = file["mediaType"].as_str().unwrap_or("video").to_string();
        FileResult {
            input: file["path"].as_str().unwrap_or_default().to_string(),
            preset: presets
                .get(media_type.as_str())
                .map(|preset| preset.name.clone())
                .unwrap_or_default(),
            media_type,
            status: status.to_string(),
            output: None,
            output_folder: None,
            original_size: None,
            output_size: None,
            reason: None,
            error: None,
            replaced_original: false,
            id: file["id"].as_str().unwrap_or_default().to_string(),
            progress: 0,
        }
    };

    if options.dry_run {
        report.files = files
            .iter()
            .map(|file| {
                let mut result = file_result(file, "planned");
                if let Some(path) = &report.settings.output_file {
                    result.output = Some(path.clone());
                    result.output_folder = report.settings.output_folder.clone();
                    return result;
                }
                let preset = presets[result.media_type.as_str()];
                result.output_folder = Some(destination_folder(
                    &result.input,
                    file["relativeDir"].as_str().unwrap_or_default(),
                    preset,
                    options,
                    report.settings.output.preserve_folder_structure,
                ));
                result
            })
            .collect();
        report.status = String::from("dryRun");
        return Ok(report);
    }

    let mut job = json!({
        "presetIds": {
            "video": chosen.contains("video").then(|| &presets["video"].id),
            "image": chosen.contains("image").then(|| &presets["image"].id),
            "audio": chosen.contains("audio").then(|| &presets["audio"].id),
        },
        "outputFolder": report.settings.output_folder,
        "outputFileName": output_file
            .as_ref()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().to_string()),
        "convertToExtension": convert_to_extension,
        "fileNamePrefix": overrides.file_name_prefix,
    });
    for (key, value) in [
        ("skipLargerOutputs", overrides.skip_larger_outputs),
        (
            "preserveFolderStructure",
            overrides.preserve_folder_structure,
        ),
        ("replaceOriginalFiles", overrides.replace_original_files),
        (
            "useHardwareAcceleration",
            overrides.use_hardware_acceleration,
        ),
        (
            "reachTargetSizesWithoutAcceleration",
            overrides.reach_target_sizes_without_acceleration,
        ),
    ] {
        job[key] = json!(value);
    }

    on_event(Event::Plan(&report));
    let accepted = connection
        .request(json!({ "type": "compress", "inputs": inputs, "job": job }))
        .await?;
    report.job_id = accepted["jobId"].as_str().map(String::from);
    report.files = accepted["files"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|file| file_result(file, "waiting"))
                .collect()
        })
        .unwrap_or_default();
    on_event(Event::Accepted {
        job_id: report.job_id.as_deref().unwrap_or_default(),
        files: &report.files,
    });
    let index_of: HashMap<String, usize> = report
        .files
        .iter()
        .enumerate()
        .map(|(index, file)| (file.id.clone(), index))
        .collect();

    let mut is_cancelling = false;
    loop {
        let message = tokio::select! {
            message = connection.recv() => message?,
            changed = cancel.changed(), if !is_cancelling => {
                if changed.is_ok() && *cancel.borrow() {
                    is_cancelling = true;
                    report.is_interrupted = true;
                    connection.send(json!({ "type": "cancel" })).await?;
                }
                continue;
            }
        };
        match message["type"].as_str() {
            Some("progress") => {
                let Some(&index) = message["id"].as_str().and_then(|id| index_of.get(id)) else {
                    continue;
                };
                let percent = message["progress"].as_u64().unwrap_or(0).min(100) as u8;
                report.files[index].progress = percent;
                on_event(Event::Progress { index, percent });
            }
            Some("file") => {
                let item = &message["item"];
                let Some(&index) = item["id"].as_str().and_then(|id| index_of.get(id)) else {
                    continue;
                };
                apply_item(&mut report.files[index], item);
                on_event(Event::Finished {
                    index,
                    file: &report.files[index],
                });
            }
            Some("paused") => on_event(Event::Paused(message["paused"].as_bool() == Some(true))),
            Some("done") => break,
            Some("error") => return Err(crate::client::app_error(&message)),
            _ => {}
        }
    }
    report.finish();
    Ok(report)
}

/// A media's result, from its item in the app's queue
fn apply_item(file: &mut FileResult, item: &Value) {
    let text = |key: &str| item[key].as_str().map(String::from);
    file.original_size = item["originalSize"].as_u64();
    file.output_size = item["outputSize"].as_u64();
    file.reason = text("reason");
    file.error = text("error").or_else(|| text("message"));
    file.status = match item["status"].as_str() {
        Some("done") => match text("savedPath") {
            Some(saved_path) => {
                file.replaced_original = saved_path == file.input;
                file.output = Some(saved_path);
                file.error = None;
                "saved"
            }
            None => "notSaved",
        },
        Some("failed") => "failed",
        _ => "cancelled",
    }
    .to_string();
    if file.status == "notSaved" {
        file.error = None;
    }
}
