//! The link between the command line tool (`compresso`, see `src-tauri/cli`) & the app. The command
//! line has no compression of its own: it asks the running app (started in the background when it
//! is not running) to compress its media through the drop zone's queue, with the presets & output
//! settings it chose, & is sent the progress & the results. So media compressed from the command line
//! comes out exactly as when it is dropped on the app, & shows in the queue & the history.
//!
//! It is reached through a local socket only the user can open (a Unix socket in the app's data
//! folder, or a named pipe on Windows), one JSON message per line. Requests:
//! - `{"type":"hello"}`: the app's version & whether it is ready (its tools & settings)
//! - `{"type":"getSettings"}`: the settings of `cli_settings`
//! - `{"type":"expand","inputs":[..]}`: the media of files & folders, without compressing them
//! - `{"type":"compress","inputs":[..],"job":{..}}`: compresses them (see `CliJob`), answered with
//!   `accepted`, then `progress` & `file` for each media, & `done`
//! - `{"type":"cancel"}`: cancels the compression of this connection
//!
//! Closing the connection cancels its media not compressed yet. An app started by the command line
//! quits once it is done, unless the user opened its window or dropped media meanwhile.
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::core::domain::CollectedFile;
use crate::tauri_commands::drop_queue::{self, CliJob, DropQueueItem, DropQueueItemStatus};

/// Passed by the command line when it starts the app: no window is shown (nor the Dock icon), &
/// the app quits once the command line is done
pub const BACKGROUND_ARG: &str = "--background";

/// Version of the messages, raised when they change in a way older command lines cannot follow
const PROTOCOL_VERSION: u32 = 1;

/// Started by the command line, & not used by the user since: quits once the command line is done
static IS_LAUNCHED_FOR_CLI: AtomicBool = AtomicBool::new(false);
static CONNECTIONS: AtomicUsize = AtomicUsize::new(0);

/// Whether the app was started by the command line (see `BACKGROUND_ARG`)
pub fn is_background_launch() -> bool {
    std::env::args().any(|arg| arg == BACKGROUND_ARG)
}

/// Whether the app was started by the command line, so its first main window stays hidden: true
/// once, so a main window opened later (e.g. from the menu bar) is shown
#[tauri::command]
pub fn take_background_launch() -> bool {
    static IS_TAKEN: AtomicBool = AtomicBool::new(false);
    !IS_TAKEN.swap(true, Ordering::SeqCst) && is_background_launch()
}

/// The user opened the app's window or dropped media: an app started by the command line now
/// stays open
pub fn keep_app_open() {
    IS_LAUNCHED_FOR_CLI.store(false, Ordering::SeqCst);
}

/// Starts listening for the command line
pub fn start(app_handle: &AppHandle) {
    if is_background_launch() {
        IS_LAUNCHED_FOR_CLI.store(true, Ordering::SeqCst);
        // Quits if the command line that started it never connects (e.g. it was stopped)
        schedule_quit_check(app_handle, std::time::Duration::from_secs(60));
    }
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = listen(app_handle).await {
            log::error!("[cli] Could not listen for the command line: {}", err);
        }
    });
}

/// Where the command line reaches the app: a socket in the app's data folder (in the temporary
/// folder when that path is too long for a socket), as `compresso` finds it
#[cfg(unix)]
fn socket_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let directory = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    let path = directory.join("cli.sock");
    // Socket paths are limited to about 104 bytes
    if path.as_os_str().len() < 100 {
        return Ok(path);
    }
    // SAFETY: `getuid` has no preconditions
    let uid = unsafe { libc::getuid() };
    Ok(PathBuf::from(format!("/tmp/compresso-{uid}.sock")))
}

#[cfg(unix)]
async fn listen(app_handle: AppHandle) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::{UnixListener, UnixStream};

    let path = socket_path(&app_handle)?;
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(|err| err.to_string())?;
    }
    if path.exists() {
        // Left by an app that did not quit normally (only one app runs at a time)
        if UnixStream::connect(&path).await.is_ok() {
            return Err(String::from("another app is listening"));
        }
        let _ = std::fs::remove_file(&path);
    }
    let listener = UnixListener::bind(&path).map_err(|err| err.to_string())?;
    // Only the user can reach it
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
        .map_err(|err| err.to_string())?;
    log::info!("[cli] Listening for the command line at {}", path.display());
    loop {
        let (stream, _) = listener.accept().await.map_err(|err| err.to_string())?;
        tauri::async_runtime::spawn(handle_connection(app_handle.clone(), stream));
    }
}

