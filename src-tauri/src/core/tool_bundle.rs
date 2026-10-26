//! Offline, verified tool installation. The signed app embeds the expected hashes; mutable
//! resources and completion markers are never trusted as an executable allowlist.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const EMBEDDED_MANIFEST: &str = include_str!(concat!(env!("OUT_DIR"), "/tool-manifest.json"));
const TARGET: &str = env!("COMPRESSO_TARGET");
const TOOLS: [&str; 10] = [
    "ffmpeg",
    "ffprobe",
    "pngquant",
    "jpegoptim",
    "gifski",
    "cjxl",
    "djxl",
    "jxlinfo",
    "heif-dec",
    "heif-enc",
];
const IMAGE_SOURCES: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../LICENSES/image-codecs/SOURCES.json"
));

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolFile {
    name: String,
    size: u64,
    sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema: u32,
    target: String,
    archive: String,
    format: String,
    sha256: String,
    tar_size: u64,
    files: Vec<ToolFile>,
    bootstrap: Vec<ToolFile>,
}

#[derive(Deserialize)]
struct ImageSources {
    targets: std::collections::HashMap<String, ImageSourceTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageSourceTarget {
    #[serde(default)]
    extra_files: Vec<ImageExtraFile>,
}

#[derive(Deserialize)]
struct ImageExtraFile {
    file: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    phase: String,
    message: String,
    ready: bool,
    error: Option<String>,
    /// How far the first-time setup is, from 0 to 1 (see `ensure_bundle`)
    progress: f64,
}

pub struct ToolBundleState(Mutex<Inner>);
struct Inner {
    status: ToolStatus,
    running: bool,
    directory: Option<PathBuf>,
}

impl Default for ToolBundleState {
    fn default() -> Self {
        Self(Mutex::new(Inner {
            status: ToolStatus {
                phase: "checking".into(),
                message: "Checking compression tools…".into(),
                ready: false,
                error: None,
                progress: 0.0,
            },
            running: false,
            directory: None,
        }))
    }
}

#[tauri::command]
pub fn get_tool_status(app: AppHandle) -> ToolStatus {
    app.state::<ToolBundleState>()
        .0
        .lock()
        .unwrap()
        .status
        .clone()
}

pub fn is_ready(app: &AppHandle) -> bool {
    app.try_state::<ToolBundleState>()
        .is_some_and(|state| state.0.lock().unwrap().status.ready)
}

#[tauri::command]
pub fn exit_tool_preparation(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "preparation" || is_ready(&app) {
        return Err("Only the preparation window can exit while tools are not ready".into());
    }
    // The app's exit handler also terminates a registered extraction subprocess.
    app.exit(0);
    Ok(())
}

fn update(app: &AppHandle, phase: &str, message: &str) {
    let state = app.state::<ToolBundleState>();
    let mut inner = state.0.lock().unwrap();
    inner.status.phase = phase.into();
    inner.status.message = message.into();
}

/// Never goes back, so the window's ring only fills
fn set_progress(app: &AppHandle, fraction: f64) {
    let state = app.state::<ToolBundleState>();
    let mut inner = state.0.lock().unwrap();
    inner.status.progress = inner.status.progress.max(fraction.clamp(0.0, 1.0));
}

fn show_preparation(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("preparation") {
        let _ = window.show();
        return Ok(());
    }
    let builder =
        WebviewWindowBuilder::new(app, "preparation", WebviewUrl::App("index.html".into()))
            .title("CompressO")
            .inner_size(360.0, 360.0)
            .resizable(false)
            .decorations(true)
            .shadow(true)
            .minimizable(true)
            .maximizable(false)
            .center();
    // A title bar blending into the window, as macOS' own small windows
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    builder
        .build()
        .map_err(|e| format!("Could not open preparation window: {e}"))?;
    Ok(())
}

/// Idempotent: the app's single-instance plugin prevents different processes installing at once,
/// and this flag prevents concurrent retries inside this process.
#[tauri::command]
pub fn prepare_tools(app: AppHandle) {
    {
        let state = app.state::<ToolBundleState>();
        let mut inner = state.0.lock().unwrap();
        if inner.running || inner.status.ready {
            return;
        }
        inner.running = true;
        inner.status.error = None;
        inner.status.progress = 0.0;
        inner.status.phase = "checking".into();
        inner.status.message = "Checking compression tools…".into();
    }
    // Development only: `COMPRESSO_PREVIEW_SETUP=1` (or `=error`) shows the first-time setup window,
    // without installing anything
    #[cfg(debug_assertions)]
    if let Ok(mode) = std::env::var("COMPRESSO_PREVIEW_SETUP") {
        tauri::async_runtime::spawn_blocking(move || preview_setup(&app, mode == "error"));
        return;
    }
    tauri::async_runtime::spawn(async move {
        let worker_app = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || install(&worker_app))
            .await
            .map_err(|e| format!("Tool preparation stopped: {e}"))
            .and_then(|result| result);
        let succeeded = result.is_ok();
        {
            let state = app.state::<ToolBundleState>();
            let mut inner = state.0.lock().unwrap();
            inner.running = false;
            match result {
                Ok(directory) => {
                    inner.directory = Some(directory);
                    inner.status.ready = true;
                    inner.status.progress = 1.0;
                    inner.status.phase = "ready".into();
                    inner.status.message = "Compression tools are ready".into();
                }
                Err(error) => {
                    log::error!(
                        "[tools] Preparation failed during {} for {TARGET}: {error}",
                        inner.status.phase
                    );
                    log::logger().flush();
                    inner.status.phase = "error".into();
                    inner.status.error = Some(error);
                }
            }
        }
        if succeeded {
            // Before this point even encoder detection would try to execute missing tools.
            super::hardware_encoder::available_encoders(&app).await;
        } else if let Err(error) = show_preparation(&app) {
            log::error!("[tools] {error}");
        }
    });
}

