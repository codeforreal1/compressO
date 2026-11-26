//! `compresso`: CompressO from the command line, & an MCP server for AI agents. It has no
//! compression of its own: the CompressO app compresses the media (started in the background when
//! it is not running), with its presets, as if the media was dropped on it (see `cli_server.rs` in
//! the app).
mod app;
mod args;
mod client;
mod contract;
mod error;
mod job;
mod mcp;
mod output;
mod presets;
mod settings;
mod system;
mod watched_folders;

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
        Command::Presets(command) => presets_cmd(command).await,
        Command::Contract(command) => contract_cmd(command).await,
        Command::Watch(command) => watch(command).await,
        Command::Capabilities { json } => match system::capabilities().await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    system::print_capabilities(&value);
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
        Command::Inspect { inputs, json } => match system::inspect(inputs).await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    system::print_inspect(&value);
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
        Command::Cache(command) => cache_cmd(command).await,
        Command::History(command) => history_cmd(command).await,
        Command::Queue(command) => queue_cmd(command).await,
        Command::Logs {
            path_only,
            tail,
            json,
        } => match system::logs(if path_only { Some(0) } else { tail }).await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    system::print_logs(&value, path_only);
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
        Command::About { json } => {
            let value = system::about_info();
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&value).unwrap_or_default()
                );
            } else {
                system::print_about(&value);
            }
            exit_code::SUCCESS
        }
        Command::Mcp => mcp::serve().await,
        Command::Compress(parsed) => compress(parsed).await,
    }
}

async fn cache_cmd(command: args::CacheCommand) -> i32 {
    match command {
        args::CacheCommand::Clear { json } => match system::clear_cache().await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    println!("Cleared temporary cache.");
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
    }
}

async fn history_cmd(command: args::HistoryCommand) -> i32 {
    match command {
        args::HistoryCommand::List { limit, json } => match system::history_list(limit).await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    system::print_history(&value);
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
        args::HistoryCommand::Clear { json } => match system::history_clear().await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    println!("Cleared compression history.");
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
    }
}

async fn queue_cmd(command: args::QueueCommand) -> i32 {
    match command {
        args::QueueCommand::List { json } => match system::queue_status().await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    system::print_queue(&value);
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
        args::QueueCommand::Action { action, json } => match system::queue_action(&action).await {
            Ok(value) => {
                if json {
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                } else {
                    println!("Queue action '{action}' applied.");
                }
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, json),
        },
    }
}

/// `compresso contract ...`
async fn contract_cmd(command: args::ContractCommand) -> i32 {
    match command {
        args::ContractCommand::Schema { media_type } => match contract::schema(&media_type).await {
            Ok(schema) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&schema).unwrap_or_default()
                );
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, true),
        },
        args::ContractCommand::Validate {
            file,
            mode,
            require_name,
            json,
        } => {
            let value = match contract::read_json_input(&file) {
                Ok(v) => v,
                Err(err) => return report_error(&err, json),
            };
            match contract::validate_value(value, mode.as_deref(), require_name).await {
                Ok(result) => {
                    let mut out = result;
                    if let Some(obj) = out.as_object_mut() {
                        obj.remove("type");
                        obj.remove("ok");
                        obj.insert("valid".to_string(), serde_json::json!(true));
                    }
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&out).unwrap_or_default()
                    );
                    exit_code::SUCCESS
                }
                Err(err) => report_error(&err, json),
            }
        }
    }
}

