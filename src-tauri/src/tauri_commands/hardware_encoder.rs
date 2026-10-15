use crate::core::hardware_encoder;

/// Turns compressing videos on the graphics card on or off (Settings -> Output)
#[tauri::command]
pub fn set_hardware_encoding_enabled(enabled: bool) {
    hardware_encoder::set_enabled(enabled);
}

/// The graphics card's video encoders that work on this computer (e.g. `h264_videotoolbox`), empty
/// without any
#[tauri::command]
pub async fn get_hardware_encoders(app: tauri::AppHandle) -> Vec<String> {
    hardware_encoder::available_encoders(&app)
        .await
        .iter()
        .map(|encoder| encoder.name.to_string())
        .collect()
}
