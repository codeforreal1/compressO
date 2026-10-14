use std::io::Cursor;

use rodio::{Decoder, OutputStream, Sink};

/// Played when a compression completes (embedded, so it needs no file at runtime)
const COMPLETION_SOUND: &[u8] = include_bytes!("../../../src/assets/sounds/chime.wav");

/// Plays the completion sound. Played by the backend, so it also plays while the main window is
/// hidden (e.g. compressing in the background), where a webview might not play sounds.
#[tauri::command]
pub fn play_completion_sound() {
    // The output stream must live until the sound ends, so it is played on its own thread
    std::thread::spawn(|| {
        let result = (|| -> Result<(), String> {
            let (_stream, stream_handle) =
                OutputStream::try_default().map_err(|err| err.to_string())?;
            let sink = Sink::try_new(&stream_handle).map_err(|err| err.to_string())?;
            let source =
                Decoder::new(Cursor::new(COMPLETION_SOUND)).map_err(|err| err.to_string())?;
            sink.append(source);
            sink.sleep_until_end();
            Ok(())
        })();
        if let Err(err) = result {
            log::error!("Failed to play the completion sound: {}", err);
        }
    });
}
