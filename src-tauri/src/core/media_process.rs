use crate::core::domain::{CancelInProgressCompressionPayload, CustomEvents, TauriEvents};
use crate::utils::event::EventListenerGuard;
use shared_child::SharedChild;
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader},
    process::Command,
    sync::{Arc, Mutex, Weak},
};
use strum::EnumProperty;
use tauri::{AppHandle, Listener, Manager};

/// Running processes, killed when the app quits: they are separate processes, so they would keep
/// running otherwise (closing the main window already kills them). Weak, so finished processes are
/// not kept alive.
static RUNNING_PROCESSES: Mutex<Vec<Weak<SharedChild>>> = Mutex::new(Vec::new());

pub(super) fn register_running_process(process: &Arc<SharedChild>) {
    if let Ok(mut processes) = RUNNING_PROCESSES.lock() {
        processes.retain(|process| process.strong_count() > 0);
        processes.push(Arc::downgrade(process));
    }
}

/// Kills every process still running (e.g. compressions), when the app quits
pub fn kill_running_processes() {
    if let Ok(mut processes) = RUNNING_PROCESSES.lock() {
        for process in processes.drain(..).filter_map(|process| process.upgrade()) {
            process.kill().ok();
        }
    }
}

/// Lines of a process's error output kept, logged if it fails (ffmpeg prints why it failed last)
const ERROR_OUTPUT_LINES: usize = 40;

/// The last lines of a process's error output
type ErrorOutputTail = Arc<Mutex<VecDeque<String>>>;

fn keep_error_output_line(tail: &ErrorOutputTail, line: &str) {
    if let Ok(mut lines) = tail.lock() {
        if lines.len() == ERROR_OUTPUT_LINES {
            lines.pop_front();
        }
        lines.push_back(line.trim_end().to_string());
    }
}

/// The command a process runs, for the log: its program's name & arguments
fn describe_command(command: &Command) -> String {
    let program = std::path::Path::new(command.get_program())
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let args = command
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(" ");
    format!("{} {}", program, args)
}

/// Logs a process that failed, with its command & the end of its error output (once read)
async fn log_failed_process(
    command: &str,
    exit_code: Option<u8>,
    tail: &ErrorOutputTail,
    reader: Option<tokio::task::JoinHandle<()>>,
) {
    if let Some(reader) = reader {
        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), reader).await;
    }
    let output = tail
        .lock()
        .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();
    log::warn!(
        "[media_process] Failed{}: {}\n{}",
        exit_code
            .map(|code| format!(" (exit code {})", code))
            .unwrap_or_default(),
        command,
        output
    );
}

pub type CancelCallback = Arc<dyn Fn() + Send + Sync>;

pub type StdoutCallback = Arc<dyn Fn(usize, String) + Send + Sync>;

pub type StderrCallback = Arc<dyn Fn(usize, String) + Send + Sync>;

pub struct MediaProcessExecutorBuilder {
    app: AppHandle,
    commands: Vec<Command>,
    cancel_ids: Vec<String>,
    cancel_callback: Option<CancelCallback>,
    stdout_callback: Option<StdoutCallback>,
    stderr_callback: Option<StderrCallback>,
    piped: bool,
    owner_window: Option<String>,
}

