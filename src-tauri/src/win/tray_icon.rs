//! The Windows tray icon, drawn in code: the "C" of the logo filling the icon, or, while
//! compressing, smaller inside a ring that fills clockwise with the progress (Windows has no text
//! beside tray icons, unlike the macOS menu bar). Like Windows' own tray icons, the logo is white on
//! a dark taskbar & near-black on a light one; the ring fills in the app's accent color. Drawn at the size Windows shows tray icons at, so it
//! stays sharp at any display scaling.

use std::{
    sync::{Mutex, Once, OnceLock},
    time::Duration,
};

use image::{
    imageops::{self, FilterType},
    GrayImage, Luma,
};
use tauri::{image::Image, AppHandle, Manager};

use crate::tray_popover::TRAY_WINDOW_LABEL;

/// Drawn this many times larger, then scaled down, for smooth edges
const SUPERSAMPLING: u32 = 4;
/// The ring is redrawn in steps of this many percent
const PROGRESS_STEP: u32 = 5;
/// The icon's color on a dark & on a light taskbar
const ON_DARK_TASKBAR: [f32; 3] = [255.0, 255.0, 255.0];
const ON_LIGHT_TASKBAR: [f32; 3] = [28.0, 28.0, 28.0];
/// The opacity of the ring's unfilled part
const TRACK_OPACITY: f32 = 0.3;
/// The ring's filled part: the app's accent color (Settings -> General -> Accent color), set by the
/// frontend (see `set_progress_color`); the default until then
static PROGRESS_COLOR: Mutex<[f32; 3]> = Mutex::new([255.0, 132.0, 0.0]);
/// How often the taskbar's light or dark mode is checked, to recolor the icon when it changes
const THEME_CHECK_INTERVAL: Duration = Duration::from_secs(2);

/// What the icon shows: the progress step (`None` for the plain icon) & whether the taskbar is dark
#[derive(Clone, Copy, PartialEq)]
struct Shown {
    step: Option<u32>,
    is_dark: bool,
}

static SHOWN: Mutex<Option<Shown>> = Mutex::new(None);

/// The plain icon (no progress), e.g. for a new tray icon
pub fn plain_icon() -> Image<'static> {
    let shown = Shown {
        step: None,
        is_dark: crate::win::theme::taskbar_uses_dark_mode(),
    };
    if let Ok(mut current) = SHOWN.lock() {
        *current = Some(shown);
    }
    render(shown)
}

/// The icon for a progress from 0 to 100 (0 for the plain icon), if it differs from the one shown
pub fn icon_for_progress(progress: f64) -> Option<Image<'static>> {
    let step = (progress > 0.0)
        .then(|| progress.round().clamp(0.0, 100.0) as u32 / PROGRESS_STEP * PROGRESS_STEP);
    let mut current = SHOWN.lock().ok()?;
    let shown = Shown {
        step,
        is_dark: current
            .map(|shown| shown.is_dark)
            .unwrap_or_else(crate::win::theme::taskbar_uses_dark_mode),
    };
    if *current == Some(shown) {
        return None;
    }
    *current = Some(shown);
    Some(render(shown))
}

/// Sets the ring's filled color (the app's accent color), redrawing the icon if it shows progress
pub fn set_progress_color(app_handle: &AppHandle, rgb: [u8; 3]) {
    if let Ok(mut color) = PROGRESS_COLOR.lock() {
        *color = rgb.map(f32::from);
    }
    let Some(shown) = SHOWN.lock().ok().and_then(|current| *current) else {
        return;
    };
    if shown.step.is_none() {
        return;
    }
    if let Some(tray) = app_handle.tray_by_id(TRAY_WINDOW_LABEL) {
        let _ = tray.set_icon(Some(render(shown)));
    }
}

/// Recolors the tray icon when the taskbar switches between light & dark mode (checked every few
/// seconds; reading the setting is cheap). Started once.
pub fn watch_taskbar_theme(app_handle: &AppHandle) {
    static STARTED: Once = Once::new();
    let app_handle = app_handle.clone();
    STARTED.call_once(|| {
        std::thread::spawn(move || loop {
            std::thread::sleep(THEME_CHECK_INTERVAL);
            let is_dark = crate::win::theme::taskbar_uses_dark_mode();
            let shown = {
                let Ok(mut current) = SHOWN.lock() else {
                    continue;
                };
                let Some(shown) = current.filter(|shown| shown.is_dark != is_dark) else {
                    continue;
                };
                let shown = Shown { is_dark, ..shown };
                *current = Some(shown);
                shown
            };
            if let Some(tray) = app_handle.tray_by_id(TRAY_WINDOW_LABEL) {
                let _ = tray.set_icon(Some(render(shown)));
            }
        });
    });
}

/// The size Windows shows tray icons at (16 pixels at 100% display scaling)
fn icon_size() -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};

    let size = unsafe { GetSystemMetrics(SM_CXSMICON) };
    if size > 0 {
        size as u32
    } else {
        16
    }
}