/// The named pipe of the user, as `compresso` finds it
#[cfg(windows)]
fn pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_default();
    format!(r"\\.\pipe\com.compresso.app-{user}")
}

#[cfg(windows)]
async fn listen(app_handle: AppHandle) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let name = pipe_name();
    // Only from this computer, & only one app at a time
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&name)
        .map_err(|err| err.to_string())?;
    log::info!("[cli] Listening for the command line at {}", name);
    loop {
        server.connect().await.map_err(|err| err.to_string())?;
        let connected = server;
        server = ServerOptions::new()
            .reject_remote_clients(true)
            .create(&name)
            .map_err(|err| err.to_string())?;
        tauri::async_runtime::spawn(handle_connection(app_handle.clone(), connected));
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Request {
    Hello,
    GetSettings,
    Expand {
        inputs: Vec<String>,
    },
    Compress {
        inputs: Vec<String>,
        #[serde(default)]
        job: CliJob,
    },
    Cancel,
}

type Writer<S> = Arc<tokio::sync::Mutex<tokio::io::WriteHalf<S>>>;

/// Sends a message (a line of JSON); fails once the command line is gone
async fn send<S: AsyncWrite>(writer: &Writer<S>, message: serde_json::Value) -> Result<(), ()> {
    let mut line = message.to_string();
    line.push('\n');
    let mut writer = writer.lock().await;
    writer.write_all(line.as_bytes()).await.map_err(|_| ())?;
    writer.flush().await.map_err(|_| ())
}

/// Counts the connections; an app started by the command line may quit once the last one closes
struct ConnectionGuard(AppHandle);

impl ConnectionGuard {
    fn new(app_handle: &AppHandle) -> Self {
        CONNECTIONS.fetch_add(1, Ordering::SeqCst);
        Self(app_handle.clone())
    }
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        CONNECTIONS.fetch_sub(1, Ordering::SeqCst);
        schedule_quit_check(&self.0, std::time::Duration::from_secs(2));
    }
}

async fn handle_connection<S>(app_handle: AppHandle, stream: S)
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    let _guard = ConnectionGuard::new(&app_handle);
    let (reader, writer) = tokio::io::split(stream);
    let writer: Writer<S> = Arc::new(tokio::sync::Mutex::new(writer));
    let mut lines = BufReader::new(reader).lines();
    // The compression of this connection, cancelled if it closes first
    let mut job: Option<(String, tokio::task::JoinHandle<()>)> = None;

    while let Ok(Some(line)) = lines.next_line().await {
        let request = match serde_json::from_str::<Request>(&line) {
            Ok(request) => request,
            Err(err) => {
                let message = format!("Invalid request: {}", err);
                let _ = send(&writer, error_message("invalidRequest", &message)).await;
                continue;
            }
        };
        let result = match request {
            Request::Hello => send(&writer, hello_message(&app_handle)).await,
            Request::GetSettings => match crate::sys::cli_settings::get() {
                Some(settings) => {
                    send(&writer, json!({ "type": "settings", "settings": settings })).await
                }
                None => {
                    let message = "The app is still starting. Try again in a moment.";
                    send(&writer, error_message("notReady", message)).await
                }
            },
            Request::Expand { inputs } => {
                let expanded = expand(&app_handle, &inputs);
                send(&writer, expanded.to_message()).await
            }
            Request::Compress {
                inputs,
                job: options,
            } => {
                if job.is_some() {
                    let message = "A compression is already running on this connection.";
                    send(&writer, error_message("invalidRequest", message)).await
                } else {
                    match start_job(&app_handle, &writer, &inputs, options).await {
                        Some(started) => {
                            job = Some(started);
                            Ok(())
                        }
                        None => Ok(()),
                    }
                }
            }
            Request::Cancel => {
                if let Some((job_id, _)) = &job {
                    drop_queue::cancel_cli_job(&app_handle, job_id);
                }
                Ok(())
            }
        };
        if result.is_err() {
            break;
        }
    }

    // Closed before its media was compressed (e.g. Ctrl+C): the rest is not compressed
    if let Some((job_id, task)) = job {
        if !task.is_finished() {
            task.abort();
            log::info!("[cli] The command line left, cancelling its compression");
            drop_queue::cancel_cli_job(&app_handle, &job_id);
        }
    }
}

