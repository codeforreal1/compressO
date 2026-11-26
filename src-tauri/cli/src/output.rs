//! What the command line prints: results on stdout, progress on stderr (only in a terminal)
use std::io::{IsTerminal, Write};

use crate::client::StartupStatus;
use crate::job::{Event, FileResult, Report};
use crate::settings::{Settings, MEDIA_TYPES};

pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    // Windows Explorer divides by 1024 while labeling the units KB/MB/GB
    const BASE: f64 = if cfg!(windows) { 1024.0 } else { 1000.0 };
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= BASE && unit < UNITS.len() - 1 {
        value /= BASE;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

fn file_name(path: &str) -> &str {
    std::path::Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
}

fn on_off(value: bool) -> &'static str {
    if value {
        "on"
    } else {
        "off"
    }
}

/// Follows a compression in the terminal
pub struct HumanOutput {
    quiet: bool,
    /// Progress is shown on one line, rewritten, only in a terminal
    show_progress: bool,
    files: Vec<FileResult>,
    has_status_line: bool,
}

impl HumanOutput {
    pub fn new(quiet: bool) -> Self {
        Self {
            quiet,
            show_progress: !quiet && std::io::stderr().is_terminal(),
            files: Vec::new(),
            has_status_line: false,
        }
    }

    fn clear_status_line(&mut self) {
        if self.has_status_line {
            eprint!("\r\x1b[2K");
            let _ = std::io::stderr().flush();
            self.has_status_line = false;
        }
    }

    fn status_line(&mut self, text: &str) {
        if !self.show_progress {
            return;
        }
        // Kept to the terminal's usual width
        let text: String = text.chars().take(100).collect();
        eprint!("\r\x1b[2K{text}");
        let _ = std::io::stderr().flush();
        self.has_status_line = true;
    }

    /// A note on stderr (not with `--quiet`)
    pub fn note(&mut self, text: &str) {
        if self.quiet {
            return;
        }
        self.clear_status_line();
        eprintln!("{text}");
    }

    fn show_progress_line(&mut self) {
        let done = self
            .files
            .iter()
            .filter(|file| !matches!(file.status.as_str(), "waiting"))
            .count();
        let compressing: Vec<String> = self
            .files
            .iter()
            .filter(|file| file.status == "waiting" && file.progress > 0)
            .map(|file| format!("{} {}%", file_name(&file.input), file.progress))
            .collect();
        let text = if compressing.is_empty() {
            format!("{done} of {} done", self.files.len())
        } else {
            format!(
                "{done} of {} done · {}",
                self.files.len(),
                compressing.join(", ")
            )
        };
        self.status_line(&text);
    }

    pub fn on_event(&mut self, event: Event) {
        match event {
            Event::Startup(StartupStatus::StartingApp) => self.note("Starting CompressO…"),
            Event::Startup(StartupStatus::PreparingTools) => {
                self.note("CompressO is preparing its compression tools. This may take a moment…")
            }
            Event::Plan(report) => self.print_plan(report),
            Event::Accepted { files, .. } => {
                self.files = files.to_vec();
                self.show_progress_line();
            }
            Event::Progress { index, percent } => {
                if let Some(file) = self.files.get_mut(index) {
                    file.progress = percent;
                }
                self.show_progress_line();
            }
            Event::Finished { index, file } => {
                if let Some(entry) = self.files.get_mut(index) {
                    *entry = file.clone();
                }
                if !self.quiet {
                    self.clear_status_line();
                    println!("{}", describe_file(file));
                }
                self.show_progress_line();
            }
            Event::Paused(true) => {
                self.note("The queue is paused in CompressO. Resume it in the app to continue.")
            }
            Event::Paused(false) => self.note("The queue was resumed."),
        }
    }

    /// The presets & settings used, before compressing
    pub fn print_plan(&mut self, report: &Report) {
        if self.quiet {
            return;
        }
        let presets: Vec<String> = MEDIA_TYPES
            .iter()
            .filter_map(|media_type| {
                let name = report.presets.get(*media_type)?;
                Some(format!("{name} ({media_type})"))
            })
            .collect();
        let settings = &report.settings;
        self.note(&format!(
            "Presets: {}. Skip larger outputs: {}, preserve folder structure: {}, replace original files: {}, hardware acceleration: {}.",
            presets.join(", "),
            on_off(settings.output.skip_larger_outputs),
            on_off(settings.output.preserve_folder_structure),
            on_off(settings.output.replace_original_files),
            on_off(settings.output.use_hardware_acceleration),
        ));
    }

