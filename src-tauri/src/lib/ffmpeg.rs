use crate::domain::{
    CancelInProgressCompressionPayload, CompressionResult, CustomEvents, TauriEvents,
    VideoCompressionProgress, VideoThumbnail,
};
use crate::sys::gpu::{self, GpuType};
use crossbeam_channel::{Receiver, Sender};
use nanoid::nanoid;
use regex::Regex;
use shared_child::SharedChild;
use std::{
    io::BufReader,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};
use strum::EnumProperty;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

pub struct FFMPEG {
    app: AppHandle,
    ffmpeg: Command,
    assets_dir: PathBuf,
}

const EXTENSIONS: [&str; 5] = ["mp4", "mov", "webm", "avi", "mkv"];

impl FFMPEG {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        match app.shell().sidecar("compresso_ffmpeg") {
            Ok(command) => {
                let app_data_dir = match app.path().app_data_dir() {
                    Ok(path_buf) => path_buf,
                    Err(_) => {
                        return Err(String::from(
                            "Application app directory is not setup correctly.",
                        ));
                    }
                };
                let assets_dir: PathBuf = [PathBuf::from(&app_data_dir), PathBuf::from("assets")]
                    .iter()
                    .collect();

                Ok(Self {
                    app: app.to_owned(),
                    ffmpeg: Command::from(command),
                    assets_dir,
                })
            }
            Err(err) => Err(format!("[ffmpeg-sidecar]: {:?}", err.to_string())),
        }
    }

    /// Compresses a video from a path
    pub async fn compress_video(
        &mut self,
        video_path: &str,
        convert_to_extension: &str,
        preset_name: Option<&str>,
        video_id: Option<&str>,
        should_mute_video: bool,
        quality: u16,
    ) -> Result<CompressionResult, String> {
        if !EXTENSIONS.contains(&convert_to_extension) {
            return Err(String::from("Invalid convert to extension."));
        }

        let id = match video_id {
            Some(id) => String::from(id),
            None => nanoid!(),
        };
        let id_clone1 = id.clone();
        let id_clone2 = id.clone();

        let file_name = format!("{}.{}", id, convert_to_extension);
        let file_name_clone = file_name.clone();

        let output_file: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let output_path = &output_file.display().to_string();

        let max_crf: u16 = 36;
        let min_crf: u16 = 24; // Lower the CRF, higher the quality
        let default_crf: u16 = 28;
        let compression_quality = if (0..=100).contains(&quality) {
            let diff = (max_crf - min_crf) - ((max_crf - min_crf) * quality) / 100;
            format!("{}", min_crf + diff)
        } else {
            format!("{default_crf}")
        };
        let compression_quality_str = compression_quality.as_str();

        let codec = "libx264";

        let preset = match preset_name {
            Some(preset) => match preset {
                "thunderbolt" => {
                    let mut args = vec![
                        "-i",
                        &video_path,
                        "-hide_banner",
                        "-progress",
                        "-",
                        "-nostats",
                        "-loglevel",
                        "error",
                        "-c:v",
                        codec,
                        "-crf",
                        compression_quality_str,
                        "-vf",
                        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                    ];
                    if convert_to_extension == "webm" {
                        args.push("-c:v");
                        args.push("libvpx-vp9");
                    }
                    if should_mute_video {
                        args.push("-an")
                    }
                    args.push(output_path);
                    args.push("-y");
                    args
                }
                _ => {
                    let mut args = vec![
                        "-i",
                        &video_path,
                        "-hide_banner",
                        "-progress",
                        "-",
                        "-nostats",
                        "-loglevel",
                        "error",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:v",
                        codec,
                        "-b:v",
                        "0",
                        "-movflags",
                        "+faststart",
                        "-preset",
                        "slow",
                        "-qp",
                        "0",
                        "-crf",
                        compression_quality_str,
                        "-vf",
                        "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                    ];
                    if convert_to_extension == "webm" {
                        args.push("-c:v");
                        args.push("libvpx-vp9");
                    }
                    if should_mute_video {
                        args.push("-an")
                    }
                    args.push(output_path);
                    args.push("-y");
                    args
                }
            },
            None => {
                let mut args = vec![
                    "-i",
                    &video_path,
                    "-hide_banner",
                    "-progress",
                    "-",
                    "-nostats",
                    "-loglevel",
                    "error",
                    "-c:v",
                    codec,
                    "-vf",
                    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                ];
                if convert_to_extension == "webm" {
                    args.push("-c:v");
                    args.push("libvpx-vp9");
                }
                if should_mute_video {
                    args.push("-an")
                }
                args.push(output_path);
                args.push("-y");
                args
            }
        };

        let command = self
            .ffmpeg
            .args(preset)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match SharedChild::spawn(command) {
            Ok(child) => {
                let cp = Arc::new(child);
                let cp_clone1 = cp.clone();
                let cp_clone2 = cp.clone();
                let cp_clone3 = cp.clone();
                let cp_clone4 = cp.clone();

                let window = match self.app.get_webview_window("main") {
                    Some(window) => window,
                    None => return Err(String::from("Could not attach to main window")),
                };
                let destroy_event_id =
                    window.listen(TauriEvents::Destroyed.get_str("key").unwrap(), move |_| {
                        log::info!("[tauri] window destroyed");
                        match cp.kill() {
                            Ok(_) => {
                                log::info!("[ffmpeg] child process killed.");
                            }
                            Err(err) => {
                                log::error!(
                                    "[ffmpeg] child process could not be killed {}",
                                    err.to_string()
                                );
                            }
                        }
                    });

                let should_cancel = Arc::new(Mutex::new(false));
                let should_cancel_clone = Arc::clone(&should_cancel);

                let cancel_event_id = window.listen(
                    CustomEvents::CancelInProgressCompression.as_ref(),
                    move |evt| {
                        let payload_str = evt.payload();
                        let payload_opt: Option<CancelInProgressCompressionPayload> =
                            serde_json::from_str(payload_str).ok();
                        if let Some(payload) = payload_opt {
                            let video_id = id_clone2.as_str();
                            if payload.video_id == video_id {
                                log::info!("[ffmpeg] compression requested to cancel.");
                                match cp_clone4.kill() {
                                    Ok(_) => {
                                        log::info!("[ffmpeg] child process killed.");
                                    }
                                    Err(err) => {
                                        log::error!(
                                            "[ffmpeg] child process could not be killed {}",
                                            err.to_string()
                                        );
                                    }
                                };
                                let mut _should_cancel = should_cancel_clone.lock().unwrap();
                                *_should_cancel = true;
                            }
                        }
                    },
                );

                #[cfg(debug_assertions)]
                tokio::spawn(async move {
                    if let Some(stderr) = cp_clone1.take_stderr() {
                        let mut reader = BufReader::new(stderr);

                        loop {
                            let mut buf: Vec<u8> = Vec::new();
                            match tauri::utils::io::read_line(&mut reader, &mut buf) {
                                Ok(n) => {
                                    if n == 0 {
                                        break;
                                    }
                                    if let Ok(val) = std::str::from_utf8(&buf) {
                                        log::debug!("[ffmpeg] stderr: {:?}", val);
                                    }
                                }
                                Err(_) => {
                                    break;
                                }
                            }
                        }
                    }
                });

                let (tx, rx): (Sender<String>, Receiver<String>) = crossbeam_channel::unbounded();

                let thread: tokio::task::JoinHandle<u8> = tokio::spawn(async move {
                    if let Some(stdout) = cp_clone2.take_stdout() {
                        let mut reader = BufReader::new(stdout);
                        loop {
                            let mut buf: Vec<u8> = Vec::new();
                            match tauri::utils::io::read_line(&mut reader, &mut buf) {
                                Ok(n) => {
                                    if n == 0 {
                                        break;
                                    }
                                    if let Ok(output) = std::str::from_utf8(&buf) {
                                        log::debug!("[ffmpeg] stdout: {:?}", output);
                                        let re =
                                            Regex::new("out_time=(?<out_time>.*?)\\n").unwrap();
                                        if let Some(cap) = re.captures(output) {
                                            let out_time = &cap["out_time"];
                                            if !out_time.is_empty() {
                                                tx.try_send(String::from(out_time)).ok();
                                            }
                                        }
                                    }
                                }
                                Err(_) => {
                                    break;
                                }
                            }
                        }
                    }

                    if cp_clone2.wait().is_ok() {
                        return 0;
                    }
                    1
                });

                let app_clone = self.app.clone();
                tokio::spawn(async move {
                    let file_name_clone_str = file_name_clone.as_str();
                    let id_clone_str = id_clone1.as_str();

                    while let Ok(current_duration) = rx.recv() {
                        let video_progress = VideoCompressionProgress {
                            video_id: String::from(id_clone_str),
                            file_name: String::from(file_name_clone_str),
                            current_duration,
                        };
                        if let Some(window) = app_clone.get_webview_window("main") {
                            window
                                .emit(
                                    CustomEvents::VideoCompressionProgress.as_ref(),
                                    video_progress,
                                )
                                .ok();
                        }
                    }
                });

                let message: String = match thread.await {
                    Ok(exit_status) => {
                        if exit_status == 1 {
                            String::from("Video is corrupted.")
                        } else {
                            String::from("")
                        }
                    }
                    Err(err) => err.to_string(),
                };

                // Cleanup
                window.unlisten(destroy_event_id);
                window.unlisten(cancel_event_id);
                match cp_clone3.kill() {
                    Ok(_) => {
                        log::info!("[ffmpeg] child process killed.");
                    }
                    Err(err) => {
                        log::error!(
                            "[ffmpeg] child process could not be killed {}",
                            err.to_string()
                        );
                    }
                }

                let is_cancelled = should_cancel.lock().unwrap();
                if *is_cancelled {
                    return Err(String::from("CANCELLED"));
                }

                if !message.is_empty() {
                    return Err(message);
                }
            }
            Err(err) => {
                return Err(err.to_string());
            }
        };

        Ok(CompressionResult {
            file_name,
            file_path: output_file.display().to_string(),
        })
    }

    /// Generates a .jpeg thumbnail image from a video path
    pub async fn generate_video_thumbnail(
        &mut self,
        video_path: &str,
    ) -> Result<VideoThumbnail, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exist in given path."));
        }
        let id = nanoid!();
        let file_name = format!("{}.jpg", id);
        let output_path: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let command = self.ffmpeg.args([
            "-i",
            video_path,
            "-ss",
            "00:00:01.00",
            "-vf",
            "scale=1080:720:force_original_aspect_ratio=decrease",
            "-vframes",
            "1",
            &output_path.display().to_string(),
            "-y",
        ]);

        match SharedChild::spawn(command) {
            Ok(child) => {
                let cp = Arc::new(child);
                let cp_clone1 = cp.clone();
                let cp_clone2 = cp.clone();

                let window = match self.app.get_webview_window("main") {
                    Some(window) => window,
                    None => return Err(String::from("Could not attach to main window")),
                };
                let destroy_event_id = window.listen(
                    TauriEvents::Destroyed.get_str("key").unwrap(),
                    move |_| match cp.kill() {
                        Ok(_) => {
                            log::info!("[ffmpeg] child process killed.");
                        }
                        Err(err) => {
                            log::error!(
                                "[ffmpeg] child process could not be killed {}",
                                err.to_string()
                            );
                        }
                    },
                );

                let thread: tokio::task::JoinHandle<u8> = tokio::spawn(async move {
                    if cp_clone1.wait().is_ok() {
                        return 0;
                    }
                    1
                });

                let message: String = match thread.await {
                    Ok(exit_status) => {
                        if exit_status == 1 {
                            String::from("Video is corrupted.")
                        } else {
                            String::from("")
                        }
                    }
                    Err(err) => err.to_string(),
                };

                // Cleanup
                window.unlisten(destroy_event_id);
                match cp_clone2.kill() {
                    Ok(_) => {
                        log::info!("[ffmpeg] child process killed.");
                    }
                    Err(err) => {
                        log::error!(
                            "[ffmpeg] child process could not be killed {}",
                            err.to_string()
                        );
                    }
                }
                if !message.is_empty() {
                    return Err(message);
                }
            }
            Err(err) => return Err(err.to_string()),
        };
        Ok(VideoThumbnail {
            id,
            file_name,
            file_path: output_path.display().to_string(),
        })
    }

    pub fn get_asset_dir(&self) -> String {
        self.assets_dir.display().to_string()
    }

    pub async fn get_video_duration(&mut self, video_path: &str) -> Result<Option<String>, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exist in given path."));
        }

        let command = self
            .ffmpeg
            .args(["-i", video_path, "-hide_banner"])
            .stdout(Stdio::piped());

        match SharedChild::spawn(command) {
            Ok(child) => {
                let cp = Arc::new(child);
                let cp_clone1 = cp.clone();
                let cp_clone2 = cp.clone();

                let window = match self.app.get_webview_window("main") {
                    Some(window) => window,
                    None => return Err(String::from("Could not attach to main window")),
                };
                let destroy_event_id = window.listen(
                    TauriEvents::Destroyed.get_str("key").unwrap(),
                    move |_| match cp.kill() {
                        Ok(_) => {
                            log::info!("[ffmpeg] child process killed.");
                        }
                        Err(err) => {
                            log::error!(
                                "[ffmpeg] child process could not be killed {}",
                                err.to_string()
                            );
                        }
                    },
                );

                let thread: tokio::task::JoinHandle<(u8, Option<String>)> =
                    tokio::spawn(async move {
                        let mut duration: Option<String> = None;
                        if let Some(stderr) = cp_clone1.take_stderr() {
                            let mut reader = BufReader::new(stderr);
                            loop {
                                let mut buf: Vec<u8> = Vec::new();
                                match tauri::utils::io::read_line(&mut reader, &mut buf) {
                                    Ok(n) => {
                                        if n == 0 {
                                            break;
                                        }
                                        let line = std::str::from_utf8(&buf).unwrap();
                                        let re = Regex::new("Duration: (?<duration>.*?),").unwrap();
                                        if let Some(cap) = re.captures(line) {
                                            let matched_duration = &cap["duration"];
                                            // FFMPEG might return duration as N/A for files with invalid or unknown encoding
                                            duration = Some(String::from(matched_duration));
                                        };
                                    }
                                    Err(_) => {
                                        break;
                                    }
                                };
                            }
                        }
                        if cp_clone1.wait().is_ok() {
                            return (0, duration);
                        }
                        (1, duration)
                    });

                let result: Result<Option<String>, String> = match thread.await {
                    Ok((exit_status, duration)) => {
                        if exit_status == 1 {
                            Err(String::from("Video file is corrupted"))
                        } else {
                            Ok(duration)
                        }
                    }
                    Err(err) => Err(err.to_string()),
                };

                // Cleanup
                window.unlisten(destroy_event_id);
                match cp_clone2.kill() {
                    Ok(_) => {
                        log::info!("[ffmpeg] child process killed.");
                    }
                    Err(err) => {
                        log::error!(
                            "[ffmpeg] child process could not be killed {}",
                            err.to_string()
                        );
                    }
                }
                match result {
                    Ok(duration) => Ok(duration),
                    Err(err) => Err(err),
                }
            }
            Err(err) => Err(err.to_string()),
        }
    }
}