fn error_message(code: &str, message: &str) -> serde_json::Value {
    json!({ "type": "error", "code": code, "message": message })
}

fn hello_message(app_handle: &AppHandle) -> serde_json::Value {
    let tools = crate::core::tool_bundle::get_tool_status(app_handle.clone());
    json!({
        "type": "hello",
        "protocol": PROTOCOL_VERSION,
        "version": app_handle.package_info().version.to_string(),
        "settingsReady": crate::sys::cli_settings::get().is_some(),
        "tools": tools,
    })
}

/// The media of the files & folders given to the command line
struct Expanded {
    files: Vec<(CollectedFile, &'static str)>,
    /// Files whose format is not supported (in the folders, or given directly)
    unsupported: Vec<String>,
    /// Paths that could not be read, with why
    unreadable: Vec<(String, String)>,
}

impl Expanded {
    fn to_message(&self) -> serde_json::Value {
        json!({
            "type": "files",
            "files": self.files.iter().map(|(file, media_type)| json!({
                "path": file.path,
                "relativeDir": file.relative_dir,
                "mediaType": media_type,
            })).collect::<Vec<_>>(),
            "unsupported": self.unsupported,
            "unreadable": self.unreadable.iter().map(|(path, error)| json!({
                "path": path,
                "error": error,
            })).collect::<Vec<_>>(),
        })
    }
}

/// Folders are read like when they are dropped (see `collect_files`)
fn expand(app_handle: &AppHandle, inputs: &[String]) -> Expanded {
    let mut expanded = Expanded {
        files: Vec::new(),
        unsupported: Vec::new(),
        unreadable: Vec::new(),
    };
    for input in inputs {
        match crate::tauri_commands::fs::allow_asset_scopes(app_handle, vec![input.clone()]) {
            Ok(files) => {
                for file in files {
                    match crate::sys::cli_settings::media_type(&file.path) {
                        Some(media_type) => expanded.files.push((file, media_type)),
                        None => expanded.unsupported.push(file.path),
                    }
                }
            }
            Err(err) => expanded.unreadable.push((input.clone(), err)),
        }
    }
    expanded
}

/// Adds the media to the queue & follows it, sending its progress & results. `None` when nothing is
/// compressed (an error was sent).
async fn start_job<S>(
    app_handle: &AppHandle,
    writer: &Writer<S>,
    inputs: &[String],
    mut options: CliJob,
) -> Option<(String, tokio::task::JoinHandle<()>)>
where
    S: AsyncWrite + Send + 'static,
{
    if crate::sys::cli_settings::get().is_none() {
        let message = "The app is still starting. Try again in a moment.";
        let _ = send(writer, error_message("notReady", message)).await;
        return None;
    }
    if let Some(folder) = &options.output_folder {
        // Created if missing, & allowed for saving (see `move_file`)
        if let Err(err) = std::fs::create_dir_all(folder) {
            let message = format!("Could not create the output folder {}: {}", folder, err);
            let _ = send(writer, error_message("outputFolder", &message)).await;
            return None;
        }
        allow_output_folder(app_handle, folder);
    }

    let expanded = expand(app_handle, inputs);
    if expanded.files.is_empty() {
        let message = "No supported media was found in the given files and folders.";
        let mut message = error_message("noMedia", message);
        message["files"] = expanded.to_message();
        let _ = send(writer, message).await;
        return None;
    }

    let job_id = nanoid::nanoid!();
    options.job_id = job_id.clone();
    // Listening before the media is added, so no change is missed
    let receiver = drop_queue::subscribe();
    let media_types: HashMap<String, &'static str> = expanded
        .files
        .iter()
        .map(|(file, media_type)| (file.path.clone(), *media_type))
        .collect();
    let files = expanded
        .files
        .iter()
        .map(|(file, _)| file.clone())
        .collect();
    let items = drop_queue::add_files_to_queue(app_handle, files, None, Some(options));
    log::info!(
        "[cli] Compressing {} media from the command line",
        items.len()
    );

    let accepted = json!({
        "type": "accepted",
        "jobId": job_id,
        "files": items.iter().map(|item| json!({
            "id": item.id,
            "path": item.path,
            "relativeDir": item.relative_dir,
            "mediaType": media_types.get(&item.path).copied().unwrap_or("video"),
        })).collect::<Vec<_>>(),
        "unsupported": expanded.unsupported,
        "unreadable": expanded.unreadable.iter().map(|(path, error)| json!({
            "path": path,
            "error": error,
        })).collect::<Vec<_>>(),
    });
    if send(writer, accepted).await.is_err() {
        drop_queue::cancel_cli_job(app_handle, &job_id);
        return None;
    }

    let ids: Vec<String> = items.iter().map(|item| item.id.clone()).collect();
    // On the app's runtime (Tauri's is the same, see `main`), which this runs on
    let task = tokio::spawn(follow_job(
        app_handle.clone(),
        writer.clone(),
        ids,
        receiver,
    ));
    Some((job_id, task))
}

/// Lets the app save to a folder chosen on the command line
fn allow_output_folder(app_handle: &AppHandle, folder: &str) {
    use tauri_plugin_fs::FsExt;
    let _ = app_handle.fs_scope().allow_directory(folder, true);
}

/// Sends the progress & the result of each media of a job, then `done`
async fn follow_job<S>(
    app_handle: AppHandle,
    writer: Writer<S>,
    ids: Vec<String>,
    mut receiver: tokio::sync::broadcast::Receiver<Vec<DropQueueItem>>,
) where
    S: AsyncWrite + Send + 'static,
{
    let mut progress: HashMap<String, i64> = HashMap::new();
    let mut finished: HashSet<String> = HashSet::new();
    let mut is_paused = false;
    // The queue as it is now, then each change
    let mut items = Some(drop_queue::get_drop_queue(app_handle.clone()));
    loop {
        let queue = match items.take() {
            Some(queue) => queue,
            None => match receiver.recv().await {
                Ok(queue) => queue,
                // Too many changes at once: the queue as it is now
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    drop_queue::get_drop_queue(app_handle.clone())
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
        };

        let paused = drop_queue::is_drop_queue_paused();
        if paused != is_paused {
            is_paused = paused;
            if send(&writer, json!({ "type": "paused", "paused": paused }))
                .await
                .is_err()
            {
                return;
            }
        }

        for id in &ids {
            if finished.contains(id) {
                continue;
            }
            let message = match queue.iter().find(|item| &item.id == id) {
                // Removed from the queue by the user before it was compressed
                None => {
                    finished.insert(id.clone());
                    json!({ "type": "file", "item": { "id": id, "status": "cancelled" } })
                }
                Some(item) => match item.status {
                    DropQueueItemStatus::Waiting => continue,
                    DropQueueItemStatus::Compressing => {
                        let percent = item.progress.floor() as i64;
                        if progress.insert(id.clone(), percent) == Some(percent) {
                            continue;
                        }
                        json!({ "type": "progress", "id": id, "progress": percent })
                    }
                    DropQueueItemStatus::Done
                    | DropQueueItemStatus::Failed
                    | DropQueueItemStatus::Cancelled => {
                        finished.insert(id.clone());
                        json!({ "type": "file", "item": item })
                    }
                },
            };
            if send(&writer, message).await.is_err() {
                return;
            }
        }

        if finished.len() == ids.len() {
            let _ = send(&writer, json!({ "type": "done" })).await;
            return;
        }
    }
}

/// Quits an app started by the command line once nothing is left for it to do: no command line
/// connected, nothing compressing or waiting, & no window opened by the user
pub fn schedule_quit_check(app_handle: &AppHandle, delay: std::time::Duration) {
    if !IS_LAUNCHED_FOR_CLI.load(Ordering::SeqCst) {
        return;
    }
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        // Another command may connect right after (e.g. in a script)
        tokio::time::sleep(delay).await;
        if should_quit(&app_handle) {
            log::info!("[cli] The command line is done, quitting the app it started");
            app_handle.exit(0);
        }
    });
}

fn should_quit(app_handle: &AppHandle) -> bool {
    let is_main_window_visible = app_handle
        .get_webview_window("main")
        .is_some_and(|window| window.is_visible().unwrap_or(false));
    IS_LAUNCHED_FOR_CLI.load(Ordering::SeqCst)
        && CONNECTIONS.load(Ordering::SeqCst) == 0
        && !drop_queue::is_queue_active(app_handle)
        && !crate::tauri_commands::compression_status::is_compressing(app_handle)
        && !is_main_window_visible
}
