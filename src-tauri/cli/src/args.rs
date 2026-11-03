//! The command line's arguments
use std::path::PathBuf;

use crate::error::CliError;
use crate::job::{absolute_path, CompressOptions};

pub const HELP: &str = r#"The CompressO CLI: compresses videos, images and audio with the presets of the
CompressO app, as if they were dropped on the app.

Usage:
  compresso [compress] <file or folder>... [options]
  compresso presets [--json]
  compresso mcp
  compresso --help | --version

Commands:
  compress      Compress files and folders (the default; folders are read as when dropped)
  presets       List the presets of the app, the default ones marked with *
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
  --filename-prefix=<text>           (--filename-prefix= keeps the original names)
  --hardware-acceleration=0|1
  --reach-target-sizes-without-acceleration=0|1

Other options:
  --json         Print one JSON document with the results, and no progress
  -q, --quiet    Print only errors
  --dry-run      List the files, their presets and where they would be saved, without
                 compressing them

Exit codes:
  0    Every file was compressed (saved, or not saved as it was larger than the original)
  1    One or more files could not be compressed or saved, or were cancelled
  2    Wrong options, missing inputs, an unknown preset, or no supported media
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
"#;

pub enum Command {
    Help,
    Version,
    Presets { json: bool },
    Mcp,
    Compress(CompressArgs),
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
