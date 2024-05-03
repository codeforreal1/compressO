use nanoid::nanoid;
use std::path::PathBuf;
use tauri::api::process::Command;

use crate::domain::CompressionResult;

use super::filesystem::create_cache_dir;

pub async fn compress(video_path: &str) -> Result<CompressionResult, String> {
    let output_dir = create_cache_dir()?;

    let ffmpeg = match Command::new_sidecar("ffmpeg") {
        Ok(ok) => ok,
        Err(err) => {
            return Err(err.to_string());
        }
    };

    let file_name = format!("{}.mp4", nanoid!());
    let output_file: PathBuf = [output_dir, PathBuf::from(&file_name)].iter().collect();

    // [
    //         "-i",
    //         video_path,
    //         "-pix_fmt",
    //         "yuv420p",
    //         "-c:v",
    //         "libx264",
    //         "-b:v",
    //         "1M",
    //         "-movflags",
    //         "+faststart",
    //         "-preset",
    //         "slow",
    //         "-qp",
    //         "0",
    //         "-crf",
    //         "32",
    //         "-vf",
    //         "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    //         &output_file.display().to_string(),
    //         "-y",
    //     ]

    // [
    //         "-i",
    //         video_path,
    //         "-vcodec",
    //         "libx264",
    //         "-crf",
    //         " 28",
    //         "-vf",
    //         "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    //         &output_file.display().to_string(),
    //         "-y",
    //     ]
    let (mut rx, _) = match ffmpeg
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

    if let Err(err) = tauri::async_runtime::spawn(async move {
        // read events such as stdout
        while let Some(event) = rx.recv().await {
            println!("[event] {:?}", event);
        }
    })
    .await
    {
        return Err(err.to_string());
    }

    Ok(CompressionResult {
        file_name,
        output_path: output_file.display().to_string(),
    })
}
