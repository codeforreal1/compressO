#[cfg(target_os = "linux")]
use std::sync::Mutex;
#[cfg(target_os = "linux")]
use tauri::State;

#[cfg(target_os = "linux")]
pub struct DbusState(pub Mutex<Option<dbus::blocking::SyncConnection>>);

#[cfg(target_os = "linux")]
#[tauri::command]
pub fn show_item_in_file_manager(path: String, dbus_state: State<DbusState>) -> Result<(), String> {
    use std::time::Duration;

    let dbus_guard = dbus_state.0.lock().map_err(|e| e.to_string())?;
    // Selects the item in the file manager (FileManager1, which most Linux file managers provide).
    // The path goes as a file URL, encoded (spaces, `#`, `%`...), or the file manager cannot find
    // the item and keeps its earlier selection.
    if let (Some(dbus), Ok(url)) = (dbus_guard.as_ref(), tauri::Url::from_file_path(&path)) {
        let proxy = dbus.with_proxy(
            "org.freedesktop.FileManager1",
            "/org/freedesktop/FileManager1",
            Duration::from_secs(5),
        );
        // `ShowItems` answers with nothing
        let shown: Result<(), dbus::Error> = proxy.method_call(
            "org.freedesktop.FileManager1",
            "ShowItems",
            (vec![url.to_string()], ""),
        );
        if shown.is_ok() {
            return Ok(());
        }
    }
    // Without it, the folder holding the item is opened
    open_containing_folder(&path)
}

/// Opens the folder holding `path` (or `path` itself, a folder) in the file manager
#[cfg(target_os = "linux")]
fn open_containing_folder(path: &str) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(path);
    let folder = if path_buf.is_dir() {
        path_buf
    } else {
        path_buf
            .parent()
            .map(|parent| parent.to_path_buf())
            .ok_or_else(|| format!("No folder holds {path}"))?
    };
    std::process::Command::new("xdg-open")
        .arg(folder)
        .spawn()
        .map_err(|e| format!("{e:?}"))?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
pub fn show_item_in_file_manager(path: String) -> Result<(), String> {
    use std::{path::PathBuf, process::Command};
    #[cfg(target_os = "windows")]
    {
        // Explorer only understands backslashes: with a forward slash (saved paths are joined with
        // `/`), it opens its default folder instead of selecting the file
        let path = path.replace('/', "\\");
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let path_buf = PathBuf::from(&path);
        if path_buf.is_dir() {
            Command::new("open")
                .args([&path])
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
