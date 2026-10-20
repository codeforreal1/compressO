//! Fingerprints of the outputs the app made, so a watched folder never compresses one again, even
//! renamed, moved or copied (see `watch_folders`). A fingerprint is the SHA-256 of a file's size &
//! of its first & last megabyte: as unique as a full hash for media outputs, & instant even for
//! large videos. They are kept in the app's data folder (the latest ones, up to a limit).

use std::collections::VecDeque;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// How much of the start & of the end of a file is hashed
const SAMPLE_BYTES: u64 = 1024 * 1024;

/// The most fingerprints kept (the oldest are dropped)
const MAX_FINGERPRINTS: usize = 20_000;

const FILE_NAME: &str = "output-fingerprints.json";

/// The fingerprints, loaded from the data folder the first time they are used
static FINGERPRINTS: Mutex<Option<VecDeque<String>>> = Mutex::new(None);

/// The fingerprint of a file (`None` when it cannot be read)
pub fn fingerprint(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());

    let mut buffer = vec![0u8; SAMPLE_BYTES.min(size) as usize];
    file.read_exact(&mut buffer).ok()?;
    hasher.update(&buffer);
    if size > SAMPLE_BYTES {
        let tail = SAMPLE_BYTES.min(size - SAMPLE_BYTES);
        file.seek(SeekFrom::End(-(tail as i64))).ok()?;
        let mut buffer = vec![0u8; tail as usize];
        file.read_exact(&mut buffer).ok()?;
        hasher.update(&buffer);
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn store_path(app_handle: &AppHandle) -> Option<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME))
}

/// Runs `use_fingerprints` with the fingerprints (loaded first if needed)
fn with_fingerprints<T>(
    app_handle: &AppHandle,
    use_fingerprints: impl FnOnce(&mut VecDeque<String>) -> T,
) -> Option<T> {
    let mut fingerprints = FINGERPRINTS.lock().ok()?;
    let fingerprints = fingerprints.get_or_insert_with(|| {
        store_path(app_handle)
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<VecDeque<String>>(&text).ok())
            .unwrap_or_default()
    });
    Some(use_fingerprints(fingerprints))
}

/// Remembers an output the app made (e.g. once compressed, & once saved)
pub fn remember(app_handle: &AppHandle, path: &Path) {
    let Some(fingerprint) = fingerprint(path) else {
        return;
    };
    let stored = with_fingerprints(app_handle, |fingerprints| {
        if fingerprints.contains(&fingerprint) {
            return None;
        }
        fingerprints.push_back(fingerprint);
        while fingerprints.len() > MAX_FINGERPRINTS {
            fingerprints.pop_front();
        }
        serde_json::to_string(fingerprints).ok()
    })
    .flatten();
    if let (Some(text), Some(path)) = (stored, store_path(app_handle)) {
        if let Err(err) = std::fs::write(&path, text) {
            log::warn!("[output-registry] Could not save the fingerprints: {}", err);
        }
    }
}

/// Whether a file is an output the app made (under any name or in any folder)
pub fn is_output(app_handle: &AppHandle, path: &Path) -> bool {
    let Some(fingerprint) = fingerprint(path) else {
        return false;
    };
    with_fingerprints(app_handle, |fingerprints| fingerprints.contains(&fingerprint))
        .unwrap_or(false)
}