impl MediaProcessExecutorBuilder {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            owner_window: Some(String::from("main")),
            commands: Vec::new(),
            cancel_ids: Vec::new(),
            cancel_callback: None,
            stdout_callback: None,
            stderr_callback: None,
            piped: false,
        }
    }

    pub fn command(mut self, cmd: Command) -> Self {
        self.commands.clear();
        self.commands.push(cmd);
        self
    }

    pub fn commands(mut self, cmds: Vec<Command>) -> Self {
        self.commands = cmds;
        self
    }

    pub fn with_cancel_support(
        mut self,
        cancel_ids: Vec<String>,
        cancel_callback: Option<CancelCallback>,
    ) -> Self {
        self.cancel_ids = cancel_ids;
        self.cancel_callback = cancel_callback;
        self
    }

    pub fn with_stdout_callback(mut self, callback: StdoutCallback) -> Self {
        self.stdout_callback = Some(callback);
        self
    }

    pub fn with_stderr_callback(mut self, callback: StderrCallback) -> Self {
        self.stderr_callback = Some(callback);
        self
    }

    /// Window the processes belong to (the main window by default): they are stopped when it closes
    pub fn owner_window(mut self, label: &str) -> Self {
        self.owner_window = Some(label.to_string());
        self
    }

    pub fn with_piped(mut self) -> Self {
        self.piped = true;
        self
    }

    pub fn build(self) -> Result<MediaProcessExecutor, String> {
        if self.commands.is_empty() {
            return Err("No command provided".to_string());
        }

        // Validate incompatible flag combinations
        if self.piped {
            if self.commands.len() < 2 {
                return Err("Piped mode requires at least 2 commands".to_string());
            }
        }

        Ok(MediaProcessExecutor {
            app: self.app,
            commands: self.commands,
            cancel_ids: self.cancel_ids,
            cancel_callback: self.cancel_callback,
            stdout_callback: self.stdout_callback,
            stderr_callback: self.stderr_callback,
            piped: self.piped,
            owner_window: self.owner_window,
        })
    }
}

pub struct MediaProcessExecutor {
    app: AppHandle,
    commands: Vec<Command>,
    cancel_ids: Vec<String>,
    cancel_callback: Option<CancelCallback>,
    stdout_callback: Option<StdoutCallback>,
    stderr_callback: Option<StderrCallback>,
    piped: bool,
    owner_window: Option<String>,
}

impl MediaProcessExecutor {
    pub async fn spawn_and_wait(self) -> Result<ProcessExitStatus, String> {
        let (_stdout, exit_code) = self.spawn_and_wait_internal(false).await?;
        Ok(ProcessExitStatus { exit_code })
    }

    pub async fn spawn_and_wait_with_output(self) -> Result<ProcessOutput, String> {
        if self.piped {
            return Err(
                "Cannot capture stdout in piped mode. Stdout is consumed for piping between processes."
                    .to_string(),
            );
        }
        let (stdout_opt, exit_code) = self.spawn_and_wait_internal(true).await?;
        let stdout = stdout_opt.ok_or("Failed to capture stdout")?;
        Ok(ProcessOutput { stdout, exit_code })
    }

    async fn spawn_and_wait_internal(
        self,
        capture_stdout: bool,
    ) -> Result<(Option<String>, u8), String> {
        if self.piped {
            self.spawn_and_wait_piped(capture_stdout).await
        } else {
            self.spawn_and_wait_parallel(capture_stdout).await
        }
    }

