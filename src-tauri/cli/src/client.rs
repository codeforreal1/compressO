//! A connection to the app: one JSON message per line (see `cli_server.rs` in the app)
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines, ReadHalf, WriteHalf};

use crate::app::{self, Stream};
use crate::error::CliError;

/// The messages this command line speaks (the app's `PROTOCOL_VERSION`)
const PROTOCOL_VERSION: u64 = 3;

static IS_MCP: AtomicBool = AtomicBool::new(false);

pub fn set_mcp_mode() {
    IS_MCP.store(true, Ordering::SeqCst);
}

fn client_name() -> &'static str {
    if IS_MCP.load(Ordering::SeqCst) {
        "mcp"
    } else {
        "cli"
    }
}

/// Forwards a diagnostic log line to the running app's log file without starting the app if closed
pub async fn log_if_running(level: &str, message: &str) {
    let Some(mut stream) = app::connect().await else {
        return;
    };
    let hello = json!({ "type": "hello", "client": client_name() }).to_string();
    let entry = json!({ "type": "log", "level": level, "message": message }).to_string();
    let payload = format!("{hello}\n{entry}\n");
    let _ = stream.write_all(payload.as_bytes()).await;
    let _ = stream.flush().await;
}

/// What happens while the app is reached, to tell the user
pub enum StartupStatus {
    /// The app is preparing its compression tools (the first time after an install or update)
    PreparingTools,
}

pub struct Connection {
    reader: Lines<BufReader<ReadHalf<Stream>>>,
    writer: WriteHalf<Stream>,
}

impl Connection {
    /// Connects to the app (started first when it is not running) & waits until it is ready
    pub async fn open(on_status: impl FnMut(StartupStatus)) -> Result<Self, CliError> {
        let stream = app::connect_or_start().await?;
        let (reader, writer) = tokio::io::split(stream);
        let mut connection = Self {
            reader: BufReader::new(reader).lines(),
            writer,
        };
        connection.wait_until_ready(on_status).await?;
        Ok(connection)
    }

    async fn wait_until_ready(
        &mut self,
        mut on_status: impl FnMut(StartupStatus),
    ) -> Result<(), CliError> {
        let started = Instant::now();
        let mut is_preparing = false;
        let mut ready_since: Option<Instant> = None;
        loop {
            let hello = self
                .request(json!({ "type": "hello", "client": client_name() }))
                .await?;
            if hello["protocol"].as_u64() != Some(PROTOCOL_VERSION) {
                return Err(CliError::app(
                    "The running CompressO app is a different version. Quit CompressO, then try again.",
                ));
            }
            let tools = &hello["tools"];
            if let Some(error) = tools["error"].as_str() {
                return Err(CliError::new(
                    crate::error::exit_code::APP,
                    "toolsNotReady",
                    format!("CompressO could not prepare its compression tools: {error}"),
                ));
            }
            if tools["ready"].as_bool() != Some(true) {
                // Checking the tools takes a moment at each start; only a first-time setup is told
                if !is_preparing && started.elapsed() > Duration::from_secs(2) {
                    is_preparing = true;
                    on_status(StartupStatus::PreparingTools);
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            if hello["settingsReady"].as_bool() == Some(true) {
                return Ok(());
            }
            // The app's window is still loading its settings
            let since = *ready_since.get_or_insert_with(Instant::now);
            if since.elapsed() > Duration::from_secs(60) {
                return Err(CliError::app(
                    "CompressO did not finish starting. Open CompressO once, then try again.",
                ));
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    }

    pub async fn send(&mut self, message: Value) -> Result<(), CliError> {
        let mut line = message.to_string();
        line.push('\n');
        self.writer
            .write_all(line.as_bytes())
            .await
            .map_err(|_| connection_lost())?;
        self.writer.flush().await.map_err(|_| connection_lost())
    }

    /// The next message from the app
    pub async fn recv(&mut self) -> Result<Value, CliError> {
        let line = self
            .reader
            .next_line()
            .await
            .map_err(|_| connection_lost())?
            .ok_or_else(connection_lost)?;
        serde_json::from_str(&line).map_err(|_| CliError::app("CompressO sent an invalid message."))
    }

    /// Sends a message & returns the answer (an error message from the app is returned as such)
    pub async fn request(&mut self, message: Value) -> Result<Value, CliError> {
        self.send(message).await?;
        let answer = self.recv().await?;
        if answer["type"] == "error" {
            return Err(app_error(&answer));
        }
        Ok(answer)
    }
}

fn connection_lost() -> CliError {
    CliError::app("The connection to CompressO was lost (the app may have quit).")
}

/// An error message from the app, as an error of the command line
pub fn app_error(message: &Value) -> CliError {
    let text = message["message"]
        .as_str()
        .unwrap_or("CompressO could not do this.")
        .to_string();
    match message["code"].as_str() {
        Some("noMedia") => CliError::new(crate::error::exit_code::USAGE, "noMedia", text),
        Some("outputFolder") => CliError::new(crate::error::exit_code::USAGE, "outputFolder", text),
        Some("unknownPreset") => {
            CliError::new(crate::error::exit_code::USAGE, "unknownPreset", text)
        }
        Some("ambiguousPreset") => {
            CliError::new(crate::error::exit_code::USAGE, "ambiguousPreset", text)
        }
        Some("presetExists") => {
            CliError::new(crate::error::exit_code::USAGE, "presetExists", text)
        }
        Some("standardPresetReadOnly") => CliError::new(
            crate::error::exit_code::USAGE,
            "standardPresetReadOnly",
            text,
        ),
        Some("mediaTypeMismatch") => {
            CliError::new(crate::error::exit_code::USAGE, "mediaTypeMismatch", text)
        }
        Some("revisionConflict") => {
            CliError::new(crate::error::exit_code::USAGE, "revisionConflict", text)
        }
        Some("invalidContract") => {
            CliError::new(crate::error::exit_code::USAGE, "invalidContract", text)
        }
        Some("missingInput") => {
            CliError::new(crate::error::exit_code::USAGE, "missingInput", text)
        }
        Some("unknownWatchedFolder") => {
            CliError::new(crate::error::exit_code::USAGE, "unknownWatchedFolder", text)
        }
        Some("missingFolder") => {
            CliError::new(crate::error::exit_code::USAGE, "missingFolder", text)
        }
        Some("rootFolder") => CliError::new(crate::error::exit_code::USAGE, "rootFolder", text),
        Some("invalidRequest") => {
            CliError::new(crate::error::exit_code::USAGE, "invalidRequest", text)
        }
        Some("accessDenied") => CliError::new(crate::error::exit_code::APP, "accessDenied", text),
        Some("notReady") => CliError::new(crate::error::exit_code::APP, "notReady", text),
        _ => CliError::app(text),
    }
}