/// `compresso presets ...`
async fn presets_cmd(command: args::PresetsCommand) -> i32 {
    match command {
        args::PresetsCommand::List { media_type, json } => list_presets(media_type, json).await,
        args::PresetsCommand::Get {
            id_or_name,
            media_type,
        } => match presets::get(&id_or_name, media_type.as_deref()).await {
            Ok(value) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&value["preset"]["contract"]).unwrap_or_default()
                );
                exit_code::SUCCESS
            }
            Err(err) => report_error(&err, false),
        },
        args::PresetsCommand::Create {
            file,
            on_conflict,
            json,
        } => match presets::create_from_file(&file, on_conflict.as_deref()).await {
            Ok(value) => print_preset_result(value, json, "create"),
            Err(err) => report_error(&err, json),
        },
        args::PresetsCommand::Update {
            id_or_name,
            file,
            media_type,
            replace,
            if_revision,
            json,
        } => match presets::update_from_file(
            &id_or_name,
            &file,
            media_type.as_deref(),
            replace,
            if_revision,
        )
        .await
        {
            Ok(value) => print_preset_result(value, json, "update"),
            Err(err) => report_error(&err, json),
        },
        args::PresetsCommand::Delete {
            id_or_name,
            media_type,
            json,
        } => match presets::delete(&id_or_name, media_type.as_deref()).await {
            Ok(value) => print_preset_result(value, json, "delete"),
            Err(err) => report_error(&err, json),
        },
        args::PresetsCommand::SetDefault {
            id_or_name,
            media_type,
            json,
        } => match presets::set_default(&id_or_name, &media_type).await {
            Ok(value) => print_preset_result(value, json, "default"),
            Err(err) => report_error(&err, json),
        },
    }
}

fn print_preset_result(value: serde_json::Value, json: bool, action: &str) -> i32 {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
        );
    } else {
        output::print_preset_change(&value, action);
    }
    exit_code::SUCCESS
}

/// `compresso presets [list]`: from the settings the app wrote, without starting it (started only
/// when it never ran)
async fn list_presets(media_type: Option<String>, json: bool) -> i32 {
    if let Some(mt) = &media_type {
        if let Err(err) = contract::check_media_type(mt) {
            return report_error(&err, json);
        }
    }
    let settings = match settings::Settings::from_file() {
        Some(settings) => Ok(settings),
        None => fetch_settings().await,
    };
    match settings {
        Ok(settings) if json => {
            let presets: Vec<_> = settings
                .presets
                .iter()
                .filter(|p| media_type.as_deref().is_none_or(|mt| p.media_type == mt))
                .collect();
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({ "presets": presets }))
                    .unwrap_or_default()
            );
            exit_code::SUCCESS
        }
        Ok(settings) => {
            output::print_presets(&settings, media_type.as_deref());
            exit_code::SUCCESS
        }
        Err(err) => report_error(&err, json),
    }
}

/// `compresso watch ...`
async fn watch(command: args::WatchCommand) -> i32 {
    match command {
        args::WatchCommand::List { json } => match watched_folders::list().await {
            Ok(value) => print_watch_result(value, json, None),
            Err(err) => report_error(&err, json),
        },
        args::WatchCommand::Add(change) => {
            let args::WatchFolderChange {
                folder,
                is_enabled,
                presets,
                json,
            } = change;
            let (_, path) = folder.into_id_path();
            let presets = (!presets.is_empty()).then_some(presets);
            match watched_folders::add(path.unwrap_or_default(), is_enabled, presets).await {
                Ok(value) => print_watch_result(value, json, Some("add")),
                Err(err) => report_error(&err, json),
            }
        }
        args::WatchCommand::Update(change) => {
            let args::WatchFolderChange {
                folder,
                is_enabled,
                presets,
                json,
            } = change;
            let (id, path) = folder.into_id_path();
            let presets = (!presets.is_empty()).then_some(presets);
            match watched_folders::update(id, path, is_enabled, presets).await {
                Ok(value) => print_watch_result(value, json, Some("update")),
                Err(err) => report_error(&err, json),
            }
        }
        args::WatchCommand::Remove { folder, json } => {
            let (id, path) = folder.into_id_path();
            match watched_folders::remove(id, path).await {
                Ok(value) => print_watch_result(value, json, Some("remove")),
                Err(err) => report_error(&err, json),
            }
        }
    }
}

fn print_watch_result(value: serde_json::Value, json: bool, action: Option<&str>) -> i32 {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(&value).unwrap_or_default()
        );
    } else if let Some(action) = action {
        output::print_watch_change(&value, action);
    } else {
        output::print_watched_folders(&value);
    }
    exit_code::SUCCESS
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