    async fn spawn_and_wait_parallel(
        self,
        capture_stdout: bool,
    ) -> Result<(Option<String>, u8), String> {
        let mut processes: Vec<Arc<SharedChild>> = Vec::new();
        let should_cancel = Arc::new(Mutex::new(false));
        let captured_stdout = Arc::new(Mutex::new(None));
        let command_descriptions: Vec<String> = self.commands.iter().map(describe_command).collect();

        for mut cmd in self.commands {
            let child = SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?;
            let cp = Arc::new(child);
            register_running_process(&cp);
            processes.push(cp.clone());
        }

        // Removed on every return, including cancellations
        let mut _listener_guards: Vec<EventListenerGuard<_>> = Vec::new();
        // The processes belong to the window that started them, and are stopped when it is closed.
        // Without it (e.g. closed already), they still run, and are stopped when the app quits.
        let owner_window = self
            .owner_window
            .as_deref()
            .and_then(|label| self.app.get_webview_window(label));
        if let Some(window) = &owner_window {
            let destroy_id = window.listen(TauriEvents::Destroyed.get_str("key").unwrap(), {
                let processes = processes.clone();
                move |_| {
                    log::info!("[tauri] window destroyed, killing processes");
                    for proc in &processes {
                        proc.kill().ok();
                    }
                }
            });
            _listener_guards.push(EventListenerGuard::new(window.clone(), destroy_id));
        }

        if !self.cancel_ids.is_empty() {
            let cancel_ids = self.cancel_ids.clone();
            let processes_clone = processes.clone();
            let should_cancel_clone = should_cancel.clone();

            // Cancelled from any window, by the ids (`listen_any`: the main window sends it to itself)
            let cancel_id = self.app.listen_any(
                CustomEvents::CancelInProgressCompression.as_ref(),
                move |evt| {
                    let payload_str = evt.payload();
                    let payload_opt: Option<CancelInProgressCompressionPayload> =
                        serde_json::from_str(payload_str).ok();

                    if let Some(payload) = payload_opt {
                        let matches = cancel_ids
                            .iter()
                            .any(|id| payload.ids.iter().any(|payload_id| payload_id == id));

                        if matches {
                            log::info!("Process execution requested to cancel");
                            for proc in &processes_clone {
                                proc.kill().ok();
                            }
                            let mut flag = should_cancel_clone.lock().unwrap();
                            *flag = true;
                        }
                    }
                },
            );
            _listener_guards.push(EventListenerGuard::for_app(self.app.clone(), cancel_id));
        }

        let mut error_outputs: Vec<(ErrorOutputTail, Option<tokio::task::JoinHandle<()>>)> =
            Vec::new();
        for (idx, proc) in processes.iter().enumerate() {
            let proc_clone = proc.clone();
            let callback_clone = self.stderr_callback.clone();
            let tail: ErrorOutputTail = Arc::new(Mutex::new(VecDeque::new()));
            let tail_clone = tail.clone();
            let reader = tokio::spawn(async move {
                if let Some(stderr) = proc_clone.take_stderr() {
                    let mut reader = BufReader::new(stderr);
                    loop {
                        let mut buf: Vec<u8> = Vec::new();
                        match tauri::utils::io::read_line(&mut reader, &mut buf) {
                            Ok(n) => {
                                if n == 0 {
                                    break;
                                }
                                if let Ok(val) = std::str::from_utf8(&buf) {
                                    #[cfg(debug_assertions)]
                                    log::debug!("[media:process {}] stderr: {:?}", idx, val);
                                    keep_error_output_line(&tail_clone, val);

                                    if let Some(ref callback) = callback_clone {
                                        callback(idx, val.to_string());
                                    }
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            });
            error_outputs.push((tail, Some(reader)));
        }

        let mut wait_handles: Vec<tokio::task::JoinHandle<u8>> = Vec::new();

        if self.stdout_callback.is_some() {
            if let Some(proc) = processes.first() {
                let proc = proc.clone();
                let callback = self.stdout_callback.clone().unwrap();

                let handle = tokio::spawn(async move {
                    if let Some(stdout) = proc.take_stdout() {
                        let mut reader = BufReader::new(stdout);
                        loop {
                            let mut buf: Vec<u8> = Vec::new();
                            match tauri::utils::io::read_line(&mut reader, &mut buf) {
                                Ok(n) => {
                                    if n == 0 {
                                        break;
                                    }
                                    if let Ok(output) = std::str::from_utf8(&buf) {
                                        #[cfg(debug_assertions)]
                                        log::debug!("[stdout:process 0] {:?}", output);
                                        callback(0, output.to_string());
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }

                    match proc.wait() {
                        Ok(status) if status.success() => 0u8,
                        _ => 1u8,
                    }
                });
                wait_handles.push(handle);
            }
        }

        if capture_stdout {
            if let Some(proc) = processes.last() {
                let proc = proc.clone();
                let captured_stdout_clone = captured_stdout.clone();
                let handle = tokio::spawn(async move {
                    let mut json_str = String::new();
                    if let Some(stdout) = proc.take_stdout() {
                        let reader = std::io::BufReader::new(stdout);
                        for line_res in reader.lines() {
                            if let Ok(line) = line_res {
                                json_str.push_str(&line);
                            }
                        }
                    }
                    let mut captured = captured_stdout_clone.lock().unwrap();
                    *captured = Some(json_str);

                    match proc.wait() {
                        Ok(status) if status.success() => 0u8,
                        _ => 1u8,
                    }
                });
                wait_handles.push(handle);
            }
        }

        for (idx, proc) in processes.iter().enumerate() {
            let has_handle = if capture_stdout && idx == processes.len() - 1 {
                true
            } else if self.stdout_callback.is_some() && idx == 0 {
                true
            } else {
                false
            };

            if !has_handle {
                let proc = proc.clone();
                let handle = tokio::spawn(async move {
                    match proc.wait() {
                        Ok(status) if status.success() => 0u8,
                        _ => 1u8,
                    }
                });
                wait_handles.push(handle);
            }
        }

        // Wait for ALL processes to complete and check for errors
        let mut final_exit_code = 0u8;
        for handle in wait_handles {
            match handle.await {
                Ok(code) => {
                    if code != 0 {
                        final_exit_code = code;
                    }
                }
                Err(e) => {
                    return Err(format!("Process execution failed: {}", e));
                }
            }
        }


        for proc in &processes {
            proc.kill().ok();
        }

        let is_cancelled = *should_cancel.lock().unwrap();
        if is_cancelled {
            if let Some(ref callback) = self.cancel_callback {
                callback();
            }
            return Err("CANCELLED".to_string());
        }

        if final_exit_code != 0 {
            for (idx, (tail, reader)) in error_outputs.into_iter().enumerate() {
                let command = command_descriptions.get(idx).map(String::as_str).unwrap_or("");
                log_failed_process(command, Some(final_exit_code), &tail, reader).await;
            }
        }

        let stdout = if capture_stdout {
            let captured = captured_stdout.lock().unwrap();
            captured.clone()
        } else {
            None
        };

        Ok((stdout, final_exit_code))
    }

    async fn spawn_and_wait_piped(
        self,
        _capture_stdout: bool,
    ) -> Result<(Option<String>, u8), String> {
        let mut processes: Vec<Arc<SharedChild>> = Vec::new();
        let should_cancel = Arc::new(Mutex::new(false));
        let processes_shared = Arc::new(Mutex::new(Vec::<Arc<SharedChild>>::new()));

        let mut previous_stdout: Option<std::process::ChildStdout> = None;
        let command_count = self.commands.len();
        let command_descriptions: Vec<String> = self.commands.iter().map(describe_command).collect();

        for (idx, mut cmd) in self.commands.into_iter().enumerate() {
            if idx > 0 {
                if let Some(stdout) = previous_stdout {
                    cmd.stdin(stdout);
                    log::debug!(
                        "[media_process] Connecting stdin of process {} to previous stdout",
                        idx
                    );
                } else {
                    return Err(format!(
                        "Process {} expects stdin but no previous stdout available",
                        idx
                    ));
                }
            }

            // All processes except the last need piped stdout
            if idx < command_count - 1 {
                cmd.stdout(std::process::Stdio::piped());
            }

            let child = SharedChild::spawn(&mut cmd).map_err(|e| {
                let mut processes = processes_shared.lock().unwrap();
                for process in processes.iter_mut() {
                    process.kill().ok();
                }
                format!("Failed to spawn process {}: {}", idx, e)
            })?;
            let child = Arc::new(child);

            if idx < command_count - 1 {
                previous_stdout = child.take_stdout();
                if previous_stdout.is_none() {
                    let mut processes = processes_shared.lock().unwrap();
                    for process in processes.iter_mut() {
                        process.kill().ok();
                    }
                    return Err(format!(
                        "Process {} does not have piped stdout, cannot continue pipe chain",
                        idx
                    ));
                }
            } else {
                previous_stdout = None;
            }

            register_running_process(&child);
            processes.push(child.clone());
            log::debug!(
                "[media_process] Piped processes spawned process {} successfully",
                idx
            );
        }

        *processes_shared.lock().unwrap() = processes.clone();
        let process_count = processes_shared.lock().unwrap().len();

        // Removed on every return, including cancellations
        let mut _listener_guards: Vec<EventListenerGuard<_>> = Vec::new();
        // The processes belong to the window that started them, and are stopped when it is closed.
        // Without it (e.g. closed already), they still run, and are stopped when the app quits.
        let owner_window = self
            .owner_window
            .as_deref()
            .and_then(|label| self.app.get_webview_window(label));
        if let Some(window) = &owner_window {
            let destroy_id = window.listen(TauriEvents::Destroyed.get_str("key").unwrap(), {
                let processes_shared = processes_shared.clone();
                move |_| {
                    log::info!("[media_process] window destroyed, killing piped processes");
                    let processes = processes_shared.lock().unwrap();
                    for process in processes.iter() {
                        process.kill().ok();
                    }
                }
            });
            _listener_guards.push(EventListenerGuard::new(window.clone(), destroy_id));
        }

        if !self.cancel_ids.is_empty() {
            let cancel_ids = self.cancel_ids.clone();
            let should_cancel_clone = should_cancel.clone();
            let processes_shared_clone = processes_shared.clone();

            // Cancelled from any window, by the ids (`listen_any`: the main window sends it to itself)
            let cancel_id = self.app.listen_any(
                CustomEvents::CancelInProgressCompression.as_ref(),
                move |evt| {
                    let payload_str = evt.payload();
                    let payload_opt: Option<CancelInProgressCompressionPayload> =
                        serde_json::from_str(payload_str).ok();

                    if let Some(payload) = payload_opt {
                        let matches = cancel_ids
                            .iter()
                            .any(|id| payload.ids.iter().any(|payload_id| payload_id == id));

                        if matches {
                            log::info!("Piped process execution requested to cancel");
                            let processes = processes_shared_clone.lock().unwrap();
                            for process in processes.iter() {
                                process.kill().ok();
                            }
                            let mut flag = should_cancel_clone.lock().unwrap();
                            *flag = true;
                        }
                    }
                },
            );
            _listener_guards.push(EventListenerGuard::for_app(self.app.clone(), cancel_id));
        }

        let mut error_outputs: Vec<(ErrorOutputTail, Option<tokio::task::JoinHandle<()>>)> =
            Vec::new();
        for (idx, proc) in processes.iter().enumerate() {
            let proc_clone = proc.clone();
            let callback_clone = self.stderr_callback.clone();
            let tail: ErrorOutputTail = Arc::new(Mutex::new(VecDeque::new()));
            let tail_clone = tail.clone();
            let reader = tokio::spawn(async move {
                if let Some(stderr) = proc_clone.take_stderr() {
                    let mut reader = BufReader::new(stderr);
                    loop {
                        let mut buf: Vec<u8> = Vec::new();
                        match tauri::utils::io::read_line(&mut reader, &mut buf) {
                            Ok(n) => {
                                if n == 0 {
                                    break;
                                }
                                if let Ok(val) = std::str::from_utf8(&buf) {
                                    #[cfg(debug_assertions)]
                                    log::debug!("[media:piped process {}] stderr: {:?}", idx, val);
                                    keep_error_output_line(&tail_clone, val);
                                    if let Some(ref callback) = callback_clone {
                                        callback(idx, val.to_string());
                                    }
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            });
            error_outputs.push((tail, Some(reader)));
        }

        // Capture stdout from LAST process in piped mode
        if self.stdout_callback.is_some() {
            let last_idx = process_count - 1;
            let proc_opt = {
                let processes = processes_shared.lock().unwrap();
                if last_idx < processes.len() {
                    Some(processes[last_idx].clone())
                } else {
                    log::error!("[media_process] Last process not found for stdout capture");
                    None
                }
            };

            if let Some(proc) = proc_opt {
                let callback = self.stdout_callback.clone().unwrap();
                tokio::spawn(async move {
                    if let Some(stdout) = proc.take_stdout() {
                        let mut reader = BufReader::new(stdout);
                        loop {
                            let mut buf: Vec<u8> = Vec::new();
                            match tauri::utils::io::read_line(&mut reader, &mut buf) {
                                Ok(n) => {
                                    if n == 0 {
                                        break;
                                    }
                                    if let Ok(output) = std::str::from_utf8(&buf) {
                                        #[cfg(debug_assertions)]
                                        log::debug!(
                                            "[piped:stdout:process {}] {:?}",
                                            last_idx,
                                            output
                                        );
                                        callback(last_idx, output.to_string());
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                });
            }
        }

        let mut final_exit_code = 0u8;
        let mut all_success = true;

        for idx in 0..process_count {
            let proc = {
                let processes = processes_shared.lock().unwrap();
                if idx < processes.len() {
                    processes[idx].clone()
                } else {
                    log::error!("[media_process] Process {} not found in shared vector", idx);
                    all_success = false;
                    break;
                }
            };

            log::debug!("[media_process] Waiting for process {} to complete", idx);

            if *should_cancel.lock().unwrap() {
                log::info!("[media_process] Cancelled before process {}", idx);
                proc.kill().ok();
                let _ = proc.wait();
                if let Some(ref callback) = self.cancel_callback {
                    callback();
                }
                return Err("CANCELLED".to_string());
            }

            let (tx, rx) =
                std::sync::mpsc::channel::<Result<std::process::ExitStatus, std::io::Error>>();

            std::thread::spawn(move || {
                let result = proc.wait();
                tx.send(result).ok();
            });

            loop {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await; // 100ms polling

                if *should_cancel.lock().unwrap() {
                    log::info!(
                        "[media_process] Cancelled while waiting for process {} to complete",
                        idx
                    );
                    drop(rx);
                    if let Some(ref callback) = self.cancel_callback {
                        callback();
                    }
                    return Err("CANCELLED".to_string());
                }

                match rx.try_recv() {
                    Ok(wait_result) => {
                        match wait_result {
                            Ok(exit_status) => {
                                if exit_status.success() {
                                    log::debug!(
                                        "[media_process] Process {} completed successfully",
                                        idx
                                    );
                                } else {
                                    log::error!(
                                        "[media_process] Process {} failed with exit code: {:?}",
                                        idx,
                                        exit_status.code()
                                    );
                                    all_success = false;
                                    final_exit_code = exit_status.code().unwrap_or(1) as u8;
                                }
                            }
                            Err(e) => {
                                log::error!("[media_process] Process {} wait failed: {}", idx, e);
                                all_success = false;
                                final_exit_code = 1;
                            }
                        }
                        break;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => {
                        // Process not done yet, continue polling
                        continue;
                    }
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        log::error!("[media_process] Process {} wait channel disconnected", idx);
                        all_success = false;
                        final_exit_code = 1;
                        break;
                    }
                }
            }

            if !all_success {
                break;
            }

            if *should_cancel.lock().unwrap() {
                log::info!("[media_process] Cancelled after process {} completed", idx);
                if let Some(ref callback) = self.cancel_callback {
                    callback();
                }
                return Err("CANCELLED".to_string());
            }
        }


        if !all_success {
            for (idx, (tail, reader)) in error_outputs.into_iter().enumerate() {
                let command = command_descriptions.get(idx).map(String::as_str).unwrap_or("");
                log_failed_process(command, Some(final_exit_code), &tail, reader).await;
            }
            return Err("Piped process chain failed".to_string());
        }

        log::info!(
            "[media_process] All {} processes completed successfully",
            process_count
        );
        Ok((None, final_exit_code))
    }
}

pub struct ProcessExitStatus {
    exit_code: u8,
}

impl ProcessExitStatus {
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }

    pub fn code(&self) -> u8 {
        self.exit_code
    }
}

pub struct ProcessOutput {
    pub stdout: String,
    exit_code: u8,
}

impl ProcessOutput {
    pub fn success(&self) -> bool {
        self.exit_code == 0
    }

    pub fn code(&self) -> u8 {
        self.exit_code
    }
}
