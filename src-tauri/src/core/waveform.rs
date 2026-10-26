//! Bounded, on-demand waveform chunks. FFmpeg decodes audio only; PCM never crosses IPC.
use crate::core::domain::CustomEvents;
use crate::core::ffprobe::FFPROBE;
use crate::core::media_process::MediaProcessExecutorBuilder;
use crate::utils::event::EventListenerGuard;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager};

const HZ: usize = 50;
const MAX_SECONDS: f64 = 300.0;
const MAX_POINTS: usize = HZ * MAX_SECONDS as usize * 101 / 100 + 1;
static WORKER: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static WRITES: AtomicUsize = AtomicUsize::new(0);

struct Peaks {
    sample_hz: f32,
    peak: u16,
    points: Vec<(u16, u16)>,
}

impl Default for Peaks {
    fn default() -> Self {
        Self {
            sample_hz: 50.0,
            peak: 0,
            points: Vec::new(),
        }
    }
}

fn amplitude(value: &str) -> u16 {
    value
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
        .map(|db| (10_f64.powf(db / 20.0).clamp(0.0, 1.0) * 65535.0).round() as u16)
        .unwrap_or(0)
}

impl Peaks {
    fn line(&mut self, line: &str) {
        if let Some(value) = line.trim().strip_prefix("lavfi.astats.Overall.Peak_level=") {
            self.peak = amplitude(value);
        } else if let Some(value) = line.trim().strip_prefix("lavfi.astats.Overall.RMS_level=") {
            if self.points.len() < MAX_POINTS {
                self.points.push((self.peak, amplitude(value)));
            }
        }
    }
    fn bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(16 + self.points.len() * 4);
        bytes.extend_from_slice(b"COWF");
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&(self.points.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&self.sample_hz.to_le_bytes());
        for (peak, rms) in &self.points {
            bytes.extend_from_slice(&peak.to_le_bytes());
            bytes.extend_from_slice(&rms.to_le_bytes());
        }
        bytes
    }
}

fn valid_cache(bytes: &[u8]) -> bool {
    bytes.len() >= 16
        && &bytes[..4] == b"COWF"
        && bytes[4..8] == 1_u32.to_le_bytes()
        && u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize <= MAX_POINTS
        && f32::from_le_bytes(bytes[12..16].try_into().unwrap()).is_finite()
        && f32::from_le_bytes(bytes[12..16].try_into().unwrap()) > 0.0
        && bytes.len() == 16 + u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize * 4
}

fn cache_key(path: &Path, track: u32, chunk: u32, seconds: f64) -> Result<String, String> {
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let identity = format!(
        "{}:{}:{}:{}:{}:{}",
        path.display(),
        metadata.len(),
        modified,
        track,
        chunk,
        seconds
    );
    Ok(format!("{:x}", Sha256::digest(identity.as_bytes())))
}

fn prune_cache(directory: &Path) {
    let mut entries: Vec<_> = std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()?.to_str()? != "bin" {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            Some((path, metadata.len(), metadata.modified().ok()?))
        })
        .collect();
    entries.sort_by_key(|entry| entry.2);
    let mut size: u64 = entries.iter().map(|entry| entry.1).sum();
    for (path, bytes, _) in entries {
        if size <= 64 * 1024 * 1024 {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            size = size.saturating_sub(bytes);
        }
    }
}