/// Plays the setup's steps over a few seconds (see `prepare_tools`): ready at the end, or failing
/// halfway with `fails`
#[cfg(debug_assertions)]
fn preview_setup(app: &AppHandle, fails: bool) {
    let steps = [
        ("verifying", "Verifying bundled compression tools…", 0.15),
        ("extracting", "Extracting compression tools. This may take a moment…", 0.55),
        ("validating", "Checking extracted compression tools…", 1.0),
    ];
    if let Err(error) = show_preparation(app) {
        log::error!("[tools] {error}");
        return;
    }
    // Lets the window load before the ring starts filling
    std::thread::sleep(std::time::Duration::from_millis(800));
    let mut progress: f64 = 0.0;
    for (phase, message, until) in steps {
        update(app, phase, message);
        while progress < until {
            progress = (progress + 0.01).min(until);
            set_progress(app, progress);
            if fails && progress >= 0.5 {
                let state = app.state::<ToolBundleState>();
                let mut inner = state.0.lock().unwrap();
                inner.running = false;
                inner.status.phase = "error".into();
                inner.status.error = Some("Preview of a failed setup".into());
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
    }
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
    let state = app.state::<ToolBundleState>();
    let mut inner = state.0.lock().unwrap();
    inner.running = false;
    inner.directory = Some(directory);
    inner.status.ready = true;
    inner.status.progress = 1.0;
    inner.status.phase = "ready".into();
}

fn manifest() -> Result<Option<Manifest>, String> {
    if cfg!(debug_assertions) && EMBEDDED_MANIFEST.trim() == "{}" {
        return Ok(None);
    }
    let manifest: Manifest = serde_json::from_str(EMBEDDED_MANIFEST).map_err(|e| e.to_string())?;
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut expected: HashSet<String> = TOOLS
        .iter()
        .map(|tool| format!("compresso_{tool}{suffix}"))
        .collect();
    let sources: ImageSources = serde_json::from_str(IMAGE_SOURCES).map_err(|e| e.to_string())?;
    let extras = sources
        .targets
        .get(TARGET)
        .ok_or("Missing image codec target metadata")?;
    expected.extend(extras.extra_files.iter().map(|file| file.file.clone()));
    let actual: HashSet<String> = manifest
        .files
        .iter()
        .map(|file| file.name.clone())
        .collect();
    if manifest.schema != 1
        || manifest.target != TARGET
        || actual != expected
        || manifest.files.len() != expected.len()
        || manifest.sha256.len() != 64
        || !manifest.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !matches!(manifest.format.as_str(), "lrz" | "xz")
        || manifest.archive != format!("tools.tar.{}", manifest.format)
    {
        return Err("Invalid tool bundle manifest for this application".into());
    }
    Ok(Some(manifest))
}

fn install(app: &AppHandle) -> Result<PathBuf, String> {
    let Some(manifest) = manifest()? else {
        // `cargo run`/Tauri dev can use checked-in binaries without a release packaging step.
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin");
        for tool in TOOLS {
            let path = development_path(tool);
            regular_file(&path)
                .map_err(|e| format!("Missing development tool {}: {e}", path.display()))?;
        }
        return Ok(directory);
    };
    let resources = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tool-bundle")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("tool-bundle")
    };
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("tools")
        .join(TARGET);
    ensure_bundle(
        &resources,
        &root,
        &manifest,
        |phase, message| {
            show_preparation(app)?;
            update(app, phase, message);
            Ok(())
        },
        |fraction| set_progress(app, fraction),
    )
}

fn development_name(tool: &str) -> String {
    format!(
        "compresso_{tool}-{TARGET}{}",
        if cfg!(windows) { ".exe" } else { "" }
    )
}

fn development_path(tool: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bin")
        .join(development_name(tool))
}

/// No caller-supplied paths or PATH lookups: all tools come from one verified installation.
pub fn command(app: &AppHandle, tool: &str) -> Result<Command, String> {
    if !TOOLS.contains(&tool) {
        return Err(format!("Unknown compression tool: {tool}"));
    }
    let state = app.state::<ToolBundleState>();
    let inner = state.0.lock().unwrap();
    let directory = inner
        .directory
        .as_ref()
        .filter(|_| inner.status.ready)
        .ok_or("Compression tools are still being prepared")?;
    let name = if cfg!(debug_assertions) && EMBEDDED_MANIFEST.trim() == "{}" {
        development_name(tool)
    } else {
        format!(
            "compresso_{tool}{}",
            if cfg!(windows) { ".exe" } else { "" }
        )
    };
    let path = if cfg!(debug_assertions) && EMBEDDED_MANIFEST.trim() == "{}" {
        development_path(tool)
    } else {
        directory.join(name)
    };
    Ok(process_command(path))
}

fn process_command(path: PathBuf) -> Command {
    let mut command = Command::new(path);
    // MediaProcessExecutor uses SharedChild::spawn and takes these handles to read probe JSON,
    // progress, and errors. Unlike Command::output(), spawn does not create pipes automatically.
    // Preserve the defaults previously provided by tauri_plugin_shell::Command.
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW, previously set by the shell plugin
    }
    command
}

