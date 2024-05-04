use nanoid::nanoid;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_shell::{process::Command, ShellExt};

use crate::domain::CompressionResult;

pub struct FFMPEG {
    ffmpeg: Command,
    app_data_dir: PathBuf,
    assets_dir: PathBuf,
}

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
                    app_data_dir: PathBuf::from(&app_data_dir),
                    assets_dir,
                });
            }
            Err(err) => return Err(format!("[ffmpeg-sidecar]: {:?}", err.to_string())),
        }
    }

    /// Compresses a video from a path
    pub async fn compress_video(self, video_path: &str) -> Result<CompressionResult, String> {
        let file_name = format!("{}.mp4", nanoid!());
        let output_file: PathBuf = [self.assets_dir, PathBuf::from(&file_name)]
            .iter()
            .collect();

        match self
            .ffmpeg
            .args([
                "-i",
                video_path,
                "-pix_fmt",
                "yuv420p",
                "-c:v",
                "libx264",
                "-b:v",
                "1M",
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
                &output_file.display().to_string(),
                "-y",
            ])
            .spawn()
        {
            Ok(ok) => ok,
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
                    // read events such as stdout
                    while let Some(_) = rx.recv().await {
                        // println!("[event] {:?}", event);
                        // if let CommandEvent::Stdout(line) = event {
                        // println!("----{:?}----", line);
                        // }
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
