//! The command line's arguments
use std::path::PathBuf;

use crate::error::CliError;
use crate::job::{absolute_path, CompressOptions};
use crate::watched_folders::PresetChanges;

pub const HELP: &str = r#"The CompressO CLI: compresses videos, images and audio with the presets or JSON contracts
of the CompressO app, as if they were dropped on the app.

Usage:
  compresso [compress] <file or folder>... [options]
  compresso presets [list] [--media-type=video|image|audio] [--json]
  compresso presets get <name or id> [--media-type=video|image|audio]
  compresso presets create <file or -> [--on-conflict=error|rename|replace] [--json]
  compresso presets update <name or id> <file or -> [--media-type=...] [--replace] [--if-revision=N] [--json]
  compresso presets delete <name or id> [--media-type=...] [--json]
  compresso presets default <name or id|standard> --media-type=video|image|audio [--json]
  compresso contract schema <video|image|audio>
  compresso contract validate <file or -> [--mode=oneShot|preset] [--json]
  compresso inspect <file or folder>... [--json]
  compresso capabilities [--json]
  compresso cache clear [--json]
  compresso history [list] [--limit=N] [--json]
  compresso history clear [--json]
  compresso queue [list|pause|resume|clear|cancel] [--json]
  compresso settings [get] [<key>] [--json]
  compresso settings set <key>=<value>... [--json]
  compresso logs [--path] [--tail=N] [--json]
  compresso about [--json]
  compresso watch list [--json]
  compresso watch add <folder> [watch options]
  compresso watch update <id or folder> [watch options]
  compresso watch remove <id or folder> [--json]
  compresso mcp
  compresso --help | --version

Commands:
  compress      Compress files and folders (the default; folders are read as when dropped)
  presets       List, inspect, create, update, delete, or set default presets
  contract      Inspect JSON Contract schemas or validate a contract without saving
  inspect       Probe metadata, dimensions, codecs, dynamic range, and streams
  capabilities  Show app version, available CPU threads, hardware encoders, tools, and log path
  cache         Manage temporary cache (`clear` only runs while idle with no open media)
  history       List or clear compression history
  queue         Inspect or control the drop/watch compression queue
  settings      Read or update persistent CompressO app settings
  logs          Show the current log file path or recent log lines
  about         Show version, license, author, website/changelog/GitHub links, and credits
  watch         Manage the folders whose new media is compressed (Settings > Watch Folder)
  mcp           Run an MCP server on stdin/stdout, for AI agents

Every option with a value is written with =, e.g. --video-preset="Standard". Quote values
with spaces.

Presets & Contracts (a media type without one uses its default preset in the app):
  --video-preset=<name>    Preset for videos, by name or id
  --image-preset=<name>    Preset for images
  --audio-preset=<name>    Preset for audio files
  --preset=<name>          For a single file: its preset, whatever its media type
  --contract=<file or ->   One-shot CompressO JSON contract (repeatable, one per mediaType).
                           Reads JSON from stdin with --contract=-. Supports one-shot fields
                           (metadata.set, video.thumbnail, subtitles) for single files or batches.

Output:
  --output=<folder>        Save to this folder instead of the presets' save location.
                           Required when a preset asks where to save each time.
                           End it with / for a new folder with a dot in its name.
  --output=<file>          For a single file: save it under this name. A different extension
                           converts it to that format (e.g. a JPEG to --output=small.png), with
                           the preset's other settings. An existing file is never replaced; a
                           numbered name is used.

Output settings (Settings > Output in the app; without an option, the app's setting is used,
and an option changes it for this command only; a bare option means =1):
  --skip-larger-outputs=0|1
  --preserve-folder-structure=0|1
  --replace-original-files=0|1
  --filename-template=<text>         Tokens: {name}, {date}, {time}, {preset} (empty keeps original)
  --filename-prefix=<text>           (--filename-prefix= keeps the original names)
  --hardware-acceleration=0|1
  --reach-target-sizes-without-acceleration=0|1
  --cpu-threads=<n>                  Max CPU threads for this run (0 = all cores)

Watch folders (compresso watch ...; CompressO must be running to watch them):
  list                     List the watched folders, their presets & whether they are watched
  add <folder>             Watch a folder: new media in it & its subfolders is compressed
  update <id or folder>    Turn a folder on/off, or change the presets it uses
  remove <id or folder>    Stop watching a folder; its files are kept
  --enabled=0|1            With add or update: watch the folder, or stop watching it
  --video-preset=<name>    With add or update: the preset for videos in it (or default)
  --image-preset=<name>    With add or update: the preset for images in it (or default)
  --audio-preset=<name>    With add or update: the preset for audio files in it (or default)
  --json                   Print the folders, or the change, as JSON

Other options:
  --json         Print one JSON document with the results, and no progress
  -q, --quiet    Print only errors
  --dry-run      List the files, their presets and where they would be saved, without
                 compressing them

