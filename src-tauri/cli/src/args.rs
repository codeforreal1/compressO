//! The command line's arguments
use std::path::PathBuf;

use crate::error::CliError;
use crate::job::{absolute_path, CompressOptions};
use crate::watched_folders::PresetChanges;

pub const HELP: &str = r#"The CompressO CLI: compresses videos, images and audio with the presets of the
CompressO app, as if they were dropped on the app.

Usage:
  compresso [compress] <file or folder>... [options]
  compresso presets [--json]
  compresso watch list [--json]
  compresso watch add <folder> [watch options]
  compresso watch update <id or folder> [watch options]
  compresso watch remove <id or folder> [--json]
  compresso mcp
  compresso --help | --version

Commands:
  compress      Compress files and folders (the default; folders are read as when dropped)
  presets       List the presets of the app, the default ones marked with *
  watch         Manage the folders whose new media is compressed (Settings > Watch Folder)
  mcp           Run an MCP server on stdin/stdout, for AI agents

Every option with a value is written with =, e.g. --video-preset="Standard". Quote values
with spaces.

Presets (a media type without its option uses its default preset in the app):
  --video-preset=<name>    Preset for videos, by name or id
  --image-preset=<name>    Preset for images
  --audio-preset=<name>    Preset for audio files
  --preset=<name>          For a single file: its preset, whatever its media type

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
  compresso watch list
  compresso watch add ~/Downloads/photos --video-preset="2 clips"
  compresso watch update <id> --enabled=0
  compresso watch remove ~/Downloads/photos
"#;

pub enum Command {
    Help,
    Version,
    Presets { json: bool },
    Watch(WatchCommand),
    Mcp,
    Compress(CompressArgs),
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
}

pub fn parse(args: Vec<String>) -> Result<Command, CliError> {
    let mut args = args.into_iter().peekable();
    match args.peek().map(String::as_str) {
        None => return Ok(Command::Help),
        Some("help") => return Ok(Command::Help),
        Some("mcp") => return Ok(Command::Mcp),
        Some("presets") => {
            args.next();
            let mut json = false;
            for arg in args {
                match arg.as_str() {
                    "--json" => json = true,
                    _ => {
                        return Err(CliError::usage(format!(
                            "Unknown option for presets: {arg}"
                        )))
                    }
                }
            }
            return Ok(Command::Presets { json });
        }
        Some("watch") | Some("watched-folders") => {
            args.next();
            return parse_watch(args.collect());
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
            _ => {
                return Err(CliError::usage(format!(
                    "Unknown option: {name}. Run compresso --help for the options."
                )))
            }
        }
    }
    Ok(Command::Compress(parsed))
}
