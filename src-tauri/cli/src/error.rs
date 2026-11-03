//! Errors that stop the command line, with their exit codes
use std::fmt;

/// Exit codes (see `compresso --help`)
pub mod exit_code {
    /// Every file was compressed (saved, or not saved by the "skip larger outputs" setting)
    pub const SUCCESS: i32 = 0;
    /// One or more files could not be compressed or saved
    pub const FAILED: i32 = 1;
    /// A wrong option, a missing input, an unknown preset, or no supported media
    pub const USAGE: i32 = 2;
    /// A preset asks where to save each time, & no `--output` folder was given
    pub const NEEDS_OUTPUT: i32 = 3;
    /// The app could not be started or reached, or its compression tools are not ready
    pub const APP: i32 = 4;
    /// Stopped with Ctrl+C
    pub const INTERRUPTED: i32 = 130;
}

#[derive(Debug, Clone)]
pub struct CliError {
    pub exit_code: i32,
    /// For `--json` & the MCP server, e.g. `unknownPreset`
    pub code: &'static str,
    pub message: String,
}

impl CliError {
    pub fn new(exit_code: i32, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            exit_code,
            code,
            message: message.into(),
        }
    }

    pub fn usage(message: impl Into<String>) -> Self {
        Self::new(exit_code::USAGE, "usage", message)
    }

    pub fn app(message: impl Into<String>) -> Self {
        Self::new(exit_code::APP, "appUnavailable", message)
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "status": "error",
            "code": self.code,
            "message": self.message,
        })
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}