Exit codes:
  0    Every file was compressed (saved, or not saved as it was larger than the original)
  1    One or more files could not be compressed or saved, or were cancelled
  2    Wrong options, missing inputs, an unknown preset or watched folder, or no supported media
  3    A preset asks where to save each time and no --output=<folder> was given
  4    CompressO could not be started or reached, or its tools are not ready
  130  Stopped with Ctrl+C

CompressO runs in the background while it compresses (it is started when it is not running, and
quits again once done). The media shows in the app's queue and history.

Examples:
  compresso clip.mov
  compresso ~/Movies/clip.mov --video-preset="Standard"
  compresso ~/Pictures/Trip --image-preset="Web"
  compresso ~/Desktop/Screens --output=~/Desktop/Compressed --replace-original-files=0 --json
  compresso photo.jpg --output=./compressed-photo.png
  compresso clip.mov --output=./clip.mp4 --video-preset="Web"
  compresso talk.mp4 --output=./talk.mp3
  compresso clip.mov --contract=video.contract.json
  cat video.contract.json | compresso clip.mov --contract=-
  compresso contract schema video
  compresso contract validate video.contract.json
  compresso presets get "Web" --media-type=video
  compresso presets create web.contract.json
  compresso presets update "Web" patch.json
  compresso capabilities
  compresso inspect clip.mov
  compresso cache clear
  compresso history --limit=10
  compresso queue list
  compresso settings get
  compresso settings set cpuThreadLimit=4 useHardwareAcceleration=true
  compresso logs --tail=50
  compresso about
  compresso watch list
  compresso watch add ~/Downloads/photos --video-preset="2 clips"
  compresso watch update <id> --enabled=0
  compresso watch remove ~/Downloads/photos
"#;

pub enum Command {
    Help,
    Version,
    Presets(PresetsCommand),
    Contract(ContractCommand),
    Watch(WatchCommand),
    Capabilities { json: bool },
    Inspect { inputs: Vec<PathBuf>, json: bool },
    Cache(CacheCommand),
    History(HistoryCommand),
    Queue(QueueCommand),
    Settings(SettingsCommand),
    Logs {
        path_only: bool,
        tail: Option<usize>,
        json: bool,
    },
    About { json: bool },
    Mcp,
    Compress(CompressArgs),
}

/// `compresso cache ...`
pub enum CacheCommand {
    Clear { json: bool },
}

/// `compresso history ...`
pub enum HistoryCommand {
    List { limit: Option<usize>, json: bool },
    Clear { json: bool },
}

/// `compresso queue ...`
pub enum QueueCommand {
    List { json: bool },
    Action { action: String, json: bool },
}

/// `compresso settings ...`
pub enum SettingsCommand {
    Get { key: Option<String>, json: bool },
    Set { patch: serde_json::Value, json: bool },
}

/// `compresso contract ...`
pub enum ContractCommand {
    Schema {
        media_type: String,
    },
    Validate {
        file: String,
        mode: Option<String>,
        require_name: bool,
        json: bool,
    },
}

/// `compresso presets ...`
pub enum PresetsCommand {
    List {
        media_type: Option<String>,
        json: bool,
    },
    Get {
        id_or_name: String,
        media_type: Option<String>,
    },
    Create {
        file: String,
        on_conflict: Option<String>,
        json: bool,
    },
    Update {
        id_or_name: String,
        file: String,
        media_type: Option<String>,
        replace: bool,
        if_revision: Option<u64>,
        json: bool,
    },
    Delete {
        id_or_name: String,
        media_type: Option<String>,
        json: bool,
    },
    SetDefault {
        id_or_name: String,
        media_type: String,
        json: bool,
    },
}

/// `compresso watch ...`
pub enum WatchCommand {
    List { json: bool },
    Add(WatchFolderChange),
    Update(WatchFolderChange),
    Remove { folder: WatchFolderRef, json: bool },
}

pub struct WatchFolderChange {
    pub folder: WatchFolderRef,
    pub is_enabled: Option<bool>,
    pub presets: PresetChanges,
    pub json: bool,
}

/// A watched folder given by its id or its path
pub enum WatchFolderRef {
    Id(String),
    Path(String),
}

impl WatchFolderRef {
    pub fn into_id_path(self) -> (Option<String>, Option<String>) {
        match self {
            Self::Id(id) => (Some(id), None),
            Self::Path(path) => (None, Some(path)),
        }
    }
}

#[derive(Default)]
pub struct CompressArgs {
    pub options: CompressOptions,
    pub json: bool,
    pub quiet: bool,
}

/// A path given after `=`, where the shell does not expand `~` (`--output=~/Desktop`)
fn expand_home(path: &str) -> PathBuf {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let Some(home) = home.map(PathBuf::from) else {
        return PathBuf::from(path);
    };
    if path == "~" {
        return home;
    }
    match path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        Some(rest) => home.join(rest),
        None => PathBuf::from(path),
    }
}

/// `=0`/`=1` (a bare option means `=1`)
fn parse_switch(name: &str, value: Option<&str>) -> Result<bool, CliError> {
    match value {
        None | Some("1") => Ok(true),
        Some("0") => Ok(false),
        Some(other) => Err(CliError::usage(format!(
            "--{name} takes 0 or 1, not \"{other}\" (for example --{name}=1)."
        ))),
    }
}