    pub fn finish(&mut self, report: &Report) {
        self.clear_status_line();
        if self.quiet {
            return;
        }
        if report.status == "dryRun" {
            self.print_plan(report);
            for file in &report.files {
                println!(
                    "{} ({}, {}) → {}",
                    file.input,
                    file.media_type,
                    file.preset,
                    file.output
                        .as_deref()
                        .or(file.output_folder.as_deref())
                        .unwrap_or_default()
                );
            }
        }
        for path in &report.skipped {
            eprintln!("Skipped (format not supported): {path}");
        }
        if report.status == "dryRun" {
            let count = report.files.len();
            let files = if count == 1 { "file" } else { "files" };
            println!("{count} {files} would be compressed. Nothing was compressed.");
            return;
        }
        let summary = &report.summary;
        let mut parts = vec![format!("{} saved", summary.saved)];
        if summary.not_saved > 0 {
            parts.push(format!("{} not saved", summary.not_saved));
        }
        if summary.failed > 0 {
            parts.push(format!("{} failed", summary.failed));
        }
        if summary.cancelled > 0 {
            parts.push(format!("{} cancelled", summary.cancelled));
        }
        let saved_space = if summary.bytes_saved > 0 {
            format!(" Saved {}.", format_bytes(summary.bytes_saved as u64))
        } else {
            String::new()
        };
        println!("{}.{saved_space}", parts.join(", "));
    }
}

/// One line for a finished media, e.g. `✓ clip.mov  48.2 MB → 9.7 MB (−80%)  ~/clip.mp4`
fn describe_file(file: &FileResult) -> String {
    let sizes = match (file.original_size, file.output_size) {
        (Some(original), Some(output)) if original > 0 => {
            let change = (output as f64 - original as f64) * 100.0 / original as f64;
            format!(
                "{} → {} ({}{:.0}%)",
                format_bytes(original),
                format_bytes(output),
                if change > 0.0 { "+" } else { "" },
                change
            )
        }
        _ => String::new(),
    };
    let name = file_name(&file.input);
    match file.status.as_str() {
        "saved" => {
            let replaced = if file.replaced_original {
                " (original moved to the Trash)"
            } else {
                ""
            };
            format!(
                "✓ {name}  {sizes}  {}{replaced}",
                file.output.as_deref().unwrap_or_default()
            )
        }
        "notSaved" => format!("– {name}  {sizes}  Not saved: larger than the original"),
        "failed" => {
            let why = match file.reason.as_deref() {
                Some("accessDenied") => {
                    "The system did not allow opening it (check the privacy settings)".to_string()
                }
                Some("saveFailed") => "The compressed media could not be saved".to_string(),
                Some("noSaveLocation") => {
                    "Its preset asks where to save (use --output=<folder>)".to_string()
                }
                _ => file
                    .error
                    .clone()
                    .map(|error| format!("Could not compress: {error}"))
                    .unwrap_or_else(|| "Could not compress".to_string()),
            };
            format!("✗ {name}  {why}")
        }
        _ => format!("✗ {name}  Cancelled"),
    }
}

/// `compresso presets`
pub fn print_presets(settings: &Settings, filter_media_type: Option<&str>) {
    for media_type in MEDIA_TYPES {
        if filter_media_type.is_some_and(|mt| mt != media_type) {
            continue;
        }
        let title = match media_type {
            "video" => "Video presets",
            "image" => "Image presets",
            _ => "Audio presets",
        };
        println!("{title}");
        let presets: Vec<_> = settings.presets_of(media_type).collect();
        let width = presets
            .iter()
            .map(|preset| preset.name.chars().count())
            .max()
            .unwrap_or(0);
        let default_id = settings
            .default_preset(media_type)
            .map(|preset| preset.id.clone());
        for preset in presets {
            let mark = if Some(&preset.id) == default_id.as_ref() {
                "*"
            } else {
                " "
            };
            let location = match preset.output.save_location.as_str() {
                "sameFolder" => "saves next to the original".to_string(),
                "fixedFolder" => match &preset.output.save_folder {
                    Some(folder) => format!("saves to {folder}"),
                    None => "asks where to save".to_string(),
                },
                _ => "asks where to save (needs --output)".to_string(),
            };
            println!(
                "  {mark} {:width$}  {}  ({location})",
                preset.name,
                preset.summary.join(" · "),
            );
        }
        println!();
    }
    println!("* The default preset of its media type, used without --video-preset=, --image-preset= or --audio-preset=.");
}

