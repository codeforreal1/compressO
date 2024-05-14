use crate::domain::{
    CompressionResult, CustomEvents, TauriEvents, VideoCompressionProgress, VideoThumbnail,
};
use crossbeam_channel::{Receiver, Sender};
use nanoid::nanoid;
use regex::Regex;
use shared_child::SharedChild;
use std::{
    io::BufReader,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
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
        match app.shell().sidecar("xbin_ffmpeg") {
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

                return Ok(Self {
                    app: app.to_owned(),
                    ffmpeg: Command::from(command),
                    assets_dir,
                });
            }
            Err(err) => return Err(format!("[ffmpeg-sidecar]: {:?}", err.to_string())),
        }
    }

    /// Compresses a video from a path
    pub async fn compress_video(
        &mut self,
        video_path: &str,
        convert_to_extension: &str,
        preset_name: &str,
        video_id: Option<&str>,
    ) -> Result<CompressionResult, String> {
        if !EXTENSIONS.contains(&convert_to_extension) {
            return Err(String::from("Invalid convert to extension."));
        }

        let id = match video_id {
            Some(id) => String::from(id),
            None => nanoid!(),
        };
        let id_clone = id.clone();
        let file_name = format!("{}.{}", id, convert_to_extension);
        let file_name_clone = file_name.clone();

        let output_file: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let output_path = &output_file.display().to_string();

        let preset = match preset_name {
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
                    "-vcodec",
                    "libx264",
                    "-crf",
                    " 28",
                    "-vf",
                    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                ];
                if convert_to_extension == "webm" {
                    args.push("-c:v");
                    args.push("libvpx-vp9");
                }
                args.push(&output_path);
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
                    "libx264",
                    "-b:v",
                    "0",
                    "-movflags",
                    "+faststart",
                    "-preset",
                    "slow",
                    "-qp",
                    "0",
                    "-crf",
                    "32",
                    "-vf",
                    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                ];
                if convert_to_extension == "webm" {
                    args.push("-c:v");
                    args.push("libvpx-vp9");
                }
                args.push(&output_path);
                args.push("-y");
                args
            }
        };

        let mut command = self
            .ffmpeg
            .args(preset)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match SharedChild::spawn(&mut command) {
            Ok(child) => {
                let cp = Arc::new(child);
                let cp_clone1 = cp.clone();
                let cp_clone2 = cp.clone();
                let cp_clone3 = cp.clone();

                let window = match self.app.get_webview_window("main") {
                    Some(window) => window,
                    None => return Err(String::from("Could not attach to main window")),
                };
                let event_id = window.listen(
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
                                    if let Some(val) = std::str::from_utf8(&buf).ok() {
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
                                    if let Some(output) = std::str::from_utf8(&buf).ok() {
                                        log::debug!("[ffmpeg] stdout: {:?}", output);
                                        let re =
                                            Regex::new("out_time=(?<out_time>.*?)\\n").unwrap();
                                        if let Some(cap) = re.captures(output) {
                                            let out_time = &cap["out_time"];
                                            if out_time.len() > 0 {
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

                    if let Ok(_) = cp_clone2.wait() {
                        return 0;
                    }
                    return 1;
                });

                let app_clone = self.app.clone();
                tokio::spawn(async move {
                    let file_name_clone_str = file_name_clone.as_str();
                    let id_clone_str = id_clone.as_str();

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
                window.unlisten(event_id);
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

                if message.len() > 0 {
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
                let event_id = window.listen(
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
                    if let Ok(_) = cp_clone1.wait() {
                        return 0;
                    }
                    return 1;
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
                window.unlisten(event_id);
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
                if message.len() > 0 {
                    return Err(message);
                }
            }
            Err(err) => return Err(err.to_string()),
        };
        return Ok(VideoThumbnail {
            id,
            file_name,
            file_path: output_path.display().to_string(),
        });
    }

    pub fn get_asset_dir(&self) -> String {
        return self.assets_dir.display().to_string();
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
                let event_id = window.listen(
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
                        if let Ok(_) = cp_clone1.wait() {
                            return (0, duration);
                        }
                        return (1, duration);
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
                window.unlisten(event_id);
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
                    Ok(duration) => return Ok(duration),
                    Err(err) => return Err(err),
                };
            }
            Err(err) => return Err(err.to_string()),
        };
    }
}