fn parse_watch(args: Vec<String>) -> Result<Command, CliError> {
    let mut args = args.into_iter();
    let Some(subcommand) = args.next() else {
        return Err(CliError::usage(
            "Give a watch command: list, add, update or remove. Run compresso --help.",
        ));
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Ok(Command::Help);
    }

    let mut json = false;
    let mut is_enabled = None;
    let mut presets = PresetChanges::default();
    let mut positional = Vec::new();
    for arg in args {
        if !arg.starts_with('-') || arg == "-" {
            positional.push(arg);
            continue;
        }
        let (name, value) = match arg.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (arg.clone(), None),
        };
        let take_value = |name: &str| -> Result<String, CliError> {
            value.clone().ok_or_else(|| {
                CliError::usage(format!(
                    "{name} needs a value after =, for example {name}=\"<value>\"."
                ))
            })
        };
        match name.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            "--enabled" => is_enabled = Some(parse_switch("enabled", value.as_deref())?),
            "--video-preset" => presets.video = Some(take_value(&name)?),
            "--image-preset" => presets.image = Some(take_value(&name)?),
            "--audio-preset" => presets.audio = Some(take_value(&name)?),
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for watch {subcommand}: {name}"
                )));
            }
        }
    }

    let folder = match subcommand.as_str() {
        "list" => {
            if !positional.is_empty() || is_enabled.is_some() || !presets.is_empty() {
                return Err(CliError::usage("watch list takes only --json."));
            }
            return Ok(Command::Watch(WatchCommand::List { json }));
        }
        "add" | "update" | "remove" => one_watch_folder(positional, &subcommand)?,
        _ => {
            return Err(CliError::usage(format!(
                "Unknown watch command: {subcommand}. Use list, add, update or remove."
            )));
        }
    };

    match subcommand.as_str() {
        "add" => {
            let path = absolute_path(&expand_home(&folder))
                .to_string_lossy()
                .to_string();
            Ok(Command::Watch(WatchCommand::Add(WatchFolderChange {
                folder: WatchFolderRef::Path(path),
                is_enabled,
                presets,
                json,
            })))
        }
        "update" => {
            if is_enabled.is_none() && presets.is_empty() {
                return Err(CliError::usage(
                    "Give --enabled=0|1 or a preset to update a watched folder.",
                ));
            }
            Ok(Command::Watch(WatchCommand::Update(WatchFolderChange {
                folder: watch_folder_ref(&folder),
                is_enabled,
                presets,
                json,
            })))
        }
        "remove" => {
            if is_enabled.is_some() || !presets.is_empty() {
                return Err(CliError::usage(
                    "watch remove takes a folder (or id) and only --json.",
                ));
            }
            Ok(Command::Watch(WatchCommand::Remove {
                folder: watch_folder_ref(&folder),
                json,
            }))
        }
        _ => unreachable!(),
    }
}

fn one_watch_folder(positional: Vec<String>, command: &str) -> Result<String, CliError> {
    match positional.as_slice() {
        [folder] => Ok(folder.clone()),
        [] => Err(CliError::usage(format!(
            "Give the folder for watch {command}. Run compresso --help."
        ))),
        _ => Err(CliError::usage(format!(
            "watch {command} takes one folder (or id)."
        ))),
    }
}

/// A folder id, or a folder path (`~` expanded) when the argument names one
fn watch_folder_ref(value: &str) -> WatchFolderRef {
    let expanded = expand_home(value);
    if expanded.is_absolute() || expanded.is_dir() {
        WatchFolderRef::Path(absolute_path(&expanded).to_string_lossy().to_string())
    } else {
        WatchFolderRef::Id(value.to_string())
    }
}

/// `compresso cache clear [--json]`
fn parse_cache(args: Vec<String>) -> Result<Command, CliError> {
    let mut iter = args.into_iter();
    let Some(subcommand) = iter.next() else {
        return Err(CliError::usage(
            "Give a cache command: clear. Run compresso --help.",
        ));
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Ok(Command::Help);
    }
    if subcommand != "clear" {
        return Err(CliError::usage(format!(
            "Unknown cache command: {subcommand}. Use clear."
        )));
    }
    let mut json = false;
    for arg in iter {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for cache clear: {arg}"
                )));
            }
        }
    }
    Ok(Command::Cache(CacheCommand::Clear { json }))
}

fn parse_capabilities(args: Vec<String>) -> Result<Command, CliError> {
    let mut json = false;
    for arg in args {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for capabilities: {arg}"
                )));
            }
        }
    }
    Ok(Command::Capabilities { json })
}

fn parse_inspect(args: Vec<String>) -> Result<Command, CliError> {
    let mut json = false;
    let mut inputs = Vec::new();
    for arg in args {
        if !arg.starts_with('-') {
            inputs.push(absolute_path(&expand_home(&arg)));
            continue;
        }
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for inspect: {arg}"
                )));
            }
        }
    }
    Ok(Command::Inspect { inputs, json })
}

