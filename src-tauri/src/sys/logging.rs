//! Logs written to files, so a problem can be looked into from the files a user sends (Settings ->
//! General -> Troubleshooting -> Show log files). Each file is named after when it was started, e.g.
//! `CompressO_2026-10-17_04-17-36.log` (with milliseconds when one of that second exists). The newest
//! file is written to until it holds more than `MAX_FILE_SIZE` when the app starts, then a new one is
//! started, and only the newest `KEPT_FILES` are kept, so the logs take about 25 MB at most.
//!
//! Where they are: macOS `~/Library/Logs/com.compresso.app/`, Windows
//! `%LOCALAPPDATA%\com.compresso.app\logs\`, Linux `~/.local/share/com.compresso.app/logs/`.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{plugin::TauriPlugin, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
use time::OffsetDateTime;

/// Start of every log file's name, followed by its date
const LOG_FILE_PREFIX: &str = "CompressO_";
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;
const KEPT_FILES: usize = 5;

/// Libraries whose messages are not worth keeping in the log files (connections, windows...)
const NOISY_TARGETS: [&str; 7] = [
    "tao",
    "wry",
    "rustls",
    "hyper",
    "reqwest",
    "h2",
    "tauri_plugin_updater",
];

/// The log file of this run, which "Show log files" shows
static LOG_FILE_PATH: OnceLock<PathBuf> = OnceLock::new();
static CRASH_FILE: OnceLock<File> = OnceLock::new();
static SESSION_MARKER: OnceLock<PathBuf> = OnceLock::new();

#[cfg(unix)]
static CRASH_FD: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-1);
#[cfg(windows)]
static CRASH_HANDLE: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// The log plugin, added once the app is set up (the log folder is the app's): the log files
/// (information, warnings & errors), and the terminal in development (everything)
pub fn plugin<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<TauriPlugin<R>, String> {
    let log_dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|err| err.to_string())?;
    let file_name = choose_log_file_name(&log_dir);
    let _ = LOG_FILE_PATH.set(log_dir.join(format!("{}.log", file_name)));
    remove_old_log_files(&log_dir, &file_name);

    let file = Target::new(TargetKind::Folder {
        path: log_dir,
        file_name: Some(file_name),
    })
    .filter(|metadata| {
        metadata.level() <= log::Level::Info
            && !NOISY_TARGETS
                .iter()
                .any(|target| metadata.target().starts_with(target))
    });
    #[allow(unused_mut)]
    let mut targets = vec![file];
    #[cfg(debug_assertions)]
    targets.push(Target::new(TargetKind::Stdout));

    Ok(tauri_plugin_log::Builder::new()
        .targets(targets)
        // The files are named & removed here (see above), so the plugin never renames them
        .max_file_size(u128::MAX)
        .rotation_strategy(RotationStrategy::KeepAll)
        // Local time cannot be read safely once the app runs several threads (it falls back to UTC
        // anyway), so the times are UTC, as the start line says
        .timezone_strategy(TimezoneStrategy::UseUtc)
        .build())
}

/// The log files, oldest first (their names start with their date, so they sort by it)
fn log_files(log_dir: &Path) -> Vec<(String, PathBuf)> {
    let mut files: Vec<(String, PathBuf)> = std::fs::read_dir(log_dir)
        .map(|entries| {
            entries
                .filter_map(|entry| {
                    let path = entry.ok()?.path();
                    let name = path.file_stem()?.to_string_lossy().to_string();
                    let is_log_file = name.starts_with(LOG_FILE_PREFIX)
                        && path.extension().is_some_and(|extension| extension == "log");
                    is_log_file.then_some((name, path))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}

/// The newest log file while it is not full, otherwise a new one named after now (with the
/// milliseconds when a file of this second exists)
fn choose_log_file_name(log_dir: &Path) -> String {
    if let Some((name, path)) = log_files(log_dir).pop() {
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size < MAX_FILE_SIZE {
            return name;
        }
    }
    let now = OffsetDateTime::now_utc();
    let name = format!(
        "{}{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
        LOG_FILE_PREFIX,
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
    );
    if log_dir.join(format!("{}.log", name)).exists() {
        format!("{}-{:03}", name, now.millisecond())
    } else {
        name
    }
}

/// Keeps the newest `KEPT_FILES` log files, with the one of this run
fn remove_old_log_files(log_dir: &Path, current_file_name: &str) {
    let files = log_files(log_dir);
    let old_files = files
        .iter()
        .filter(|(name, _)| name != current_file_name)
        .rev()
        .skip(KEPT_FILES - 1);
    for (_, path) in old_files {
        let _ = std::fs::remove_file(path);
    }
}

/// Writes a crash (a panic) to the log, which would otherwise only show in a terminal, before the
/// app ends as it did
pub fn log_panics() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let report = format!(
            "\n[crash] Rust panic in thread {:?}: {}\n",
            std::thread::current().name(),
            info,
        );
        write_crash_record(report.as_bytes());
        write_crash_record(format!("{}\n", std::backtrace::Backtrace::force_capture()).as_bytes());
        previous_hook(info);
    }));
}

