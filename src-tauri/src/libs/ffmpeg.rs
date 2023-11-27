use std::path::PathBuf;

use tauri::api::process::Command;

use super::filesystem::create_cache_dir;

pub async fn compress(video_path: &str) -> Result<String, String> {
    let output_dir = create_cache_dir()?;

    let ffmpeg = match Command::new_sidecar("ffmpeg") {
        Ok(ok) => ok,
        Err(err) => {
            return Err(err.to_string());
        }
    };

    let output_file: PathBuf = [output_dir, PathBuf::from("didThisWork.mp4")].iter().collect();
    let (mut rx, _) = match ffmpeg.args(["-i", video_path, "-vcodec", "libx264", "-crf", " 28", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", &output_file.display().to_string(), "-y"]).spawn() {
        Ok(ok) => ok,
        Err(err) => {
            return Err(err.to_string());
        }
    };

    if let Err(err) = tauri::async_runtime::spawn(async move {
        // read events such as stdout
        while let Some(event) = rx.recv().await {
            println!("[event] {:?}", event);
            // if let CommandEvent::Stdout(line) = event {
            //     // println!("----{}----", line);
            // }
        }
    }).await {
        return Err(err.to_string());
    }

    Ok(String::from("Complete"))
}