fn parse_history(args: Vec<String>) -> Result<Command, CliError> {
    let mut iter = args.into_iter().peekable();
    let subcommand = match iter.peek().map(String::as_str) {
        None => "list".to_string(),
        Some(first) if first.starts_with('-') => "list".to_string(),
        Some(_) => iter.next().unwrap(),
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Ok(Command::Help);
    }
    let mut json = false;
    let mut limit: Option<usize> = None;
    for arg in iter {
        let (name, value) = match arg.split_once('=') {
            Some((n, v)) => (n.to_string(), Some(v.to_string())),
            None => (arg.clone(), None),
        };
        match name.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            "--limit" => {
                let raw = value.ok_or_else(|| {
                    CliError::usage("--limit needs a value after =, for example --limit=20.")
                })?;
                let n: usize = raw
                    .parse()
                    .map_err(|_| CliError::usage("--limit must be a non-negative integer."))?;
                limit = Some(n);
            }
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for history {subcommand}: {name}"
                )));
            }
        }
    }
    match subcommand.as_str() {
        "list" => Ok(Command::History(HistoryCommand::List { limit, json })),
        "clear" => {
            if limit.is_some() {
                return Err(CliError::usage("history clear does not take --limit."));
            }
            Ok(Command::History(HistoryCommand::Clear { json }))
        }
        _ => Err(CliError::usage(format!(
            "Unknown history command: {subcommand}. Use list or clear."
        ))),
    }
}

fn parse_queue(args: Vec<String>) -> Result<Command, CliError> {
    let mut iter = args.into_iter().peekable();
    let subcommand = match iter.peek().map(String::as_str) {
        None => "list".to_string(),
        Some(first) if first.starts_with('-') => "list".to_string(),
        Some(_) => iter.next().unwrap(),
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Ok(Command::Help);
    }
    let mut json = false;
    for arg in iter {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for queue {subcommand}: {arg}"
                )));
            }
        }
    }
    match subcommand.as_str() {
        "list" | "status" => Ok(Command::Queue(QueueCommand::List { json })),
        "pause" | "resume" | "clear" | "cancel" => Ok(Command::Queue(QueueCommand::Action {
            action: subcommand,
            json,
        })),
        _ => Err(CliError::usage(format!(
            "Unknown queue command: {subcommand}. Use list, pause, resume, clear, or cancel."
        ))),
    }
}

fn parse_logs(args: Vec<String>) -> Result<Command, CliError> {
    let mut path_only = false;
    let mut tail: Option<usize> = None;
    let mut json = false;
    for arg in args {
        let (name, value) = match arg.split_once('=') {
            Some((n, v)) => (n.to_string(), Some(v.to_string())),
            None => (arg.clone(), None),
        };
        match name.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--path" => path_only = true,
            "--json" => json = true,
            "--tail" => {
                let raw = value.ok_or_else(|| {
                    CliError::usage("--tail needs a value after =, for example --tail=50.")
                })?;
                let n: usize = raw
                    .parse()
                    .map_err(|_| CliError::usage("--tail must be a non-negative integer."))?;
                tail = Some(n);
            }
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for logs: {name}"
                )));
            }
        }
    }
    Ok(Command::Logs {
        path_only,
        tail,
        json,
    })
}

fn parse_about(args: Vec<String>) -> Result<Command, CliError> {
    let mut json = false;
    for arg in args {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for about: {arg}"
                )));
            }
        }
    }
    Ok(Command::About { json })
}

fn parse_setting_value(key: &str, raw: &str) -> serde_json::Value {
    match raw {
        "true" => serde_json::Value::Bool(true),
        "false" => serde_json::Value::Bool(false),
        "null" => serde_json::Value::Null,
        _ => {
            if key == "cpuThreadLimit" {
                if let Ok(n) = raw.parse::<u64>() {
                    return serde_json::Value::from(n);
                }
            }
            if key == "saveFolder" {
                let expanded = expand_home(raw);
                return serde_json::Value::String(
                    absolute_path(&expanded).to_string_lossy().to_string(),
                );
            }
            serde_json::Value::String(raw.to_string())
        }
    }
}