fn regular_file(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.file_type().is_file() {
        return Err(format!("Expected a regular file: {}", path.display()));
    }
    Ok(metadata)
}

fn hash_file(path: &Path) -> Result<String, String> {
    hash_file_with_progress(path, &mut |_| {})
}

/// `read` is told of each part of the file read, in bytes
fn hash_file_with_progress(path: &Path, read: &mut dyn FnMut(u64)) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 128 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        read(count as u64);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn verify_files(directory: &Path, files: &[ToolFile], executable: bool) -> Result<(), String> {
    verify_files_with_progress(directory, files, executable, &mut |_| {})
}

/// `read` is told of the bytes checked, as in `hash_file_with_progress`
fn verify_files_with_progress(
    directory: &Path,
    files: &[ToolFile],
    executable: bool,
    read: &mut dyn FnMut(u64),
) -> Result<(), String> {
    for file in files {
        let path = directory.join(&file.name);
        let metadata = regular_file(&path)?;
        if metadata.len() != file.size || hash_file_with_progress(&path, read)? != file.sha256 {
            return Err(format!("Checksum mismatch: {}", file.name));
        }
        #[cfg(unix)]
        if executable {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return Err(format!("Tool is not executable: {}", file.name));
            }
        }
        #[cfg(not(unix))]
        let _ = executable;
    }
    Ok(())
}

fn installed(directory: &Path, manifest: &Manifest) -> bool {
    fs::symlink_metadata(directory).is_ok_and(|meta| meta.file_type().is_dir())
        && fs::read_to_string(directory.join("ready.json"))
            .is_ok_and(|value| value == manifest.sha256)
        && verify_files(directory, &manifest.files, true).is_ok()
}