/// Set up a separate append handle so a panic or native fault can write even if the logging
/// plugin cannot flush. A marker lets the next launch identify exits the OS did not report.
pub fn start_crash_reporting() -> Result<(), String> {
    let log_path = log_file_path()?;
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|err| err.to_string())?;

    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        CRASH_FD.store(file.as_raw_fd(), std::sync::atomic::Ordering::Relaxed);
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        CRASH_HANDLE.store(
            file.as_raw_handle() as isize,
            std::sync::atomic::Ordering::Relaxed,
        );
    }
    let _ = CRASH_FILE.set(file);

    #[cfg(unix)]
    install_unix_crash_handlers();
    #[cfg(windows)]
    unsafe {
        windows_sys::Win32::System::Diagnostics::Debug::SetUnhandledExceptionFilter(Some(
            windows_crash_handler,
        ));
    }

    let marker = log_path.with_file_name("CompressO.active-session");
    if let Ok(previous_log) = std::fs::read_to_string(&marker) {
        let previous_log = previous_log.trim();
        log::error!(
            "[crash] Previous run ended without a normal exit. Previous log: {}. If it has no crash entry, the process may have been killed before a handler could run.",
            previous_log,
        );
    }
    std::fs::write(&marker, log_path.to_string_lossy().as_bytes())
        .map_err(|err| err.to_string())?;
    let _ = SESSION_MARKER.set(marker);
    Ok(())
}

pub fn finish_crash_reporting() {
    log::info!("App exiting normally");
    if let Some(marker) = SESSION_MARKER.get() {
        if let Err(err) = std::fs::remove_file(marker) {
            log::error!("Could not clear the active-session marker: {}", err);
        }
    }
    log::logger().flush();
}

fn write_crash_record(bytes: &[u8]) {
    if let Some(file) = CRASH_FILE.get() {
        let _ = (&*file).write_all(bytes);
        let _ = file.sync_data();
    } else {
        let _ = std::io::stderr().write_all(bytes);
    }
}

#[cfg(unix)]
fn install_unix_crash_handlers() {
    for signal in [
        libc::SIGSEGV,
        libc::SIGBUS,
        libc::SIGILL,
        libc::SIGFPE,
        libc::SIGABRT,
    ] {
        unsafe {
            libc::signal(
                signal,
                unix_crash_handler as *const () as libc::sighandler_t,
            );
        }
    }
}

#[cfg(unix)]
extern "C" fn unix_crash_handler(signal: libc::c_int) {
    let fd = CRASH_FD.load(std::sync::atomic::Ordering::Relaxed);
    if fd >= 0 {
        let mut message =
            *b"\n[crash] Fatal native signal 00. See the system crash report for a stack trace.\n";
        let signal = signal as u8;
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        const SIGNAL_START: usize = b"\n[crash] Fatal native signal ".len();
        message[SIGNAL_START] = HEX[(signal >> 4) as usize];
        message[SIGNAL_START + 1] = HEX[(signal & 0xF) as usize];
        unsafe {
            libc::write(fd, message.as_ptr().cast(), message.len());
            libc::fsync(fd);
        }
    }
    unsafe {
        libc::signal(signal as libc::c_int, libc::SIG_DFL);
        let mut mask = std::mem::MaybeUninit::<libc::sigset_t>::uninit();
        libc::sigemptyset(mask.as_mut_ptr());
        libc::sigaddset(mask.as_mut_ptr(), signal as libc::c_int);
        libc::sigprocmask(libc::SIG_UNBLOCK, mask.as_ptr(), std::ptr::null_mut());
        libc::raise(signal as libc::c_int);
        libc::_exit(128 + signal as libc::c_int);
    }
}

#[cfg(windows)]
unsafe extern "system" fn windows_crash_handler(
    exception: *const windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_POINTERS,
) -> i32 {
    use windows_sys::Win32::System::Diagnostics::Debug::EXCEPTION_CONTINUE_SEARCH;
    let handle = CRASH_HANDLE.load(std::sync::atomic::Ordering::Relaxed);
    if handle != 0 && !exception.is_null() {
        let record = (*exception).ExceptionRecord;
        if !record.is_null() {
            let mut message = *b"\n[crash] Unhandled Windows exception 0x00000000 at 0x0000000000000000. See Windows crash reports for a stack trace.\n";
            const HEX: &[u8; 16] = b"0123456789ABCDEF";
            const CODE_START: usize = b"\n[crash] Unhandled Windows exception 0x".len();
            const ADDRESS_START: usize =
                b"\n[crash] Unhandled Windows exception 0x00000000 at 0x".len();
            let code = (*record).ExceptionCode as u32;
            let address = (*record).ExceptionAddress as usize;
            for index in 0..8 {
                message[CODE_START + index] = HEX[((code >> ((7 - index) * 4)) & 0xF) as usize];
            }
            for index in 0..16 {
                let shift = (15 - index) * 4;
                let digit = if shift < usize::BITS as usize {
                    (address >> shift) & 0xF
                } else {
                    0
                };
                message[ADDRESS_START + index] = HEX[digit];
            }
            let mut written = 0;
            windows_sys::Win32::Storage::FileSystem::WriteFile(
                handle as _,
                message.as_ptr(),
                message.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            );
            windows_sys::Win32::Storage::FileSystem::FlushFileBuffers(handle as _);
        }
    }
    EXCEPTION_CONTINUE_SEARCH
}

/// The app, version & system, at the top of each run in the log
pub fn log_app_start<R: Runtime>(app: &tauri::AppHandle<R>) {
    log::info!(
        "CompressO {} started on {} {} ({}), times in UTC",
        app.package_info().version,
        tauri_plugin_os::platform(),
        tauri_plugin_os::version(),
        tauri_plugin_os::arch(),
    );
}

/// The log file of this run, which "Show log files" shows in the file manager
pub fn log_file_path() -> Result<PathBuf, String> {
    LOG_FILE_PATH
        .get()
        .cloned()
        .ok_or_else(|| String::from("The log file is not set up."))
}