fn parse_settings(args: Vec<String>) -> Result<Command, CliError> {
    let mut iter = args.into_iter().peekable();
    let subcommand = match iter.peek().map(String::as_str) {
        None => "get".to_string(),
        Some(first) if first == "-h" || first == "--help" || first == "help" => {
            return Ok(Command::Help);
        }
        Some("get") | Some("set") => iter.next().unwrap(),
        Some(first) if first.starts_with('-') => "get".to_string(),
        Some(_) => "get".to_string(),
    };

    match subcommand.as_str() {
        "get" => {
            let mut json = false;
            let mut key: Option<String> = None;
            for arg in iter {
                match arg.as_str() {
                    "-h" | "--help" => return Ok(Command::Help),
                    "--json" => json = true,
                    other if other.starts_with('-') => {
                        return Err(CliError::usage(format!(
                            "Unknown option for settings get: {other}"
                        )));
                    }
                    other => {
                        if key.is_some() {
                            return Err(CliError::usage(
                                "settings get takes at most one setting key.",
                            ));
                        }
                        key = Some(other.to_string());
                    }
                }
            }
            Ok(Command::Settings(SettingsCommand::Get { key, json }))
        }
        "set" => {
            let mut json = false;
            let mut map = serde_json::Map::new();
            for arg in iter {
                match arg.as_str() {
                    "-h" | "--help" => return Ok(Command::Help),
                    "--json" => json = true,
                    other if other.starts_with('-') => {
                        return Err(CliError::usage(format!(
                            "Unknown option for settings set: {other}"
                        )));
                    }
                    other => {
                        let Some((key, value)) = other.split_once('=') else {
                            return Err(CliError::usage(format!(
                                "Write each setting as <key>=<value>, not \"{other}\"."
                            )));
                        };
                        let key = key.trim();
                        if key.is_empty() {
                            return Err(CliError::usage("Setting key cannot be empty."));
                        }
                        map.insert(key.to_string(), parse_setting_value(key, value));
                    }
                }
            }
            if map.is_empty() {
                return Err(CliError::usage(
                    "Give at least one <key>=<value> to update, for example cpuThreadLimit=4.",
                ));
            }
            Ok(Command::Settings(SettingsCommand::Set {
                patch: serde_json::Value::Object(map),
                json,
            }))
        }
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(args: &[&str]) -> Command {
        parse(args.iter().map(|arg| arg.to_string()).collect()).unwrap()
    }

    #[test]
    fn parses_watch_list() {
        match parsed(&["watch", "list", "--json"]) {
            Command::Watch(WatchCommand::List { json }) => assert!(json),
            _ => panic!("expected watch list"),
        }
    }

    #[test]
    fn parses_watch_add_and_expands_the_folder() {
        match parsed(&[
            "watch",
            "add",
            "~/Downloads/photos",
            "--video-preset=2 clips",
            "--enabled=0",
        ]) {
            Command::Watch(WatchCommand::Add(change)) => {
                let (_, path) = change.folder.into_id_path();
                let home =
                    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap();
                let expected = std::path::Path::new(&home)
                    .join("Downloads/photos")
                    .to_string_lossy()
                    .to_string();
                assert_eq!(path.unwrap(), expected);
                assert_eq!(change.is_enabled, Some(false));
                assert_eq!(change.presets.video.as_deref(), Some("2 clips"));
                assert!(!change.json);
            }
            _ => panic!("expected watch add"),
        }
    }

    #[test]
    fn parses_watch_update_by_id_or_path() {
        match parsed(&[
            "watch",
            "update",
            "mwp9vgeq-3qjtai",
            "--enabled=1",
            "--image-preset=Web",
        ]) {
            Command::Watch(WatchCommand::Update(change)) => {
                assert!(matches!(change.folder, WatchFolderRef::Id(id) if id == "mwp9vgeq-3qjtai"));
                assert_eq!(change.is_enabled, Some(true));
                assert_eq!(change.presets.image.as_deref(), Some("Web"));
            }
            _ => panic!("expected watch update"),
        }
        match parsed(&[
            "watch",
            "update",
            "/this/folder/does/not/exist",
            "--video-preset=default",
        ]) {
            Command::Watch(WatchCommand::Update(change)) => {
                assert!(matches!(change.folder, WatchFolderRef::Path(_)));
            }
            _ => panic!("expected watch update"),
        }
    }

    #[test]
    fn parses_watch_remove_and_its_options() {
        match parsed(&["watch", "remove", "mwp9vgeq-3qjtai", "--json"]) {
            Command::Watch(WatchCommand::Remove { folder, json }) => {
                assert!(matches!(folder, WatchFolderRef::Id(id) if id == "mwp9vgeq-3qjtai"));
                assert!(json);
            }
            _ => panic!("expected watch remove"),
        }
    }

    #[test]
    fn rejects_watch_mistakes() {
        assert!(parse(vec!["watch".to_string()]).is_err());
        assert!(parse(vec!["watch".to_string(), "add".to_string()]).is_err());
        assert!(parse(vec![
            "watch".to_string(),
            "update".to_string(),
            "id".to_string(),
        ])
        .is_err());
        assert!(parse(vec![
            "watch".to_string(),
            "list".to_string(),
            "--enabled=0".to_string(),
        ])
        .is_err());
    }

    #[test]
    fn parses_presets_and_contract_commands() {
        match parsed(&["presets", "--json"]) {
            Command::Presets(PresetsCommand::List { media_type, json }) => {
                assert!(media_type.is_none());
                assert!(json);
            }
            _ => panic!("expected presets list"),
        }
        match parsed(&["presets", "get", "Web", "--media-type=video"]) {
            Command::Presets(PresetsCommand::Get {
                id_or_name,
                media_type,
            }) => {
                assert_eq!(id_or_name, "Web");
                assert_eq!(media_type.as_deref(), Some("video"));
            }
            _ => panic!("expected presets get"),
        }
        match parsed(&["presets", "create", "-", "--on-conflict=rename", "--json"]) {
            Command::Presets(PresetsCommand::Create {
                file,
                on_conflict,
                json,
            }) => {
                assert_eq!(file, "-");
                assert_eq!(on_conflict.as_deref(), Some("rename"));
                assert!(json);
            }
            _ => panic!("expected presets create"),
        }
        match parsed(&[
            "presets",
            "update",
            "Web",
            "patch.json",
            "--replace",
            "--if-revision=3",
        ]) {
            Command::Presets(PresetsCommand::Update {
                id_or_name,
                file,
                replace,
                if_revision,
                ..
            }) => {
                assert_eq!(id_or_name, "Web");
                assert_eq!(file, "patch.json");
                assert!(replace);
                assert_eq!(if_revision, Some(3));
            }
            _ => panic!("expected presets update"),
        }
        match parsed(&["presets", "default", "standard", "--media-type=image"]) {
            Command::Presets(PresetsCommand::SetDefault {
                id_or_name,
                media_type,
                ..
            }) => {
                assert_eq!(id_or_name, "standard");
                assert_eq!(media_type, "image");
            }
            _ => panic!("expected presets default"),
        }
        match parsed(&["contract", "schema", "video"]) {
            Command::Contract(ContractCommand::Schema { media_type }) => {
                assert_eq!(media_type, "video");
            }
            _ => panic!("expected contract schema"),
        }
        match parsed(&["clip.mov", "--contract=-"]) {
            Command::Compress(args) => {
                assert_eq!(args.options.contract_files, vec!["-"]);
            }
            _ => panic!("expected compress with --contract=-"),
        }
        match parsed(&["clip.mov", "--cpu-threads=4"]) {
            Command::Compress(args) => {
                assert_eq!(args.options.overrides.cpu_threads, Some(4));
            }
            _ => panic!("expected compress with --cpu-threads=4"),
        }
        assert!(matches!(
            parsed(&["capabilities", "--json"]),
            Command::Capabilities { json: true }
        ));
        assert!(matches!(
            parsed(&["cache", "clear"]),
            Command::Cache(CacheCommand::Clear { json: false })
        ));
        assert!(matches!(
            parsed(&["history", "--limit=15"]),
            Command::History(HistoryCommand::List {
                limit: Some(15),
                ..
            })
        ));
        assert!(matches!(
            parsed(&["queue", "pause"]),
            Command::Queue(QueueCommand::Action { ref action, .. }) if action == "pause"
        ));
        assert!(matches!(
            parsed(&["settings", "get", "cpuThreadLimit", "--json"]),
            Command::Settings(SettingsCommand::Get {
                key: Some(ref k),
                json: true,
            }) if k == "cpuThreadLimit"
        ));
        match parsed(&[
            "settings",
            "set",
            "useHardwareAcceleration=true",
            "cpuThreadLimit=4",
            "outputFileNameTemplate={name}",
        ]) {
            Command::Settings(SettingsCommand::Set { patch, json }) => {
                assert!(!json);
                assert_eq!(patch["useHardwareAcceleration"], true);
                assert_eq!(patch["cpuThreadLimit"], 4);
                assert_eq!(patch["outputFileNameTemplate"], "{name}");
            }
            _ => panic!("expected settings set"),
        }
        assert!(matches!(
            parsed(&["logs", "--path"]),
            Command::Logs {
                path_only: true,
                ..
            }
        ));
        assert!(matches!(
            parsed(&["about", "--json"]),
            Command::About { json: true }
        ));
    }
}

fn split_option(arg: &str) -> (String, Option<String>) {
    match arg.split_once('=') {
        Some((name, value)) => (name.to_string(), Some(value.to_string())),
        None => (arg.to_string(), None),
    }
}

fn require_value(name: &str, value: &Option<String>) -> Result<String, CliError> {
    value.clone().ok_or_else(|| {
        CliError::usage(format!(
            "{name} needs a value after =, for example {name}=\"<value>\"."
        ))
    })
}

fn parse_contract(args: Vec<String>) -> Result<Command, CliError> {
    let mut args = args.into_iter();
    let Some(subcommand) = args.next() else {
        return Err(CliError::usage(
            "Give a contract command: schema or validate. Run compresso --help.",
        ));
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Ok(Command::Help);
    }

    let mut json = false;
    let mut mode: Option<String> = None;
    let mut require_name = false;
    let mut positional = Vec::new();
    for arg in args {
        if !arg.starts_with('-') || arg == "-" {
            positional.push(arg);
            continue;
        }
        let (name, value) = split_option(&arg);
        match name.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            "--mode" => mode = Some(require_value(&name, &value)?),
            "--require-name" => require_name = parse_switch("require-name", value.as_deref())?,
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for contract {subcommand}: {name}"
                )));
            }
        }
    }

    match subcommand.as_str() {
        "schema" => {
            if positional.len() != 1 || mode.is_some() || require_name {
                return Err(CliError::usage(
                    "Usage: compresso contract schema <video|image|audio>",
                ));
            }
            let media_type = crate::contract::check_media_type(&positional[0])?.to_string();
            Ok(Command::Contract(ContractCommand::Schema { media_type }))
        }
        "validate" => {
            if positional.len() != 1 {
                return Err(CliError::usage(
                    "Usage: compresso contract validate <file or -> [--mode=oneShot|preset] [--json]",
                ));
            }
            if let Some(m) = &mode {
                if m != "oneShot" && m != "preset" {
                    return Err(CliError::usage("--mode must be oneShot or preset."));
                }
            }
            Ok(Command::Contract(ContractCommand::Validate {
                file: positional.into_iter().next().unwrap(),
                mode,
                require_name,
                json,
            }))
        }
        _ => Err(CliError::usage(format!(
            "Unknown contract command: {subcommand}. Use schema or validate."
        ))),
    }
}