fn lrzip_extraction_command(
    helper: &Path,
    archive: &Path,
    staging: &Path,
    relative_paths: bool,
) -> Result<Command, String> {
    let mut command = process_command(helper.to_path_buf());
    command.env("LRZIP", "NOCONFIG");
    if relative_paths {
        // Tauri's Windows resource directory is canonicalized (\\?\...). The old MinGW
        // LRZIP stat/fopen routines cannot reliably handle that form. Keep all file arguments
        // ASCII and relative; Rust handles the resource path and CreateProcessW sets the cwd.
        // Copy bytes without inheriting read-only resource attributes into the staging folder.
        let mut source = File::open(archive).map_err(|e| e.to_string())?;
        let mut copy = File::create(staging.join("tools.tar.lrz")).map_err(|e| e.to_string())?;
        io::copy(&mut source, &mut copy).map_err(|e| e.to_string())?;
        drop(copy);
        command
            .current_dir(staging)
            .env("TMPDIR", ".")
            .env("TMP", ".")
            .env("TEMP", ".")
            .args(["-d", "-q", "-p", "1", "-o", "tools.tar", "tools.tar.lrz"]);
    } else {
        command
            .env("TMPDIR", staging)
            .env("TMP", staging)
            .env("TEMP", staging)
            .args(["-d", "-q", "-p", "1", "-o"])
            .arg(staging.join("tools.tar"))
            .arg(archive);
    }
    command.stdin(Stdio::null()).stdout(Stdio::null());
    Ok(command)
}