fn analysis_args(path: &str, track: u32, start: f64, seconds: f64, rate: u32) -> Vec<String> {
    // Statistics across channels avoid phase cancellation from a mono downmix. No resampling:
    // high-frequency content (including 192 kHz sources) still contributes to the envelope.
    let filter = format!("asetnsamples=n={}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level,ametadata=print:file=-", (rate / HZ as u32).max(1));
    [
        "-v".into(),
        "error".into(),
        "-threads".into(),
        "1".into(),
        "-ss".into(),
        start.to_string(),
        "-i".into(),
        path.into(),
        "-t".into(),
        seconds.to_string(),
        "-map".into(),
        format!("0:a:{track}"),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-filter_threads".into(),
        "1".into(),
        "-af".into(),
        filter,
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
    .into()
}

#[tauri::command]
pub async fn get_audio_waveform(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    track: u32,
    chunk: u32,
    chunk_seconds: f64,
    request_id: String,
) -> Result<tauri::ipc::Response, String> {
    if !chunk_seconds.is_finite()
        || chunk_seconds <= 0.0
        || chunk_seconds > MAX_SECONDS
        || chunk > 1_000_000
        || track > 1024
        || request_id.len() > 128
    {
        return Err("Invalid waveform request".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = cancelled.clone();
    let cancel_id = request_id.clone();
    let listener = app.listen_any(
        CustomEvents::CancelInProgressCompression.as_ref(),
        move |event| {
            let ids = serde_json::from_str::<serde_json::Value>(event.payload()).ok();
            if ids
                .as_ref()
                .and_then(|value| value.get("ids"))
                .and_then(|value| value.as_array())
                .map(|ids| ids.iter().any(|id| id.as_str() == Some(cancel_id.as_str())))
                .unwrap_or(false)
            {
                flag.store(true, Ordering::Relaxed);
            }
        },
    );
    let _listener = EventListenerGuard::for_app(app.clone(), listener);
    let _worker = WORKER.lock().await;
    if cancelled.load(Ordering::Relaxed) {
        return Err("CANCELLED".into());
    }
    let source = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("waveforms-v1");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let key = cache_key(&source, track, chunk, chunk_seconds)?;
    let cache = directory.join(format!("{key}.bin"));
    if cache
        .metadata()
        .map(|metadata| metadata.len() <= (16 + MAX_POINTS * 4) as u64)
        .unwrap_or(false)
    {
        if let Ok(bytes) = std::fs::read(&cache) {
            if valid_cache(&bytes) {
                return Ok(tauri::ipc::Response::new(bytes));
            }
        }
    }
    let streams = FFPROBE::new(&app)?
        .with_owner_window(window.label())
        .get_audio_streams(&path)
        .await?;
    let Some(stream) = streams.get(track as usize) else {
        return Ok(tauri::ipc::Response::new(Peaks::default().bytes()));
    };
    if cancelled.load(Ordering::Relaxed) {
        return Err("CANCELLED".into());
    }
    let rate = stream.sample_rate.parse::<u32>().unwrap_or(48000);
    let peaks = Arc::new(Mutex::new(Peaks {
        sample_hz: rate as f32 / (rate / HZ as u32).max(1) as f32,
        ..Peaks::default()
    }));
    let output = peaks.clone();
    let mut command = super::tool_bundle::command(&app, "ffmpeg")?;
    command.args(analysis_args(
        &path,
        track,
        chunk as f64 * chunk_seconds,
        chunk_seconds,
        rate,
    ));
    let result = MediaProcessExecutorBuilder::new(app.clone())
        .owner_window(window.label())
        .command(command)
        .with_cancel_support(vec![request_id], None)
        .with_stdout_callback(Arc::new(move |_, line| {
            if let Ok(mut peaks) = output.lock() {
                peaks.line(&line);
            }
        }))
        .build()?
        .spawn_and_wait()
        .await?;
    if cancelled.load(Ordering::Relaxed) {
        return Err("CANCELLED".into());
    }
    if !result.success() {
        return Err("Waveform analysis failed".into());
    }
    // A replacement at the same path must never inherit the previous file's waveform.
    if cache_key(&source, track, chunk, chunk_seconds)? != key {
        return Err("Source changed".into());
    }
    let bytes = peaks.lock().map_err(|e| e.to_string())?.bytes();
    let temporary = directory.join(format!("{key}.{}.tmp", nanoid::nanoid!()));
    if std::fs::write(&temporary, &bytes)
        .and_then(|_| std::fs::rename(&temporary, &cache))
        .is_err()
    {
        let _ = std::fs::remove_file(&temporary);
    }
    if WRITES.fetch_add(1, Ordering::Relaxed) % 32 == 0 {
        prune_cache(&directory);
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelope_keeps_peaks_and_silence_in_a_bounded_binary_buffer() {
        let mut peaks = Peaks::default();
        for _ in 0..MAX_POINTS + 5 {
            peaks.line("lavfi.astats.Overall.Peak_level=0");
            peaks.line("lavfi.astats.Overall.RMS_level=-inf");
        }
        assert_eq!(peaks.points.len(), MAX_POINTS);
        assert_eq!(peaks.points[0], (u16::MAX, 0));
        assert!(valid_cache(&peaks.bytes()));
        assert!(!valid_cache(b"bad cache"));
        assert_eq!(amplitude("nan"), 0);
    }
    #[test]
    fn bundled_ffmpeg_preserves_high_frequency_audio_and_channel_energy() {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let ffmpeg = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join(format!(
                "compresso_ffmpeg-{}{}",
                env!("COMPRESSO_TARGET"),
                suffix
            ));
        for (source, rate, silent) in [
            ("anullsrc=r=48000:cl=stereo:d=0.5", 48000, true),
            (
                "sine=frequency=1000:sample_rate=44100:duration=0.5",
                44100,
                false,
            ),
            (
                "sine=frequency=40000:sample_rate=192000:duration=0.5",
                192000,
                false,
            ),
            (
                "aevalsrc=0.5*sin(2*PI*1000*t)|-0.5*sin(2*PI*1000*t):s=48000:d=0.5",
                48000,
                false,
            ),
        ] {
            let mut args = analysis_args(source, 0, 0.0, 0.5, rate);
            let input = args.iter().position(|arg| arg == "-i").unwrap();
            args.splice(input..input, ["-f".into(), "lavfi".into()]);
            let result = std::process::Command::new(&ffmpeg)
                .args(args)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            let mut peaks = Peaks::default();
            for line in String::from_utf8_lossy(&result.stdout).lines() {
                peaks.line(line);
            }
            assert!(
                (24..=26).contains(&peaks.points.len()),
                "{} points",
                peaks.points.len()
            );
            if silent {
                assert!(peaks.points.iter().all(|point| *point == (0, 0)));
            } else {
                assert!(peaks
                    .points
                    .iter()
                    .all(|(peak, rms)| *peak > 1000 && *rms > 100));
            }
        }
    }

    #[test]
    fn replacing_a_file_or_switching_track_invalidates_its_cache_key() {
        let path = std::env::temp_dir().join(format!("waveform-key-{}", nanoid::nanoid!()));
        std::fs::write(&path, b"first").unwrap();
        let key = cache_key(&path, 0, 0, 30.0).unwrap();
        assert_ne!(key, cache_key(&path, 1, 0, 30.0).unwrap());
        assert_ne!(key, cache_key(&path, 0, 1, 30.0).unwrap());
        std::fs::write(&path, b"replacement").unwrap();
        assert_ne!(key, cache_key(&path, 0, 0, 30.0).unwrap());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn ffmpeg_reads_only_the_requested_audio_window() {
        let args = analysis_args("video.mp4", 2, 90.0, 30.0, 192000);
        assert!(args.windows(2).any(|pair| pair == ["-map", "0:a:2"]));
        assert!(args.windows(2).any(|pair| pair == ["-ss", "90"]));
        assert!(args.iter().any(|arg| arg.contains("asetnsamples=n=3840")));
        assert!(!args.iter().any(|arg| arg == "-ac" || arg == "-ar"));
    }
}