fn parse_presets(args: Vec<String>) -> Result<Command, CliError> {
    let mut iter = args.into_iter().peekable();
    let subcommand = match iter.peek().map(String::as_str) {
        None => "list".to_string(),
        Some(first) if first.starts_with('-') => "list".to_string(),
        Some(_) => iter.next().unwrap(),
    };
    if matches!(subcommand.as_str(), "-h" | "--help" | "help") {
        return Ok(Command::Help);
    }

    let mut json = false;
    let mut media_type: Option<String> = None;
    let mut on_conflict: Option<String> = None;
    let mut replace = false;
    let mut if_revision: Option<u64> = None;
    let mut positional = Vec::new();
    for arg in iter {
        if !arg.starts_with('-') || arg == "-" {
            positional.push(arg);
            continue;
        }
        let (name, value) = split_option(&arg);
        match name.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "--json" => json = true,
            "--media-type" => {
                let raw = require_value(&name, &value)?;
                media_type = Some(crate::contract::check_media_type(&raw)?.to_string());
            }
            "--on-conflict" => {
                let raw = require_value(&name, &value)?;
                if !matches!(raw.as_str(), "error" | "rename" | "replace") {
                    return Err(CliError::usage(
                        "--on-conflict must be error, rename, or replace.",
                    ));
                }
                on_conflict = Some(raw);
            }
            "--replace" => replace = parse_switch("replace", value.as_deref())?,
            "--if-revision" => {
                let raw = require_value(&name, &value)?;
                let rev: u64 = raw
                    .parse()
                    .map_err(|_| CliError::usage("--if-revision must be a positive integer."))?;
                if_revision = Some(rev);
            }
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option for presets {subcommand}: {name}"
                )));
            }
        }
    }

    match subcommand.as_str() {
        "list" => {
            if !positional.is_empty() || on_conflict.is_some() || replace || if_revision.is_some()
            {
                return Err(CliError::usage(
                    "Usage: compresso presets [list] [--media-type=video|image|audio] [--json]",
                ));
            }
            Ok(Command::Presets(PresetsCommand::List { media_type, json }))
        }
        "get" => {
            if positional.len() != 1 || on_conflict.is_some() || replace || if_revision.is_some() {
                return Err(CliError::usage(
                    "Usage: compresso presets get <name or id> [--media-type=...]",
                ));
            }
            Ok(Command::Presets(PresetsCommand::Get {
                id_or_name: positional.into_iter().next().unwrap(),
                media_type,
            }))
        }
        "create" => {
            if positional.len() != 1 || media_type.is_some() || replace || if_revision.is_some() {
                return Err(CliError::usage(
                    "Usage: compresso presets create <file or -> [--on-conflict=error|rename|replace] [--json]",
                ));
            }
            Ok(Command::Presets(PresetsCommand::Create {
                file: positional.into_iter().next().unwrap(),
                on_conflict,
                json,
            }))
        }
        "update" => {
            if positional.len() != 2 || on_conflict.is_some() {
                return Err(CliError::usage(
                    "Usage: compresso presets update <name or id> <file or -> [--media-type=...] [--replace] [--if-revision=N] [--json]",
                ));
            }
            let mut pos = positional.into_iter();
            Ok(Command::Presets(PresetsCommand::Update {
                id_or_name: pos.next().unwrap(),
                file: pos.next().unwrap(),
                media_type,
                replace,
                if_revision,
                json,
            }))
        }
        "delete" | "remove" => {
            if positional.len() != 1 || on_conflict.is_some() || replace || if_revision.is_some() {
                return Err(CliError::usage(
                    "Usage: compresso presets delete <name or id> [--media-type=...] [--json]",
                ));
            }
            Ok(Command::Presets(PresetsCommand::Delete {
                id_or_name: positional.into_iter().next().unwrap(),
                media_type,
                json,
            }))
        }
        "default" | "set-default" => {
            if positional.len() != 1 || on_conflict.is_some() || replace || if_revision.is_some() {
                return Err(CliError::usage(
                    "Usage: compresso presets default <name or id|standard> --media-type=video|image|audio [--json]",
                ));
            }
            let Some(mt) = media_type else {
                return Err(CliError::usage(
                    "--media-type=<video|image|audio> is required for presets default.",
                ));
            };
            Ok(Command::Presets(PresetsCommand::SetDefault {
                id_or_name: positional.into_iter().next().unwrap(),
                media_type: mt,
                json,
            }))
        }
        _ => Err(CliError::usage(format!(
            "Unknown presets command: {subcommand}. Use list, get, create, update, delete, or default."
        ))),
    }
}

