use tauri::{AppHandle, State};

use crate::core::server::{self, ServerState, VideoServer};

/// The running server's state, if it was started
fn running_server(server: &VideoServer) -> Option<ServerState> {
    server.0.lock().ok().and_then(|state| state.clone())
}

/// Starts the video server, if it is not running yet, and returns its URL. Only called with video
/// previews on (Settings -> General), when the app starts.
#[tauri::command]
pub async fn start_video_server(
    app: AppHandle,
    server: State<'_, VideoServer>,
) -> Result<String, String> {
    if let Some(state) = running_server(&server) {
        return Ok(format!("http://127.0.0.1:{}", state.port));
    }

    let started = server::start_server(app)
        .await
        .map_err(|e| format!("Failed to start the video server: {}", e))?;

    let mut state = server.0.lock().map_err(|e| e.to_string())?;
    // Started meanwhile by another call: that one is kept
    if let Some(existing) = state.as_ref() {
        server::shutdown_server(&started);
        return Ok(format!("http://127.0.0.1:{}", existing.port));
    }
    let url = format!("http://127.0.0.1:{}", started.port);
    *state = Some(started);
    Ok(url)
}

fn extract_asset_file_path(file_path: &str) -> String {
    let without_query = file_path.split('?').next().unwrap_or(file_path);
    let decoded_path: String = match urlencoding::decode(without_query) {
        Ok(path) => path.into_owned(),
        Err(e) => {
            println!("Failed to decode file path: {}, using as-is", e);
            without_query.to_string()
        }
    };

    [
        "asset://localhost/",
        "asset://",
        "http://asset.localhost/",
        "https://asset.localhost/",
    ]
    .iter()
    .find_map(|prefix| decoded_path.strip_prefix(prefix))
    .unwrap_or(&decoded_path)
    .to_string()
}

#[tauri::command]
pub fn construct_video_url(
    server: State<VideoServer>,
    file_path: String,
) -> Result<String, String> {
    let state = running_server(&server).ok_or("The video server is not running")?;
    let actual_path = extract_asset_file_path(&file_path);
    let encoded_path = urlencoding::encode(&actual_path);

    Ok(format!(
        "http://127.0.0.1:{}/video?token={}&path={}",
        state.port, state.token, encoded_path
    ))
}

#[cfg(test)]
mod tests {
    use super::extract_asset_file_path;

    #[test]
    fn extracts_paths_from_tauri_asset_urls_across_schemes() {
        assert_eq!(
            extract_asset_file_path("asset://localhost/%2FUsers%2Fa%2Fclip.mp4"),
            "/Users/a/clip.mp4"
        );
        assert_eq!(
            extract_asset_file_path("http://asset.localhost/%2Fmedia%2FVMPal%2Fmy%20clip.mp4?v=1"),
            "/media/VMPal/my clip.mp4"
        );
        assert_eq!(
            extract_asset_file_path("https://asset.localhost/%2Ftmp%2Fwhat%3F.mp4?v=123"),
            "/tmp/what?.mp4"
        );
        assert_eq!(
            extract_asset_file_path("/home/user/video.mp4"),
            "/home/user/video.mp4"
        );
    }
}
