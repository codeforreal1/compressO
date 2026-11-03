//! Makes the `compresso` command available in terminals (Settings -> CLI): the command
//! line tool ships next to the app's executable as `compresso-cli` (`compresso` would clash with
//! `compressO` on file systems that ignore case), & is exposed as `compresso`:
//! - macOS: a symbolic link in `/usr/local/bin`, made with the administrator's approval
//! - Windows: a copy in the `bin` folder of the install folder, which is added to the user's PATH
//!   (the installer does the same, see `windows/hooks.nsh`)
//! - Linux: `/usr/bin/compresso` from the .deb package, or for an AppImage a script in
//!   `~/.local/bin` that runs the AppImage's command line (see `--cli` in `main.rs`)
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    /// `installed`, `notInstalled`, `broken` (pointing to a CompressO that was moved or removed),
    /// or `unavailable` (no command line next to the app, e.g. a development build without it)
    state: &'static str,
    /// Where the command is, or would be, installed
    path: Option<String>,
    /// Whether the app can install & remove it (otherwise its installer does)
    can_install: bool,
}

/// The command line tool next to the app's executable
pub fn bundled_cli() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = if cfg!(windows) {
        "compresso-cli.exe"
    } else {
        "compresso-cli"
    };
    let path = exe.parent()?.join(name);
    path.is_file().then_some(path)
}

fn install_status(state: &'static str, path: &Path, can_install: bool) -> CliInstallStatus {
    CliInstallStatus {
        state,
        path: Some(path.display().to_string()),
        can_install,
    }
}

fn unavailable() -> CliInstallStatus {
    CliInstallStatus {
        state: "unavailable",
        path: None,
        can_install: false,
    }
}

#[tauri::command]
pub fn get_cli_install_status() -> CliInstallStatus {
    platform::status()
}

#[tauri::command]
pub async fn install_cli() -> Result<CliInstallStatus, String> {
    tauri::async_runtime::spawn_blocking(platform::install)
        .await
        .map_err(|err| err.to_string())??;
    Ok(platform::status())
}