pub fn parse(args: Vec<String>) -> Result<Command, CliError> {
    let mut args = args.into_iter().peekable();
    match args.peek().map(String::as_str) {
        None => return Ok(Command::Help),
        Some("help") => return Ok(Command::Help),
        Some("mcp") => return Ok(Command::Mcp),
        Some("presets") => {
            args.next();
            return parse_presets(args.collect());
        }
        Some("contract") => {
            args.next();
            return parse_contract(args.collect());
        }
        Some("watch") | Some("watched-folders") => {
            args.next();
            return parse_watch(args.collect());
        }
        Some("capabilities") => {
            args.next();
            return parse_capabilities(args.collect());
        }
        Some("inspect") => {
            args.next();
            return parse_inspect(args.collect());
        }
        Some("cache") => {
            args.next();
            return parse_cache(args.collect());
        }
        Some("history") => {
            args.next();
            return parse_history(args.collect());
        }
        Some("queue") => {
            args.next();
            return parse_queue(args.collect());
        }
        Some("settings") => {
            args.next();
            return parse_settings(args.collect());
        }
        Some("logs") => {
            args.next();
            return parse_logs(args.collect());
        }
        Some("about") => {
            args.next();
            return parse_about(args.collect());
        }
        Some("compress") => {
            args.next();
        }
        _ => {}
    }

    let mut parsed = CompressArgs::default();
    let mut only_inputs = false;
    for arg in args {
        if only_inputs || !arg.starts_with('-') || arg == "-" {
            parsed
                .options
                .inputs
                .push(absolute_path(&PathBuf::from(&arg)));
            continue;
        }
        let (name, value) = match arg.split_once('=') {
            Some((name, value)) => (name.to_string(), Some(value.to_string())),
            None => (arg.clone(), None),
        };
        // The value of an option that takes one, always after `=` (`--output=<folder>`)
        let take_value = |name: &str| -> Result<String, CliError> {
            value.clone().ok_or_else(|| {
                CliError::usage(format!(
                    "{name} needs a value after =, for example {name}=\"<value>\"."
                ))
            })
        };
        let switch_name = name.trim_start_matches('-');
        let overrides = &mut parsed.options.overrides;
        match name.as_str() {
            "--" => only_inputs = true,
            "-h" | "--help" => return Ok(Command::Help),
            "-V" | "--version" => return Ok(Command::Version),
            "--json" => parsed.json = true,
            "-q" | "--quiet" => parsed.quiet = true,
            "--dry-run" => parsed.options.dry_run = true,
            "--output" => {
                let value = take_value(&name)?;
                parsed.options.output_is_folder = value.ends_with('/') || value.ends_with('\\');
                parsed.options.output = Some(absolute_path(&expand_home(&value)));
            }
            "--preset" => parsed.options.preset = Some(take_value(&name)?),
            "--video-preset" => {
                parsed.options.presets.insert("video", take_value(&name)?);
            }
            "--image-preset" => {
                parsed.options.presets.insert("image", take_value(&name)?);
            }
            "--audio-preset" => {
                parsed.options.presets.insert("audio", take_value(&name)?);
            }
            "--contract" => {
                let raw = take_value(&name)?;
                let resolved = if raw == "-" {
                    raw
                } else {
                    absolute_path(&expand_home(&raw)).display().to_string()
                };
                parsed.options.contract_files.push(resolved);
            }
            "--filename-template" => overrides.file_name_template = Some(take_value(&name)?),
            "--filename-prefix" => overrides.file_name_prefix = Some(take_value(&name)?),
            "--skip-larger-outputs" => {
                overrides.skip_larger_outputs = Some(parse_switch(switch_name, value.as_deref())?)
            }
            "--preserve-folder-structure" => {
                overrides.preserve_folder_structure =
                    Some(parse_switch(switch_name, value.as_deref())?)
            }
            "--replace-original-files" => {
                overrides.replace_original_files =
                    Some(parse_switch(switch_name, value.as_deref())?)
            }
            "--hardware-acceleration" => {
                overrides.use_hardware_acceleration =
                    Some(parse_switch(switch_name, value.as_deref())?)
            }
            "--reach-target-sizes-without-acceleration" => {
                overrides.reach_target_sizes_without_acceleration =
                    Some(parse_switch(switch_name, value.as_deref())?)
            }
            "--cpu-threads" => {
                let raw = take_value(&name)?;
                let count: usize = raw.parse().map_err(|_| {
                    CliError::usage("--cpu-threads must be a non-negative integer (0 = all cores).")
                })?;
                overrides.cpu_threads = Some(count);
            }
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option: {name}. Run compresso --help for the options."
                )))
            }
        }
    }
    Ok(Command::Compress(parsed))
}
