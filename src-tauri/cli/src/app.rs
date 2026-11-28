//! Finding the CompressO app, reaching it (see `cli_server.rs` in the app) & starting it in the
//! background when it is not running.
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::error::CliError;

/// The app's identifier (`tauri.conf.json`), the name of its data folder
const IDENTIFIER: &str = "com.compresso.app";

/// Passed to the app when it is started from here: no window, & it quits once done
const BACKGROUND_ARG: &str = "--background";

/// The app's data folder, as the app has it (Tauri's `app_data_dir`).
/// Overridable via `COMPRESSO_DATA_DIR` for isolated dev/CI testing against `com.compresso.dev`.
pub fn data_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("COMPRESSO_DATA_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join("Library/Application Support")
                .join(IDENTIFIER),
        )
    }
    #[cfg(target_os = "linux")]
    {
        let data_home = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })?;
        Some(data_home.join(IDENTIFIER))
    }
    #[cfg(windows)]
    {
        let app_data = std::env::var_os("APPDATA")?;
        Some(PathBuf::from(app_data).join(IDENTIFIER))
    }
}

/// The settings the app writes for the command line (see `cli_settings.rs` in the app)
pub fn settings_file() -> Option<PathBuf> {
    data_dir().map(|directory| directory.join("cli-settings.json"))
}

/// Where the app listens (see `socket_path` in `cli_server.rs`)
#[cfg(unix)]
fn socket_path() -> Option<PathBuf> {
    let path = data_dir()?.join("cli.sock");
    if path.as_os_str().len() < 100 {
        return Some(path);
    }
    // SAFETY: `getuid` has no preconditions
    let uid = unsafe { libc::getuid() };
    Some(PathBuf::from(format!("/tmp/compresso-{uid}.sock")))
}

#[cfg(unix)]
pub type Stream = tokio::net::UnixStream;

#[cfg(windows)]
pub type Stream = tokio::net::windows::named_pipe::NamedPipeClient;

/// A connection to the running app, if it is running
#[cfg(unix)]
pub async fn connect() -> Option<Stream> {
    tokio::net::UnixStream::connect(socket_path()?).await.ok()
}

#[cfg(windows)]
pub async fn connect() -> Option<Stream> {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let name = format!(r"\\.\pipe\{IDENTIFIER}-{user}");
    tokio::net::windows::named_pipe::ClientOptions::new()
        .open(name)
        .ok()
}

/// A connection to the app, started in the background first when it is not running.
pub async fn connect_or_start() -> Result<Stream, CliError> {
    if let Some(stream) = connect().await {
        return Ok(stream);
    }
    start_app()?;
    // Usually a second or two; longer when the computer is busy
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Some(stream) = connect().await {
            return Ok(stream);
        }
    }
    Err(CliError::app(
        "CompressO was started, but it did not respond. Open CompressO once, then try again.",
    ))
}

/// This program, with symbolic links resolved (e.g. `/usr/local/bin/compresso`)
fn current_exe() -> Option<PathBuf> {
    let path = std::env::current_exe().ok()?;
    Some(std::fs::canonicalize(&path).unwrap_or(path))
}

/// The app's executable next to this program: in the same folder (inside `CompressO.app`, the
/// install folder, `/usr/bin` or the AppImage, or a development build), or one folder up
/// (Windows' `bin`, skipping `exe` itself so case-insensitive `bin\compresso.exe` never spawns
/// itself as `CompressO.exe`).
fn find_app_executable() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("COMPRESSO_APP") {
        return Some(PathBuf::from(path));
    }
    let exe = current_exe()?;
    find_app_executable_from(&exe)
}

fn find_app_executable_from(exe: &Path) -> Option<PathBuf> {
    let exe_canonical = std::fs::canonicalize(exe).unwrap_or_else(|_| exe.to_path_buf());
    let directory = exe.parent()?;
    let names: &[&str] = if cfg!(windows) {
        &["CompressO.exe", "compressO.exe"]
    } else {
        // Linux packages name it after the product, in lower case with a dash
        &["compressO", "CompressO", "compress-o"]
    };
    let found = [Some(directory), directory.parent()]
        .into_iter()
        .flatten()
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|path| {
            path.is_file()
                && std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
                    != exe_canonical
        });
    found
}

/// The `.app` bundle an executable is in (`CompressO.app/Contents/MacOS/compressO`)
#[cfg(target_os = "macos")]
fn app_bundle(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && bundle.extension()? == "app")
        .then(|| bundle.to_path_buf())
}

fn start_app() -> Result<(), CliError> {
    #[cfg(target_os = "linux")]
    {
        let has_display = |name: &str| std::env::var_os(name).is_some_and(|value| !value.is_empty());
        if !has_display("DISPLAY") && !has_display("WAYLAND_DISPLAY") {
            return Err(CliError::app(
                "CompressO is not running and no graphical display (DISPLAY or WAYLAND_DISPLAY) is available.",
            ));
        }
    }
    // Linux AppImage: the command line runs inside the image (see `--cli` in the app), which is
    // started again to run the app
    #[cfg(target_os = "linux")]
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return spawn_detached(Path::new(&appimage));
    }
    let executable = find_app_executable().ok_or_else(|| {
        CliError::app("CompressO could not be found. Reinstall CompressO, then try again.")
    })?;
    // Started by the system, so it runs as an app of its own (not of this terminal)
    #[cfg(target_os = "macos")]
    if let Some(bundle) = app_bundle(&executable) {
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-g")
            .arg("-a")
            .arg(&bundle)
            .arg("--args")
            .arg(BACKGROUND_ARG)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map_err(|err| CliError::app(format!("CompressO could not be started: {err}")))?;
        return if status.success() {
            Ok(())
        } else {
            Err(CliError::app("CompressO could not be started."))
        };
    }
    spawn_detached(&executable)
}

/// Starts the app on its own, so it keeps running when this terminal closes
fn spawn_detached(executable: &Path) -> Result<(), CliError> {
    let mut command = std::process::Command::new(executable);
    command
        .arg(BACKGROUND_ARG)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: `setsid` is async-signal-safe, as `pre_exec` requires
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS};
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|err| CliError::app(format!("CompressO could not be started: {err}")))
}

#[cfg(test)]
mod tests {
    use super::find_app_executable_from;

    #[test]
    fn find_app_executable_skips_cli_binary_and_finds_parent_app() {
        let root = std::env::temp_dir().join(format!(
            "compresso-cli-find-app-{}",
            std::process::id()
        ));
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let cli_name = if cfg!(windows) {
            "compresso.exe"
        } else {
            "compresso"
        };
        let app_name = if cfg!(windows) {
            "compressO.exe"
        } else {
            "compressO"
        };
        let cli_path = bin.join(cli_name);
        let app_path = root.join(app_name);
        std::fs::write(&cli_path, b"cli").unwrap();
        std::fs::write(&app_path, b"app").unwrap();

        let found = find_app_executable_from(&cli_path).unwrap();
        assert_eq!(
            std::fs::canonicalize(&found).unwrap(),
            std::fs::canonicalize(&app_path).unwrap()
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
