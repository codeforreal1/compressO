use nanoid::nanoid;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_shell::{process::Command, ShellExt};

use crate::domain::CompressionResult;

pub struct FFMPEG {
    ffmpeg: Command,
    assets_dir: PathBuf,
}

const EXTENSIONS: [&str; 5] = ["mp4", "mov", "webm", "avi", "mkv"];

impl FFMPEG {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        match app.shell().sidecar("ffmpeg") {
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
                    ffmpeg: command,
                    assets_dir,
                });
            }
            Err(err) => return Err(format!("[ffmpeg-sidecar]: {:?}", err.to_string())),
        }
    }

    /// Compresses a video from a path
    pub async fn compress_video(
        self,
        video_path: &str,
        convert_to_extension: &str,
        preset_name: &str,
    ) -> Result<CompressionResult, String> {
        if !EXTENSIONS.contains(&convert_to_extension) {
            return Err(String::from("Invalid convert to extension."));
        }

        let file_name = format!("{}.{}", nanoid!(), convert_to_extension);
        let output_file: PathBuf = [self.assets_dir, PathBuf::from(&file_name)]
            .iter()
            .collect();

        let output_path = &output_file.display().to_string();

        match self
            .ffmpeg
            .args(match preset_name {
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
            })
            .spawn()
        {
            Ok(ok) => {
                let (mut rx, _) = ok;
                if let Err(err) = tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        println!("[event] {:?}", event);
                    }
                })
                .await
                {
                    return Err(err.to_string());
                };
            }
            Err(err) => {
                return Err(err.to_string());
            }
        };

        Ok(CompressionResult {
            file_name,
            output_path: output_file.display().to_string(),
        })
    }

    /// Generates a .jpeg thumbnail image from a video path
    pub async fn generate_video_thumbnail(self, video_path: &str) -> Result<String, String> {
        if !Path::exists(Path::new(video_path)) {
            return Err(String::from("File does not exists."));
        }
        let file_name = format!("{}.jpg", nanoid!());
        let output_path: PathBuf = [self.assets_dir, PathBuf::from(&file_name)]
            .iter()
            .collect();

        match self
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
            .spawn()
        {
            Ok(ok) => {
                let (mut rx, _) = ok;
                if let Err(err) = tauri::async_runtime::spawn(async move {
                    while let Some(event) = rx.recv().await {
                        println!("[event] {:?}", event);
                    }
                })
                .await
                {
                    return Err(err.to_string());
                };
            }
            Err(err) => return Err(err.to_string()),
        };

        return Ok(output_path.display().to_string());
    }
}
