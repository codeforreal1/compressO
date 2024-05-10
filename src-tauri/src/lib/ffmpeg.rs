use crate::domain::CompressionResult;
use nanoid::nanoid;
use shared_child::SharedChild;
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    thread,
};
use tauri::{AppHandle, Manager, WindowEvent};
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
    ) -> Result<CompressionResult, String> {
        if !EXTENSIONS.contains(&convert_to_extension) {
            return Err(String::from("Invalid convert to extension."));
        }

        let file_name = format!("{}.{}", nanoid!(), convert_to_extension);
        let output_file: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let output_path = &output_file.display().to_string();

        let preset = match preset_name {
            "thunderbolt" => {
                let mut args = vec![
                    "-i",
                    &video_path,
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
                let cp_clone = cp.clone();

                if let Some(window) = self.app.get_webview_window("main") {
                    window.on_window_event(move |event| match event {
                        WindowEvent::Destroyed => match cp_clone.kill() {
                            Ok(_) => {
                                log::error!("[ffmpeg] child process killed.");
                            }
                            Err(err) => {
                                log::error!(
                                    "[ffmpeg] child process could not be killed {}",
                                    err.to_string()
                                );
                            }
                        },
                        _ => {}
                    });
                }

                let thread = std::thread::spawn(move || {
                    #[cfg(debug_assertions)]
                    if let Some(stdout) = cp.take_stdout() {
                        let lines = BufReader::new(stdout).lines();
                        for line in lines {
                            if let Ok(out) = line {
                                log::debug!("[ffmpeg] stdout: {:?}", out);
                            }
                        }
                    }

                    #[cfg(debug_assertions)]
                    if let Some(stderr) = cp.take_stderr() {
                        let lines = BufReader::new(stderr).lines();
                        for line in lines {
                            if let Ok(out) = line {
                                log::debug!("[ffmpeg] stderr: {:?}", out);
                            }
                        }
                    }
                    if let Ok(_) = cp.wait() {
                        return 0;
                    }
                    return 1;
                });

                match thread.join() {
                    Ok(exit_status) => {
                        if exit_status == 1 {
                            return Err(String::from("Video corrupted."));
                        }
                    }
                    Err(_) => {
                        return Err(String::from("Thread panicked."));
                    }
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
    pub async fn generate_video_thumbnail(&mut self, video_path: &str) -> Result<String, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exists."));
        }
        let file_name = format!("{}.jpg", nanoid!());
        let output_path: PathBuf = [self.assets_dir.clone(), PathBuf::from(&file_name)]
            .iter()
            .collect();

        let command = self
            .ffmpeg
            .args([
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
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        match SharedChild::spawn(command) {
            Ok(child) => {
                let cp = Arc::new(child);
                let cp_clone = cp.clone();

                if let Some(window) = self.app.get_webview_window("main") {
                    window.on_window_event(move |event| match event {
                        WindowEvent::Destroyed => match cp_clone.kill() {
                            Ok(_) => {
                                log::error!("[ffmpeg] child process killed.");
                            }
                            Err(err) => {
                                log::error!(
                                    "[ffmpeg] child process could not be killed {}",
                                    err.to_string()
                                );
                            }
                        },
                        _ => {}
                    })
                }

                let thread = thread::spawn(move || {
                    #[cfg(debug_assertions)]
                    if let Some(stdout) = cp.take_stdout() {
                        let lines = BufReader::new(stdout).lines();
                        for line in lines {
                            if let Ok(out) = line {
                                log::debug!("[ffmpeg] stdout: {}", out)
                            }
                        }
                    }

                    #[cfg(debug_assertions)]
                    if let Some(stderr) = cp.take_stderr() {
                        let lines = BufReader::new(stderr).lines();
                        for line in lines {
                            if let Ok(out) = line {
                                log::debug!("[ffmpeg] stderr: {}", out)
                            }
                        }
                    }
                    if let Ok(_) = cp.wait() {
                        return 0;
                    }
                    return 1;
                });

                match thread.join() {
                    Ok(exit_status) => {
                        if exit_status == 1 {
                            return Err(String::from("Video is corrupted."));
                        }
                    }
                    Err(_) => return Err(String::from("Thread panicked.")),
                }
            }
            Err(err) => return Err(err.to_string()),
        };
        return Ok(output_path.display().to_string());
    }

    pub fn get_asset_dir(&self) -> String {
        return self.assets_dir.display().to_string();
    }
}