/// Installs the tools, telling `progress` of each step & `report` how far it is (0 to 1). Each step
/// counts for the bytes it goes through: the archive checked, then the tools decompressed,
/// unpacked & checked, so the ring fills about evenly.
fn ensure_bundle(
    resources: &Path,
    root: &Path,
    manifest: &Manifest,
    mut progress: impl FnMut(&str, &str) -> Result<(), String>,
    report: impl Fn(f64),
) -> Result<PathBuf, String> {
    let directory = root.join(&manifest.sha256);
    if installed(&directory, manifest) {
        log::info!("[tools] Verified installed tools for {}", manifest.target);
        return Ok(directory);
    }
    progress("verifying", "Verifying bundled compression tools…")?;
    let archive = resources.join(&manifest.archive);
    let archive_size = regular_file(&archive)?.len();
    let tar_size = manifest.tar_size.max(1);
    let total = (archive_size + 3 * tar_size) as f64;
    let mut done: u64 = 0;
    let mut count = |bytes: u64| {
        done += bytes;
        report(done as f64 / total);
    };
    if hash_file_with_progress(&archive, &mut count)? != manifest.sha256 {
        return Err(
            "The bundled tool archive is damaged. Reinstall CompressO to restore it.".into(),
        );
    }
    verify_files(resources, &manifest.bootstrap, true)?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    // A stable staging path lets the next attempt remove interrupted extraction work.
    let staging = root.join(format!("{}.extracting", manifest.sha256));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let result = (|| {
        progress(
            "extracting",
            "Extracting compression tools. This may take a moment…",
        )?;
        match manifest.format.as_str() {
            "lrz" => {
                let tar = staging.join("tools.tar");
                let log_path = staging.join("lrzip.log");
                let helper = if cfg!(windows) { "lrzip.exe" } else { "lrzip" };
                log::info!(
                    "[tools] Extracting {} into {}",
                    archive.display(),
                    staging.display()
                );
                let mut command = lrzip_extraction_command(
                    &resources.join("bootstrap").join(helper),
                    &archive,
                    &staging,
                    cfg!(windows),
                )?;
                command.stderr(File::create(&log_path).map_err(|e| e.to_string())?);
                let child = Arc::new(
                    shared_child::SharedChild::spawn(&mut command)
                        .map_err(|e| format!("Could not start lrzip: {e}"))?,
                );
                // Closing the preparation window must also stop extraction before another
                // launch can clean its staging directory.
                super::media_process::register_running_process(&child);
                // lrzip does not tell how far it is: its part of the progress moves on its own, slowing
                // down as it goes & never quite reaching its end until lrzip is done (about a second
                // on a recent Mac)
                let started = std::time::Instant::now();
                let status = loop {
                    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                        break status;
                    }
                    let fraction = 1.0 - (-started.elapsed().as_secs_f64() / 1.5).exp();
                    report((archive_size as f64 + 0.95 * fraction * tar_size as f64) / total);
                    std::thread::sleep(std::time::Duration::from_millis(100));
                };
                if !status.success() {
                    return Err(format!(
                        "Tool extraction failed: {}",
                        fs::read_to_string(&log_path).unwrap_or_else(|_| status.to_string())
                    ));
                }
                fs::remove_file(log_path).map_err(|e| e.to_string())?;
                #[cfg(windows)]
                fs::remove_file(staging.join("tools.tar.lrz")).map_err(|e| e.to_string())?;
                if regular_file(&tar)?.len() != manifest.tar_size {
                    return Err("Unexpected decompressed archive size".into());
                }
                count(tar_size);
                extract_tar(
                    CountingReader::new(File::open(&tar).map_err(|e| e.to_string())?, &mut count),
                    &staging,
                    manifest,
                )?;
                fs::remove_file(tar).map_err(|e| e.to_string())?;
            }
            "xz" => {
                let file = File::open(&archive).map_err(|e| e.to_string())?;
                let tar = staging.join("tools.tar");
                let decoder = xz2::read::XzDecoder::new(file).take(manifest.tar_size + 1);
                let mut output = File::create(&tar).map_err(|e| e.to_string())?;
                let size = io::copy(&mut CountingReader::new(decoder, &mut count), &mut output)
                    .map_err(|e| e.to_string())?;
                if size != manifest.tar_size {
                    return Err("Unexpected decompressed archive size".into());
                }
                drop(output);
                extract_tar(
                    CountingReader::new(File::open(&tar).map_err(|e| e.to_string())?, &mut count),
                    &staging,
                    manifest,
                )?;
                fs::remove_file(tar).map_err(|e| e.to_string())?;
            }
            _ => return Err("Unsupported tool archive format".into()),
        }
        progress("validating", "Checking extracted compression tools…")?;
        verify_files_with_progress(&staging, &manifest.files, true, &mut count)?;
        // Sync the marker after successful verification. A crash before the final rename leaves
        // only an incomplete staging directory, never an installation considered ready.
        let mut marker = File::create(staging.join("ready.json")).map_err(|e| e.to_string())?;
        marker
            .write_all(manifest.sha256.as_bytes())
            .map_err(|e| e.to_string())?;
        marker.sync_all().map_err(|e| e.to_string())?;
        drop(marker);
        if directory.exists() {
            fs::remove_dir_all(&directory).map_err(|e| e.to_string())?;
        }
        fs::rename(&staging, &directory).map_err(|e| e.to_string())?;
        Ok(directory.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/// A reader telling `read` of each part read, in bytes (for the setup's progress)
struct CountingReader<'a, R> {
    inner: R,
    read: &'a mut dyn FnMut(u64),
}

impl<'a, R> CountingReader<'a, R> {
    fn new(inner: R, read: &'a mut dyn FnMut(u64)) -> Self {
        Self { inner, read }
    }
}

impl<R: Read> Read for CountingReader<'_, R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let count = self.inner.read(buffer)?;
        (self.read)(count as u64);
        Ok(count)
    }
}

