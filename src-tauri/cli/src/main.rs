//! `compresso`: CompressO from the command line, & an MCP server for AI agents. It has no
//! compression of its own: the CompressO app compresses the media (started in the background when
//! it is not running), with its presets, as if the media was dropped on it (see `cli_server.rs` in
//! the app).
mod app;
mod args;
mod client;
mod error;
mod job;
mod mcp;
mod output;
mod settings;

use args::Command;
use error::{exit_code, CliError};

const VERSION: &str = env!("COMPRESSO_VERSION");

fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Failed to start the async runtime");
    let code = runtime.block_on(run());
    std::process::exit(code);
}

async fn run() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match args::parse(args) {
        Ok(command) => command,
        Err(err) => {
            eprintln!("compresso: {err}");
            return err.exit_code;
        }
    };
    match command {
        Command::Help => {
            print!("{}", args::HELP);
            exit_code::SUCCESS
        }
        Command::Version => {
            println!("compresso {VERSION}");
            exit_code::SUCCESS
        }
        Command::Presets { json } => list_presets(json).await,
        Command::Mcp => mcp::serve().await,
        Command::Compress(parsed) => compress(parsed).await,
    }
}

/// `compresso presets`: from the settings the app wrote, without starting it (started only when
/// it never ran)
async fn list_presets(json: bool) -> i32 {
    let settings = match settings::Settings::from_file() {
        Some(settings) => Ok(settings),
        None => fetch_settings().await,
    };
    match settings {
        Ok(settings) if json => {
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({ "presets": settings.presets }))
                    .unwrap_or_default()
            );
            exit_code::SUCCESS
        }
        Ok(settings) => {
            output::print_presets(&settings);
            exit_code::SUCCESS
        }
        Err(err) => report_error(&err, json),
    }
}

/// The settings, from the app (started first when it is not running)
pub async fn fetch_settings() -> Result<settings::Settings, CliError> {
    let mut connection = client::Connection::open(|_| {}).await?;
    let answer = connection
        .request(serde_json::json!({ "type": "getSettings" }))
        .await?;
    serde_json::from_value(answer["settings"].clone())
        .map_err(|_| CliError::app("CompressO sent settings this command line cannot read."))
}

fn report_error(err: &CliError, json: bool) -> i32 {
    if json {
        println!("{}", err.to_json());
    } else {
        eprintln!("compresso: {err}");
    }
    err.exit_code
}

async fn compress(parsed: args::CompressArgs) -> i32 {
    // Ctrl+C cancels the media not compressed yet
    let (cancel_sender, cancel) = tokio::sync::watch::channel(false);
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            let _ = cancel_sender.send(true);
            // A second Ctrl+C quits at once
            if tokio::signal::ctrl_c().await.is_ok() {
                std::process::exit(exit_code::INTERRUPTED);
            }
        }
    });

    let mut human = (!parsed.json).then(|| output::HumanOutput::new(parsed.quiet));
    let result = job::run(
        &parsed.options,
        |event| {
            if let Some(human) = human.as_mut() {
                human.on_event(event);
            }
        },
        cancel,
    )
    .await;
    match result {
        Ok(report) => {
            if let Some(human) = human.as_mut() {
                human.finish(&report);
            } else {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&report.to_json()).unwrap_or_default()
                );
            }
            report.exit_code()
        }
        Err(err) => report_error(&err, parsed.json),
    }
}