#[tauri::command]
pub async fn uninstall_cli() -> Result<CliInstallStatus, String> {
    tauri::async_runtime::spawn_blocking(platform::uninstall)
        .await
        .map_err(|err| err.to_string())??;
    Ok(platform::status())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::process::Command;

    const LINK: &str = "/usr/local/bin/compresso";

    pub fn status() -> CliInstallStatus {
        let link = Path::new(LINK);
        let Some(cli) = bundled_cli() else {
            return unavailable();
        };
        let Ok(target) = std::fs::read_link(link) else {
            return install_status(
                if link.exists() {
                    "broken"
                } else {
                    "notInstalled"
                },
                link,
                true,
            );
        };
        let is_ours = std::fs::canonicalize(&target).ok() == std::fs::canonicalize(&cli).ok();
        let state = if is_ours {
            "installed"
        } else if target.exists() {
            // Another copy of CompressO (e.g. in Downloads): installing points it to this one
            "notInstalled"
        } else {
            "broken"
        };
        install_status(state, link, true)
    }

    /// Text in an AppleScript string
    fn applescript_text(text: &str) -> String {
        text.replace('\\', "\\\\").replace('"', "\\\"")
    }

    /// Runs a shell command, asking for the administrator's approval when the folder needs it
    fn run_privileged(script: &str) -> Result<(), String> {
        let direct = Command::new("/bin/sh").arg("-c").arg(script).output();
        if direct.is_ok_and(|output| output.status.success()) {
            return Ok(());
        }
        let apple_script = format!(
            "do shell script \"{}\" with administrator privileges",
            applescript_text(script)
        );
        let output = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(apple_script)
            .output()
            .map_err(|err| err.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            let error = String::from_utf8_lossy(&output.stderr);
            // -128: the user cancelled the password prompt
            if error.contains("-128") {
                Err(String::from("CANCELLED"))
            } else {
                Err(error.trim().to_string())
            }
        }
    }

    /// A path quoted for the shell
    fn shell_quote(path: &Path) -> String {
        format!("'{}'", path.display().to_string().replace('\'', "'\\''"))
    }

    pub fn install() -> Result<(), String> {
        let cli = bundled_cli().ok_or("The command line tool is missing from the app")?;
        run_privileged(&format!(
            "mkdir -p /usr/local/bin && ln -sfn {} {LINK}",
            shell_quote(&cli)
        ))
    }

    pub fn uninstall() -> Result<(), String> {
        if std::fs::symlink_metadata(LINK).is_err() {
            return Ok(());
        }
        run_privileged(&format!("rm -f {LINK}"))
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// `CREATE_NO_WINDOW`: PowerShell runs without a console window
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// The `bin` folder of the install folder, added to the PATH
    fn bin_dir() -> Option<PathBuf> {
        Some(std::env::current_exe().ok()?.parent()?.join("bin"))
    }

    /// The user's PATH, as stored (not this process', which is from when it started)
    fn user_path() -> String {
        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "[Environment]::GetEnvironmentVariable('Path', 'User')",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .unwrap_or_default()
    }

    fn has_entry(path: &str, folder: &Path) -> bool {
        let folder = folder.display().to_string().to_lowercase();
        path.split(';')
            .any(|entry| entry.trim().trim_end_matches('\\').to_lowercase() == folder)
    }

    /// Sets the user's PATH (PowerShell tells running programs, e.g. Explorer, of the change)
    fn set_user_path(path: &str) -> Result<(), String> {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "[Environment]::SetEnvironmentVariable('Path', $env:COMPRESSO_PATH, 'User')",
            ])
            .env("COMPRESSO_PATH", path)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|err| err.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    pub fn status() -> CliInstallStatus {
        let (Some(_), Some(bin)) = (bundled_cli(), bin_dir()) else {
            return unavailable();
        };
        let command = bin.join("compresso.exe");
        let state = match (command.is_file(), has_entry(&user_path(), &bin)) {
            (true, true) => "installed",
            (false, false) => "notInstalled",
            _ => "broken",
        };
        install_status(state, &command, true)
    }

    pub fn install() -> Result<(), String> {
        let cli = bundled_cli().ok_or("The command line tool is missing from the app")?;
        let bin = bin_dir().ok_or("The install folder could not be found")?;
        std::fs::create_dir_all(&bin).map_err(|err| err.to_string())?;
        std::fs::copy(&cli, bin.join("compresso.exe")).map_err(|err| err.to_string())?;
        let path = user_path();
        if !has_entry(&path, &bin) {
            let entry = bin.display().to_string();
            let path = if path.is_empty() {
                entry
            } else {
                format!("{};{entry}", path.trim_end_matches(';'))
            };
            set_user_path(&path)?;
        }
        Ok(())
    }

    pub fn uninstall() -> Result<(), String> {
        let bin = bin_dir().ok_or("The install folder could not be found")?;
        let path = user_path();
        if has_entry(&path, &bin) {
            let folder = bin.display().to_string().to_lowercase();
            let kept: Vec<&str> = path
                .split(';')
                .filter(|entry| {
                    !entry.trim().is_empty()
                        && entry.trim().trim_end_matches('\\').to_lowercase() != folder
                })
                .collect();
            set_user_path(&kept.join(";"))?;
        }
        let _ = std::fs::remove_file(bin.join("compresso.exe"));
        let _ = std::fs::remove_dir(&bin);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    /// The .deb package's command (see `postinst` in `tauri.linux.conf.json`)
    const PACKAGE_COMMAND: &str = "/usr/bin/compresso";

    /// The AppImage this runs from, if any
    fn appimage() -> Option<PathBuf> {
        std::env::var_os("APPIMAGE").map(PathBuf::from)
    }

    /// `~/.local/bin/compresso`, for an AppImage
    fn script_path() -> Option<PathBuf> {
        Some(PathBuf::from(std::env::var_os("HOME")?).join(".local/bin/compresso"))
    }

    fn script(appimage: &Path) -> String {
        let quoted = appimage.display().to_string().replace('\'', "'\\''");
        format!("#!/bin/sh\n# The command line of CompressO (Settings > CLI)\nexec '{quoted}' --cli \"$@\"\n")
    }

    pub fn status() -> CliInstallStatus {
        if bundled_cli().is_none() {
            return unavailable();
        }
        let Some(appimage) = appimage() else {
            // Installed by the package
            let command = Path::new(PACKAGE_COMMAND);
            return install_status(
                if command.exists() {
                    "installed"
                } else {
                    "notInstalled"
                },
                command,
                false,
            );
        };
        let Some(path) = script_path() else {
            return unavailable();
        };
        let state = match std::fs::read_to_string(&path) {
            Ok(text) if text == script(&appimage) => "installed",
            Ok(_) => "broken",
            Err(_) => "notInstalled",
        };
        install_status(state, &path, true)
    }

    pub fn install() -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        let appimage = appimage().ok_or("Only the AppImage can install the command")?;
        let path = script_path().ok_or("The home folder could not be found")?;
        if let Some(directory) = path.parent() {
            std::fs::create_dir_all(directory).map_err(|err| err.to_string())?;
        }
        std::fs::write(&path, script(&appimage)).map_err(|err| err.to_string())?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|err| err.to_string())
    }

    pub fn uninstall() -> Result<(), String> {
        let path = script_path().ok_or("The home folder could not be found")?;
        match std::fs::remove_file(&path) {
            Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.to_string()),
            _ => Ok(()),
        }
    }
}