fn extract_tar(reader: impl Read, directory: &Path, manifest: &Manifest) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    let mut seen = HashSet::new();
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let name = entry.path().map_err(|e| e.to_string())?.into_owned();
        let expected = manifest
            .files
            .iter()
            .find(|file| name == Path::new(&file.name))
            .ok_or_else(|| format!("Unexpected archive entry: {}", name.display()))?;
        if !entry.header().entry_type().is_file()
            || !seen.insert(expected.name.clone())
            || entry.size() != expected.size
        {
            return Err(format!("Invalid archive entry: {}", name.display()));
        }
        let path = directory.join(&expected.name);
        let mut output = File::options()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }
    if seen.len() != manifest.files.len() {
        return Err("The tool archive is incomplete".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("compresso-test-{}", nanoid::nanoid!()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture(resources: &Path, entries: &[(&str, tar::EntryType)]) -> Manifest {
        let mut tar = tar::Builder::new(Vec::new());
        for (name, kind) in entries {
            let mut header = tar::Header::new_ustar();
            header.set_size(4);
            header.set_mode(0o755);
            header.set_entry_type(*kind);
            header.set_cksum();
            tar.append_data(&mut header, name, &b"tool"[..]).unwrap();
        }
        let bytes = tar.into_inner().unwrap();
        let mut encoder = xz2::write::XzEncoder::new(Vec::new(), 6);
        encoder.write_all(&bytes).unwrap();
        let compressed = encoder.finish().unwrap();
        let archive = resources.join("tools.tar.xz");
        fs::write(&archive, compressed).unwrap();
        Manifest {
            schema: 1,
            target: TARGET.into(),
            archive: "tools.tar.xz".into(),
            format: "xz".into(),
            sha256: hash_file(&archive).unwrap(),
            tar_size: bytes.len() as u64,
            files: vec![ToolFile {
                name: "compresso_ffmpeg".into(),
                size: 4,
                sha256: format!("{:x}", Sha256::digest(b"tool")),
            }],
            bootstrap: vec![],
        }
    }

    #[test]
    fn installs_reuses_and_repairs_missing_or_corrupt_tools() {
        let temp = Fixture::new();
        let manifest = fixture(&temp.0, &[("compresso_ffmpeg", tar::EntryType::Regular)]);
        let root = temp.0.join("installed");
        let directory = ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        ensure_bundle(
            &temp.0,
            &root,
            &manifest,
            |_, _| panic!("must reuse verified tools"),
            |_| {},
        )
        .unwrap();
        // Same-length corruption must be detected, rather than trusting file size or the marker.
        fs::write(directory.join("compresso_ffmpeg"), b"evil").unwrap();
        ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        assert_eq!(
            fs::read(directory.join("compresso_ffmpeg")).unwrap(),
            b"tool"
        );
        fs::remove_file(directory.join("compresso_ffmpeg")).unwrap();
        ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        assert!(installed(&directory, &manifest));
    }

    #[test]
    fn rejects_corrupt_archive_without_marking_ready() {
        let temp = Fixture::new();
        let manifest = fixture(&temp.0, &[("compresso_ffmpeg", tar::EntryType::Regular)]);
        fs::write(temp.0.join("tools.tar.xz"), b"broken").unwrap();
        let root = temp.0.join("installed");
        assert!(ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).is_err());
        assert!(!installed(&root.join(&manifest.sha256), &manifest));
    }

    #[test]
    fn rejects_links_duplicates_and_unexpected_archive_paths() {
        for entries in [
            vec![("compresso_ffmpeg", tar::EntryType::Symlink)],
            vec![("compresso_ffmpeg", tar::EntryType::Regular); 2],
            vec![("other/compresso_ffmpeg", tar::EntryType::Regular)],
            vec![],
        ] {
            let temp = Fixture::new();
            let manifest = fixture(&temp.0, &entries);
            let root = temp.0.join("installed");
            assert!(ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).is_err());
            assert!(!installed(&root.join(&manifest.sha256), &manifest));
        }
    }

    #[test]
    fn cleans_interrupted_extraction_and_requires_completion_marker() {
        let temp = Fixture::new();
        let manifest = fixture(&temp.0, &[("compresso_ffmpeg", tar::EntryType::Regular)]);
        let root = temp.0.join("installed");
        let staging = root.join(format!("{}.extracting", manifest.sha256));
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("partial"), b"interrupted").unwrap();
        let directory = ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        assert!(!staging.exists());
        fs::remove_file(directory.join("ready.json")).unwrap();
        assert!(!installed(&directory, &manifest));
        ensure_bundle(&temp.0, &root, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        assert!(installed(&directory, &manifest));
    }

    #[test]
    fn rejects_unexpected_expanded_size() {
        let temp = Fixture::new();
        let mut manifest = fixture(&temp.0, &[("compresso_ffmpeg", tar::EntryType::Regular)]);
        manifest.tar_size = 10;
        assert!(ensure_bundle(
            &temp.0,
            &temp.0.join("installed"),
            &manifest,
            |_, _| Ok(()),
            |_| {}
        )
        .is_err());
    }

    #[test]
    fn unix_lrzip_uses_absolute_resource_and_staging_paths() {
        let temp = Fixture::new();
        let staging = temp.0.join("User profile with spaces and 日本語");
        let archive = temp.0.join("read only resources/tools.tar.lrz");
        let helper = temp.0.join("read only resources/bootstrap/lrzip");
        let command = lrzip_extraction_command(&helper, &archive, &staging, false).unwrap();
        let arguments: Vec<_> = command.get_args().map(|arg| arg.to_owned()).collect();
        assert_eq!(command.get_program(), helper.as_os_str());
        assert_eq!(command.get_current_dir(), None);
        assert_eq!(
            arguments,
            ["-d", "-q", "-p", "1", "-o"]
                .map(std::ffi::OsString::from)
                .into_iter()
                .chain([
                    staging.join("tools.tar").into_os_string(),
                    archive.into_os_string()
                ])
                .collect::<Vec<_>>()
        );
        for key in ["TMPDIR", "TMP", "TEMP"] {
            assert_eq!(
                command.get_envs().find(|(name, _)| *name == key).unwrap().1,
                Some(staging.as_os_str())
            );
        }
        assert!(!staging.exists()); // Unix extraction must not copy the resource archive.
    }

    #[test]
    fn windows_lrzip_uses_relative_files_from_a_writable_staging_directory() {
        let temp = Fixture::new();
        let resources = temp.0.join("Program Files").join("CompressO");
        let staging = temp.0.join("User profile with spaces and 日本語");
        fs::create_dir_all(&resources).unwrap();
        fs::create_dir(&staging).unwrap();
        let archive = resources.join("tools.tar.lrz");
        fs::write(&archive, b"verified resource archive").unwrap();
        let original_permissions = fs::metadata(&archive).unwrap().permissions();
        let mut read_only = original_permissions.clone();
        read_only.set_readonly(true);
        fs::set_permissions(&archive, read_only).unwrap();
        // On Windows canonicalization supplies the extended-length prefix used by Tauri.
        let archive = fs::canonicalize(archive).unwrap();
        let command = lrzip_extraction_command(
            &resources.join("bootstrap/lrzip.exe"),
            &archive,
            &staging,
            true,
        )
        .unwrap();
        fs::set_permissions(&archive, original_permissions).unwrap();
        assert_eq!(command.get_current_dir(), Some(staging.as_path()));
        let arguments: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            arguments,
            ["-d", "-q", "-p", "1", "-o", "tools.tar", "tools.tar.lrz"]
        );
        assert_eq!(
            fs::read(staging.join("tools.tar.lrz")).unwrap(),
            b"verified resource archive"
        );
        assert!(!fs::metadata(staging.join("tools.tar.lrz"))
            .unwrap()
            .permissions()
            .readonly());
        for key in ["TMPDIR", "TMP", "TEMP"] {
            assert_eq!(
                command.get_envs().find(|(name, _)| *name == key).unwrap().1,
                Some(std::ffi::OsStr::new("."))
            );
        }
    }

    #[test]
    #[ignore = "extracts a real LRZIP archive using the Windows relative-path strategy"]
    fn real_lrzip_extracts_with_relative_files_in_a_unicode_directory_with_spaces() {
        let manifest = manifest().unwrap().expect("prepare a tool archive first");
        if manifest.format != "lrz" {
            return;
        }
        let temp = Fixture::new();
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tool-bundle");
        let staging = temp.0.join("User profile with spaces and 日本語");
        fs::create_dir(&staging).unwrap();
        let helper = if cfg!(windows) { "lrzip.exe" } else { "lrzip" };
        let archive = fs::canonicalize(resources.join(&manifest.archive)).unwrap();
        assert_eq!(hash_file(&archive).unwrap(), manifest.sha256);
        let mut command = lrzip_extraction_command(
            &resources.join("bootstrap").join(helper),
            &archive,
            &staging,
            true,
        )
        .unwrap();
        let output = command.stderr(Stdio::piped()).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let tar = staging.join("tools.tar");
        assert_eq!(fs::metadata(&tar).unwrap().len(), manifest.tar_size);
        extract_tar(File::open(tar).unwrap(), &staging, &manifest).unwrap();
        verify_files(&staging, &manifest.files, true).unwrap();
    }

    #[test]
    #[ignore = "extracts the real release archive; run explicitly after prepare-tools.mjs"]
    fn real_bundled_tools_extract_and_execute() {
        let manifest = manifest().unwrap().expect("prepare a tool archive first");
        let temp = Fixture::new();
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tool-bundle");
        let directory =
            ensure_bundle(&resources, &temp.0, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        for tool in TOOLS {
            let flag = if tool.starts_with("ff") {
                "-version"
            } else if tool == "jxlinfo" {
                "--help"
            } else {
                "--version"
            };
            let name = format!(
                "compresso_{tool}{}",
                if cfg!(windows) { ".exe" } else { "" }
            );
            let mut command = Command::new(directory.join(name));
            command.arg(flag);
            let output = command.output().unwrap();
            assert!(
                output.status.success(),
                "{tool}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        ensure_bundle(
            &resources,
            &temp.0,
            &manifest,
            |_, _| panic!("must reuse"),
            |_| {},
        )
        .unwrap();
    }

    // Use the executor's spawn/handle-taking pattern: Command::output() creates its own pipes
    // and would hide a regression in process_command's defaults.
    fn shared_output(mut command: Command) -> (std::process::ExitStatus, String, String) {
        let child = shared_child::SharedChild::spawn(&mut command).unwrap();
        assert!(
            child.take_stdin().is_some(),
            "expected a piped stdin handle"
        );
        let mut stdout = child.take_stdout().expect("expected captured stdout");
        let mut stderr = child.take_stderr().expect("expected captured stderr");
        let stdout_thread = std::thread::spawn(move || {
            let mut text = String::new();
            stdout.read_to_string(&mut text).unwrap();
            text
        });
        let stderr_thread = std::thread::spawn(move || {
            let mut text = String::new();
            stderr.read_to_string(&mut text).unwrap();
            text
        });
        let status = child.wait().unwrap();
        (
            status,
            stdout_thread.join().unwrap(),
            stderr_thread.join().unwrap(),
        )
    }

    #[test]
    #[ignore = "extracts real tools and probes/transcodes a video; run after prepare-tools.mjs"]
    fn real_video_metadata_progress_and_errors_are_captured() {
        let manifest = manifest().unwrap().expect("prepare a tool archive first");
        let temp = Fixture::new();
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tool-bundle");
        let directory =
            ensure_bundle(&resources, &temp.0, &manifest, |_, _| Ok(()), |_| {}).unwrap();
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let ffmpeg = directory.join(format!("compresso_ffmpeg{suffix}"));
        let ffprobe = directory.join(format!("compresso_ffprobe{suffix}"));
        let video = temp.0.join("video with spaces.mp4");
        let mut generate = process_command(ffmpeg.clone());
        generate
            .args([
                "-hide_banner",
                "-f",
                "lavfi",
                "-i",
                "color=blue:size=320x240:rate=24",
                "-t",
                "1",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&video);
        let (status, _, errors) = shared_output(generate);
        assert!(status.success(), "{errors}");

        let mut probe = process_command(ffprobe);
        probe
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,r_frame_rate,avg_frame_rate",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
            ])
            .arg(&video);
        let (status, metadata, errors) = shared_output(probe);
        assert!(status.success(), "{errors}");
        let json: serde_json::Value = serde_json::from_str(&metadata).unwrap();
        assert_eq!(json["streams"][0]["width"], 320);
        assert_eq!(json["streams"][0]["height"], 240);
        assert!(
            json["format"]["duration"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap()
                > 0.0
        );

        let mut transcode = process_command(ffmpeg.clone());
        transcode
            .args(["-hide_banner", "-i"])
            .arg(&video)
            .args(["-c:v", "libx264", "-progress", "pipe:2", "-y"])
            .arg(temp.0.join("compressed.mp4"));
        let (status, _, progress) = shared_output(transcode);
        assert!(status.success(), "{progress}");
        assert!(progress.contains("progress=end"), "{progress}");

        let mut invalid = process_command(ffmpeg);
        invalid.arg("-i").arg(temp.0.join("missing.mp4"));
        let (status, _, errors) = shared_output(invalid);
        assert!(!status.success());
        assert!(
            errors.contains("missing.mp4"),
            "missing diagnostic output: {errors}"
        );
    }
}