/// The "C" of the logo (the macOS menu bar icon's shape), as its coverage, cropped to it
fn logo_mask() -> &'static GrayImage {
    static MASK: OnceLock<GrayImage> = OnceLock::new();
    MASK.get_or_init(|| {
        let Ok(image) = image::load_from_memory(include_bytes!("../../icons/tray.png")) else {
            return GrayImage::new(1, 1);
        };
        let image = image.to_rgba8();
        let mask = GrayImage::from_fn(image.width(), image.height(), |x, y| {
            Luma([image.get_pixel(x, y)[3]])
        });
        // Cropped to the shape, so it is sized by its own bounds
        let (mut left, mut top, mut right, mut bottom) = (mask.width(), mask.height(), 0, 0);
        for (x, y, pixel) in mask.enumerate_pixels() {
            if pixel[0] > 0 {
                left = left.min(x);
                top = top.min(y);
                right = right.max(x);
                bottom = bottom.max(y);
            }
        }
        if right < left || bottom < top {
            return mask;
        }
        imageops::crop_imm(&mask, left, top, right - left + 1, bottom - top + 1).to_image()
    })
}

/// The icon: the plain logo, or the logo inside a ring filled to the progress step
fn render(shown: Shown) -> Image<'static> {
    let progress = shown.step;
    let color = if shown.is_dark {
        ON_DARK_TASKBAR
    } else {
        ON_LIGHT_TASKBAR
    };
    let progress_color = PROGRESS_COLOR
        .lock()
        .map(|color| *color)
        .unwrap_or([255.0, 132.0, 0.0]);
    let size = icon_size();
    let canvas = size * SUPERSAMPLING;
    let center = canvas as f32 / 2.0;
    // Premultiplied color, & opacity from 0 to 1
    let mut pixels = vec![([0f32; 3], 0f32); (canvas * canvas) as usize];

    // The ring, filled clockwise from the top
    let ring_width = (size as f32 * 0.12).max(2.0) * SUPERSAMPLING as f32;
    let outer_radius = center;
    let inner_radius = outer_radius - ring_width;
    if let Some(progress) = progress {
        let filled = progress as f32 / 100.0;
        for y in 0..canvas {
            for x in 0..canvas {
                let dx = x as f32 + 0.5 - center;
                let dy = y as f32 + 0.5 - center;
                let distance = (dx * dx + dy * dy).sqrt();
                if distance < inner_radius || distance > outer_radius {
                    continue;
                }
                // 0 at the top, growing clockwise
                let mut angle = dx.atan2(-dy);
                if angle < 0.0 {
                    angle += std::f32::consts::TAU;
                }
                // The filled part in the accent color, the rest faint in the logo's color
                let (ring_color, opacity) = if angle / std::f32::consts::TAU <= filled {
                    (progress_color, 1.0)
                } else {
                    (color, TRACK_OPACITY)
                };
                pixels[(y * canvas + x) as usize] = (ring_color.map(|c| c * opacity), opacity);
            }
        }
    }

    // The logo: filling the icon, or inside the ring with a gap
    let mask = logo_mask();
    let aspect = mask.width() as f32 / mask.height().max(1) as f32;
    let logo_height = match progress {
        None => canvas as f32 * 0.94,
        Some(_) => {
            let radius = inner_radius - ring_width * 0.35;
            // Its open side leaves its corners empty, so it can be a little larger than the
            // square that fits the circle
            2.0 * radius / (1.0 + aspect * aspect).sqrt() * 1.3
        }
    };
    let logo_width = (logo_height * aspect).round().max(1.0) as u32;
    let logo_height = logo_height.round().max(1.0) as u32;
    let logo = imageops::resize(mask, logo_width, logo_height, FilterType::Triangle);
    let left = (canvas.saturating_sub(logo_width)) / 2;
    let top = (canvas.saturating_sub(logo_height)) / 2;
    for (x, y, coverage) in logo.enumerate_pixels() {
        let opacity = coverage[0] as f32 / 255.0;
        if opacity <= 0.0 {
            continue;
        }
        let (canvas_x, canvas_y) = (left + x, top + y);
        if canvas_x >= canvas || canvas_y >= canvas {
            continue;
        }
        let pixel = &mut pixels[(canvas_y * canvas + canvas_x) as usize];
        *pixel = (
            [0, 1, 2].map(|i| color[i] * opacity + pixel.0[i] * (1.0 - opacity)),
            opacity + pixel.1 * (1.0 - opacity),
        );
    }

    // Scaled down: each pixel the average of the drawn ones it covers
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    let samples = (SUPERSAMPLING * SUPERSAMPLING) as f32;
    for y in 0..size {
        for x in 0..size {
            let (mut color, mut opacity) = ([0f32; 3], 0f32);
            for sample_y in 0..SUPERSAMPLING {
                for sample_x in 0..SUPERSAMPLING {
                    let index = (y * SUPERSAMPLING + sample_y) * canvas + x * SUPERSAMPLING + sample_x;
                    let pixel = pixels[index as usize];
                    for i in 0..3 {
                        color[i] += pixel.0[i];
                    }
                    opacity += pixel.1;
                }
            }
            let opacity = opacity / samples;
            for channel in color {
                let value = if opacity > 0.0 {
                    channel / samples / opacity
                } else {
                    0.0
                };
                rgba.push(value.round().clamp(0.0, 255.0) as u8);
            }
            rgba.push((opacity * 255.0).round().clamp(0.0, 255.0) as u8);
        }
    }
    Image::new_owned(rgba, size, size)
}
