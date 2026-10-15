use crate::core::server::ServerState;

#[tauri::command]
pub fn get_server_url(state: tauri::State<ServerState>) -> Result<String, String> {
    Ok(format!("http://127.0.0.1:{}", state.port))
}

#[tauri::command]
pub fn construct_video_url(
    state: tauri::State<ServerState>,
    file_path: String,
) -> Result<String, String> {
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