pub fn print_preset_change(value: &serde_json::Value, action: &str) {
    match action {
        "create" => {
            let preset = &value["preset"];
            let name = preset["name"].as_str().unwrap_or("?");
            let mt = preset["mediaType"].as_str().unwrap_or("?");
            if value["replaced"].as_bool() == Some(true) {
                println!("Replaced {mt} preset \"{name}\".");
            } else {
                println!("Created {mt} preset \"{name}\".");
            }
        }
        "update" => {
            let preset = &value["preset"];
            let name = preset["name"].as_str().unwrap_or("?");
            let mt = preset["mediaType"].as_str().unwrap_or("?");
            let rev = preset["revision"].as_u64().unwrap_or(1);
            println!("Updated {mt} preset \"{name}\" (revision {rev}).");
        }
        "delete" => {
            let name = value["deletedName"].as_str().unwrap_or("?");
            let mt = value["mediaType"].as_str().unwrap_or("?");
            println!("Deleted {mt} preset \"{name}\".");
            if value["defaultResetToStandard"].as_bool() == Some(true) {
                println!("Default {mt} preset reset to Standard.");
            }
            if let Some(folders) = value["affectedWatchedFolders"]
                .as_array()
                .filter(|list| !list.is_empty())
            {
                let paths: Vec<&str> = folders
                    .iter()
                    .filter_map(|f| f["path"].as_str())
                    .collect();
                println!(
                    "Watched folders now falling back to default: {}",
                    paths.join(", ")
                );
            }
        }
        "default" => {
            let name = value["presetName"].as_str().unwrap_or("?");
            let mt = value["mediaType"].as_str().unwrap_or("?");
            println!("Default {mt} preset set to \"{name}\".");
        }
        _ => {}
    }
    if let Some(warnings) = value["warnings"].as_array() {
        for warning in warnings {
            if let Some(msg) = warning["message"].as_str() {
                eprintln!("Warning: {msg}");
            }
        }
    }
}

fn watched_folder_preset<'a>(folder: &'a serde_json::Value, media_type: &str) -> &'a str {
    folder["presets"][media_type]["name"]
        .as_str()
        .unwrap_or("?")
}

fn watched_folder_warning(warning: &str) -> &str {
    match warning {
        "missingFolder" => "the folder is missing",
        "saveLocation" => {
            "its presets ask where to save, so it is not watched (choose presets that save automatically)"
        }
        "menuBarIconOff" => {
            "the menu bar / tray icon is off, so it is not watched (Settings > General)"
        }
        _ => warning,
    }
}

/// `compresso watch list`
pub fn print_watched_folders(value: &serde_json::Value) {
    let Some(folders) = value["watchedFolders"].as_array() else {
        println!("No watched folders.");
        return;
    };
    if folders.is_empty() {
        println!("No watched folders.");
        println!("Add one with: compresso watch add <folder>");
        return;
    }
    for folder in folders {
        let name = folder["name"].as_str().unwrap_or("?");
        let path = folder["path"].as_str().unwrap_or("?");
        let id = folder["id"].as_str().unwrap_or("?");
        let is_enabled = folder["isEnabled"].as_bool().unwrap_or(false);
        let is_watched = folder["isWatched"].as_bool().unwrap_or(false);
        let state = if is_watched {
            "watching"
        } else if is_enabled {
            "not watching"
        } else {
            "off"
        };
        let mark = if is_watched { "*" } else { " " };
        println!("{mark} {name}  [{state}]");
        println!("    {path}");
        println!("    id: {id}");
        println!(
            "    video: {} · image: {} · audio: {}",
            watched_folder_preset(folder, "video"),
            watched_folder_preset(folder, "image"),
            watched_folder_preset(folder, "audio"),
        );
        if let Some(warnings) = folder["warnings"].as_array() {
            for warning in warnings.iter().filter_map(|warning| warning.as_str()) {
                println!("    ! {}", watched_folder_warning(warning));
            }
        }
    }
    println!();
    println!("Update or remove with: compresso watch update|remove <id or folder>");
}

/// `compresso watch add|update|remove`
pub fn print_watch_change(value: &serde_json::Value, action: &str) {
    let folder = &value["folder"];
    let name = folder["name"].as_str();
    match action {
        "add" => {
            if value["added"].as_bool() == Some(true) {
                match name {
                    Some(name) => println!("Added {name} to watched folders."),
                    None => println!("Added the folder to watched folders."),
                }
            } else {
                match name {
                    Some(name) => println!("{name} is already watched."),
                    None => println!("The folder is already watched."),
                }
            }
        }
        "update" => match name {
            Some(name) => println!("Updated {name}."),
            None => println!("Updated the watched folder."),
        },
        "remove" => {
            if value["removed"].as_bool() == Some(true) {
                println!("Removed the folder from watched folders.");
            } else {
                println!("No watched folder matched; nothing was removed.");
            }
        }
        _ => {}
    }
    println!();
    print_watched_folders(value);
}
