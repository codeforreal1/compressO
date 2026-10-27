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

#[tauri::command]
pub fn construct_video_url(
    server: State<VideoServer>,
    file_path: String,
) -> Result<String, String> {
    let state = running_server(&server).ok_or("The video server is not running")?;

    let decoded_path: String = match urlencoding::decode(&file_path) {
        Ok(path) => path.into_owned(),
        Err(e) => {
            println!("Failed to decode file path: {}, using as-is", e);
            file_path.clone()
        }
    };

    let actual_path = if decoded_path.starts_with("asset://localhost/") {
        decoded_path
            .strip_prefix("asset://localhost/")
            .unwrap_or(&decoded_path)
    } else if decoded_path.starts_with("asset://") {
        decoded_path
            .strip_prefix("asset://")
            .unwrap_or(&decoded_path)
    } else {
        &decoded_path
    };

    let encoded_path = urlencoding::encode(actual_path);

    Ok(format!(
        "http://127.0.0.1:{}/video?token={}&path={}",
        state.port, state.token, encoded_path
    ))
}
