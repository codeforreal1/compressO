use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use tauri::Emitter;

use crate::core::domain::UpdateInfo;

#[tauri::command]
pub async fn check_update(app_handle: tauri::AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app_handle
        .updater()
        .map_err(|e| format!("Failed to get updater: {}", e))?;

    let current_version = app_handle.package_info().version.to_string();

    let response = match updater.check().await {
        Ok(Some(response)) => response,
        Ok(None) => {
            return Ok(UpdateInfo {
                is_update_available: false,
                current_version: current_version,
                latest_version: None,
                body: None,
                date: None,
            });
        }
        Err(e) => return Err(format!("Failed to check for updates: {}", e)),
    };

    let date_str = response.date.map(|d| d.to_string());

    // The changelog of every version since the installed one, as on GitHub; none when it cannot be
    // read (the app then links to the release on GitHub)
    let body = match fetch_release_notes(&app_handle.package_info().version, &response.version).await
    {
        Ok(notes) => Some(notes),
        Err(err) => {
            log::info!("[updater] The release notes could not be loaded: {}", err);
            None
        }
    };

    Ok(UpdateInfo {
        is_update_available: true,
        current_version: current_version,
        latest_version: Some(response.version.clone()),
        body,
        date: date_str,
    })
}

/// How long GitHub may take to send the changelog
const CHANGELOG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The sections of CHANGELOG.md (`### <version>`) of the versions after `current`, up to `latest`,
/// newest first. Read at the release's tag on GitHub, so notes written for later versions are not
/// shown yet.
async fn fetch_release_notes(current: &semver::Version, latest: &str) -> Result<String, String> {
    let latest_version = semver::Version::parse(latest).map_err(|err| err.to_string())?;
    // GitHub's API answers the file as it is (raw.githubusercontent.com can be very slow to reach
    // on some networks); it needs a User-Agent
    let url = format!(
        "https://api.github.com/repos/codeforreal1/compressO/contents/CHANGELOG.md?ref={}",
        latest
    );
    let changelog = reqwest::Client::builder()
        .timeout(CHANGELOG_TIMEOUT)
        .user_agent("CompressO")
        .build()
        .map_err(|err| err.to_string())?
        .get(url)
        .header("Accept", "application/vnd.github.raw")
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|err| err.to_string())?
        .text()
        .await
        .map_err(|err| err.to_string())?;

    let notes = release_notes_in(&changelog, current, &latest_version);
    if notes.is_empty() {
        return Err(format!("No notes for {} in the changelog", latest));
    }
    Ok(notes)
}

#[tauri::command]
pub async fn download_and_install_update(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    let updater = app_handle
        .updater()
        .map_err(|e| format!("Failed to get updater: {}", e))?;

    let response = updater
        .check()
        .await
        .map_err(|e| format!("Failed to check for update: {}", e))?
        .ok_or("No update available")?;

    let downloaded = AtomicUsize::new(0);
    let total_size = AtomicU64::new(0);
    let _bytes = response
        .download_and_install(
            &|chunk_length, content_length| {
                let prev = downloaded.fetch_add(chunk_length, Ordering::SeqCst);

                if total_size.load(Ordering::SeqCst) == 0 {
                    if let Some(len) = content_length {
                        total_size.store(len, Ordering::SeqCst);
                    }
                }

                let total = total_size.load(Ordering::SeqCst);
                if total > 0 {
                    let progress = ((prev as f64 / total as f64) * 100.0) as u32;
                    let _ = app_handle.emit("update-event", progress.to_string());
                }
            },
            &|| {
                let _ = app_handle.emit("update-event", "100");
            },
        )
        .await
        .map_err(|e| format!("Failed to download update: {}", e))?;
    Ok("Update downloaded and installed successfully.".to_string())
}

/// The sections (`### <version>`) of a changelog of the versions after `current`, up to `latest`,
/// newest first, joined
fn release_notes_in(
    changelog: &str,
    current: &semver::Version,
    latest_version: &semver::Version,
) -> String {
    let mut sections: Vec<String> = Vec::new();
    let mut is_in_range = false;
    for line in changelog.lines() {
        if let Some(heading) = line.strip_prefix("### ") {
            let version = heading
                .split_whitespace()
                .next()
                .and_then(|version| semver::Version::parse(version.trim_start_matches('v')).ok());
            is_in_range = version
                .map(|version| version > *current && version <= *latest_version)
                .unwrap_or(false);
            if is_in_range {
                sections.push(String::new());
            }
        }
        if is_in_range {
            if let Some(section) = sections.last_mut() {
                section.push_str(line);
                section.push('\n');
            }
        }
    }
    sections.sort_by_cached_key(|section| {
        std::cmp::Reverse(
            section
                .lines()
                .next()
                .and_then(|heading| heading.strip_prefix("### "))
                .and_then(|heading| heading.split_whitespace().next())
                .and_then(|version| semver::Version::parse(version.trim_start_matches('v')).ok()),
        )
    });
    let notes = sections
        .iter()
        .map(|section| section.trim())
        .collect::<Vec<_>>()
        .join("\n\n");
    notes
}




