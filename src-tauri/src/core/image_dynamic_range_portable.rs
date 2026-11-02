//! Image HDR without Core Image: Windows, Linux & macOS before 15 (see
//! `docs/image-dynamic-range.md`). Detection reads the file's own signaling; HDR Boost & Remove HDR
//! are done on the decoded pixels with the same transfer functions & tone mapping as videos (see
//! `video_dynamic_range.rs`), into the 16-bit PNG intermediate the encoders already take (HDR PNG
//! & JPEG XL keep its PQ signaling). HDR JPEG (gain map) export needs Core Image.

use std::fs;

use image::{DynamicImage, ImageBuffer, ImageDecoder, ImageReader, Rgb, Rgba};
use img_parts::{png::Png, Bytes, DynImage, ImageEXIF, ImageICC};

use super::image_dynamic_range::{
    DynamicRange, ImageDynamicRangeConfig, ImageDynamicRangeInfo, ImageDynamicRangeMode,
    MAX_BOOST_INTENSITY,
};

/// SDR white is placed at this many nits for HDR Boost (ITU-R BT.2408), as for videos
const REFERENCE_WHITE_NITS: f32 = 203.0;

/// SDR white when tone mapping HDR to SDR, as for videos
const SDR_WHITE_NITS: f32 = 100.0;

/// The peak FFmpeg's `tonemap` assumes for HDR without metadata (reaches SDR white)
const TONE_MAP_PEAK_NITS: f32 = 1000.0;

/// HLG's nominal peak (ITU-R BT.2100), with its system gamma of 1.2
const HLG_PEAK_NITS: f32 = 1000.0;

/// Markers of a gain map (Adobe/Google `hdrgm`, ISO 21496-1, Apple's auxiliary image)
const GAIN_MAP_MARKERS: [&[u8]; 4] = [
    b"http://ns.adobe.com/hdr-gain-map/1.0/",
    b"urn:iso:std:iso:ts:21496:-1",
    b"urn:com:apple:photo:2020:aux:hdrgainmap",
    b"HDRGainMap",
];

#[derive(Clone, Copy, Debug, PartialEq)]
enum Primaries {
    Bt709,
    DisplayP3,
    Bt2020,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Transfer {
    Pq,
    Hlg,
}

/// What a file says about its colour, from its bytes
#[derive(Clone, Copy, Debug, PartialEq)]
struct SourceColor {
    primaries: Primaries,
    hdr: Option<Transfer>,
    has_gain_map: bool,
    is_animated: bool,
}

fn contains(bytes: &[u8], needle: &[u8]) -> bool {
    bytes.windows(needle.len()).any(|window| window == needle)
}

/// Whether an ICC profile's text (its description, ASCII or UTF-16) has `text`
fn icc_has_text(icc: &[u8], text: &str) -> bool {
    let utf16: Vec<u8> = text.bytes().flat_map(|byte| [0, byte]).collect();
    contains(icc, text.as_bytes()) || contains(icc, &utf16)
}

fn primaries_from_icc(icc: &[u8]) -> Option<Primaries> {
    if icc_has_text(icc, "Display P3") || icc_has_text(icc, "P3-D65") {
        Some(Primaries::DisplayP3)
    } else if icc_has_text(icc, "2020") || icc_has_text(icc, "2100") {
        Some(Primaries::Bt2020)
    } else {
        None
    }
}

fn source_color(bytes: &[u8]) -> SourceColor {
    let mut color = SourceColor {
        primaries: Primaries::Bt709,
        hdr: None,
        has_gain_map: false,
        is_animated: false,
    };
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        if let Ok(png) = Png::from_bytes(Bytes::copy_from_slice(bytes)) {
            for chunk in png.chunks() {
                let contents = chunk.contents();
                match &chunk.kind() {
                    b"acTL" => color.is_animated = true,
                    // Colour primaries, transfer, matrix (0: RGB), full range (ITU-T H.273)
                    b"cICP" if contents.len() >= 2 => {
                        color.primaries = match contents[0] {
                            9 => Primaries::Bt2020,
                            12 => Primaries::DisplayP3,
                            _ => Primaries::Bt709,
                        };
                        color.hdr = match contents[1] {
                            16 => Some(Transfer::Pq),
                            18 => Some(Transfer::Hlg),
                            _ => None,
                        };
                        return color;
                    }
                    _ => {}
                }
            }
            if let Some(icc) = png.icc_profile() {
                color.primaries = primaries_from_icc(&icc).unwrap_or(color.primaries);
                // e.g. "ITU-R BT.2100 PQ" (only in the text, as curve data could hold any bytes)
                if icc_has_text(&icc, "2100") {
                    if icc_has_text(&icc, "PQ") {
                        color.hdr = Some(Transfer::Pq);
                    } else if icc_has_text(&icc, "HLG") {
                        color.hdr = Some(Transfer::Hlg);
                    }
                }
            }
        }
        return color;
    }
    if bytes.starts_with(&[0xFF, 0xD8]) {
        color.has_gain_map = GAIN_MAP_MARKERS
            .iter()
            .any(|marker| contains(bytes, marker));
    }
    if let Ok(Some(image)) = DynImage::from_bytes(Bytes::copy_from_slice(bytes)) {
        if let Some(icc) = image.icc_profile() {
            color.primaries = primaries_from_icc(&icc).unwrap_or(color.primaries);
        }
    }
    color
}

fn is_multi_frame(path: &str) -> bool {
    let Ok(reader) = ImageReader::open(path).and_then(|reader| reader.with_guessed_format())
    else {
        return false;
    };
    match reader.format() {
        Some(image::ImageFormat::Gif) => fs::File::open(path)
            .ok()
            .and_then(|file| image::codecs::gif::GifDecoder::new(std::io::BufReader::new(file)).ok())
            .is_some_and(|decoder| {
                use image::AnimationDecoder;
                decoder.into_frames().take(2).count() > 1
            }),
        Some(image::ImageFormat::WebP) => fs::File::open(path)
            .ok()
            .and_then(|file| {
                image::codecs::webp::WebPDecoder::new(std::io::BufReader::new(file)).ok()
            })
            .is_some_and(|decoder| decoder.has_animation()),
        _ => false,
    }
}

/// The dynamic range of an image the `image` crate decodes (JPEG XL & HEIC are decoded to PNG
/// first, see `image_dynamic_range::inspect_source`); others are unknown
pub fn inspect(path: &str) -> Result<ImageDynamicRangeInfo, String> {
    let unknown = ImageDynamicRangeInfo {
        supported: true,
        ..Default::default()
    };
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let color = source_color(&bytes);
    let decodable = ImageReader::open(path)
        .and_then(|reader| reader.with_guessed_format())
        .is_ok_and(|reader| reader.format().is_some());
    if !decodable || color.is_animated || is_multi_frame(path) {
        return Ok(unknown);
    }
    Ok(ImageDynamicRangeInfo {
        supported: true,
        dynamic_range: if color.hdr.is_some() || color.has_gain_map {
            DynamicRange::Hdr
        } else {
            DynamicRange::Sdr
        },
        has_gain_map: color.has_gain_map,
        supports_hdr_jpeg: false,
    })
}

// Linear-light RGB conversions between primaries (D65)
const BT709_TO_BT2020: [[f32; 3]; 3] = [
    [0.627_404, 0.329_283, 0.043_313],
    [0.069_097, 0.919_540, 0.011_362],
    [0.016_391, 0.088_013, 0.895_595],
];
const P3_TO_BT2020: [[f32; 3]; 3] = [
    [0.753_833, 0.198_597, 0.047_570],
    [0.045_744, 0.941_777, 0.012_479],
    [-0.001_210, 0.017_602, 0.983_609],
];
const BT2020_TO_BT709: [[f32; 3]; 3] = [
    [1.660_491, -0.587_641, -0.072_850],
    [-0.124_551, 1.1329, -0.008_349],
    [-0.018_151, -0.100_579, 1.118_73],
];
const P3_TO_BT709: [[f32; 3]; 3] = [
    [1.224_94, -0.224_94, 0.0],
    [-0.042_057, 1.042_057, 0.0],
    [-0.019_638, -0.078_636, 1.098_274],
];

fn multiply(matrix: &[[f32; 3]; 3], [r, g, b]: [f32; 3]) -> [f32; 3] {
    matrix.map(|row| row[0] * r + row[1] * g + row[2] * b)
}

fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(value: f32) -> f32 {
    if value <= 0.003_130_8 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

// SMPTE ST 2084 (PQ), between a signal of 0 to 1 & nits
const PQ_M1: f32 = 2610.0 / 16384.0;
const PQ_M2: f32 = 2523.0 / 4096.0 * 128.0;
const PQ_C1: f32 = 3424.0 / 4096.0;
const PQ_C2: f32 = 2413.0 / 4096.0 * 32.0;
const PQ_C3: f32 = 2392.0 / 4096.0 * 32.0;

fn pq_to_nits(signal: f32) -> f32 {
    let power = signal.clamp(0.0, 1.0).powf(1.0 / PQ_M2);
    10_000.0 * ((power - PQ_C1).max(0.0) / (PQ_C2 - PQ_C3 * power)).powf(1.0 / PQ_M1)
}

fn nits_to_pq(nits: f32) -> f32 {
    let y = (nits / 10_000.0).clamp(0.0, 1.0).powf(PQ_M1);
    ((PQ_C1 + PQ_C2 * y) / (1.0 + PQ_C3 * y)).powf(PQ_M2)
}

// ARIB STD-B67 (HLG): inverse OETF to scene light, & the OOTF to display light (BT.2020 luma)
const HLG_A: f32 = 0.178_832_77;
const HLG_B: f32 = 0.284_668_92;
const HLG_C: f32 = 0.559_910_7;

fn hlg_to_scene(signal: f32) -> f32 {
    let signal = signal.clamp(0.0, 1.0);
    if signal <= 0.5 {
        signal * signal / 3.0
    } else {
        (((signal - HLG_C) / HLG_A).exp() + HLG_B) / 12.0
    }
}

fn hlg_to_nits(rgb: [f32; 3]) -> [f32; 3] {
    let scene = rgb.map(hlg_to_scene);
    let luma = 0.2627 * scene[0] + 0.6780 * scene[1] + 0.0593 * scene[2];
    let gain = HLG_PEAK_NITS * luma.max(1e-6).powf(0.2);
    scene.map(|value| value * gain)
}

/// FFmpeg's `mobius` curve (`tonemap` filter): unchanged up to `j`, then rolling off so that
/// `peak` reaches 1
fn mobius(value: f32, peak: f32) -> f32 {
    let j = 0.3;
    if value <= j || peak <= 1.0 {
        return value.min(1.0);
    }
    let a = -j * j * (peak - 1.0) / (j * j - 2.0 * j + peak);
    let b = (j * j - 2.0 * j * peak + peak) / (peak - 1.0).max(1e-6);
    (b * b + 2.0 * b * j + j * j) / (b - a) * (value + a) / (value + b)
}

/// Pixels of a decoded image (upright), as RGB(A) signal values of 0 to 1
struct Pixels {
    width: u32,
    height: u32,
    has_alpha: bool,
    rgba: Vec<[f32; 4]>,
}

fn decode(path: &str) -> Result<Pixels, String> {
    let mut decoder = ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .into_decoder()
        .map_err(|e| e.to_string())?;
    let orientation = decoder.orientation().map_err(|e| e.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    image.apply_orientation(orientation);
    let has_alpha = image.color().has_alpha();
    let rgba = image.to_rgba32f();
    Ok(Pixels {
        width: rgba.width(),
        height: rgba.height(),
        has_alpha,
        rgba: rgba.pixels().map(|pixel| pixel.0).collect(),
    })
}

/// Writes a 16-bit PNG, with its colour signaling (ITU-T H.273 `cICP`: primaries, transfer)
fn write_png(pixels: &Pixels, path: &str, cicp: [u8; 2]) -> Result<(), String> {
    let quantize = |value: f32| (value.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let image = if pixels.has_alpha {
        let data = pixels
            .rgba
            .iter()
            .flat_map(|pixel| pixel.map(quantize))
            .collect();
        DynamicImage::ImageRgba16(
            ImageBuffer::<Rgba<u16>, Vec<u16>>::from_raw(pixels.width, pixels.height, data)
                .ok_or("Invalid image size")?,
        )
    } else {
        let data = pixels
            .rgba
            .iter()
            .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]].map(quantize))
            .collect();
        DynamicImage::ImageRgb16(
            ImageBuffer::<Rgb<u16>, Vec<u16>>::from_raw(pixels.width, pixels.height, data)
                .ok_or("Invalid image size")?,
        )
    };
    let mut encoded = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    let mut png = Png::from_bytes(Bytes::from(encoded.into_inner())).map_err(|e| e.to_string())?;
    png.chunks_mut().insert(
        1,
        img_parts::png::PngChunk::new(*b"cICP", Bytes::from(vec![cicp[0], cicp[1], 0, 1])),
    );
    fs::write(path, png.encoder().bytes()).map_err(|e| e.to_string())
}

/// Keeps the source's EXIF (with its orientation reset, as the pixels are upright) unless private
/// metadata is removed
fn copy_exif(input: &[u8], output: &str, strip_metadata: bool) -> Result<(), String> {
    if strip_metadata {
        return Ok(());
    }
    let Some(exif) = DynImage::from_bytes(Bytes::copy_from_slice(input))
        .ok()
        .flatten()
        .and_then(|image| image.exif())
    else {
        return Ok(());
    };
    let mut png = Png::from_bytes(Bytes::from(fs::read(output).map_err(|e| e.to_string())?))
        .map_err(|e| e.to_string())?;
    png.set_exif(Some(exif));
    fs::write(output, png.encoder().bytes()).map_err(|e| e.to_string())?;
    super::orientation::reset_exif_orientation(output)
}

fn boost(pixels: &mut Pixels, primaries: Primaries, intensity: f32) {
    let to_bt2020 = match primaries {
        Primaries::DisplayP3 => &P3_TO_BT2020,
        Primaries::Bt2020 => &[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        Primaries::Bt709 => &BT709_TO_BT2020,
    };
    let white = REFERENCE_WHITE_NITS * intensity;
    for pixel in &mut pixels.rgba {
        let linear = [pixel[0], pixel[1], pixel[2]].map(srgb_to_linear);
        let [r, g, b] = multiply(to_bt2020, linear).map(|value| nits_to_pq(value * white));
        *pixel = [r, g, b, pixel[3]];
    }
}

fn to_sdr(pixels: &mut Pixels, primaries: Primaries, transfer: Transfer) {
    let to_bt709 = match primaries {
        Primaries::DisplayP3 => &P3_TO_BT709,
        Primaries::Bt709 => &[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        Primaries::Bt2020 => &BT2020_TO_BT709,
    };
    // Relative to SDR white, in BT.709
    let linear: Vec<[f32; 3]> = pixels
        .rgba
        .iter()
        .map(|pixel| {
            let rgb = [pixel[0], pixel[1], pixel[2]];
            let nits = match transfer {
                Transfer::Pq => rgb.map(pq_to_nits),
                Transfer::Hlg => hlg_to_nits(rgb),
            };
            multiply(to_bt709, nits.map(|value| value / SDR_WHITE_NITS)).map(|v| v.max(0.0))
        })
        .collect();
    // As FFmpeg's `tonemap` for videos, 1,000 nits reaches SDR white; brighter content rolls off
    // up to its own peak instead of clipping
    let peak = linear
        .iter()
        .map(|rgb| rgb[0].max(rgb[1]).max(rgb[2]))
        .fold(TONE_MAP_PEAK_NITS / SDR_WHITE_NITS, f32::max)
        .min(100.0);
    for (pixel, rgb) in pixels.rgba.iter_mut().zip(linear) {
        let signal = rgb[0].max(rgb[1]).max(rgb[2]).max(1e-6);
        let scale = mobius(signal, peak) / signal;
        let [r, g, b] = rgb.map(|value| linear_to_srgb((value * scale).clamp(0.0, 1.0)));
        *pixel = [r, g, b, pixel[3]];
    }
}

/// HDR Boost or Remove HDR into a 16-bit PNG (`output`), for a source whose dynamic range matches
pub fn process(
    input: &str,
    output: &str,
    config: &ImageDynamicRangeConfig,
    strip_metadata: bool,
) -> Result<(), String> {
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    let color = source_color(&bytes);
    let info = inspect(input)?;
    if !super::image_dynamic_range::applies(config.mode, info.dynamic_range) {
        return Err("Image dynamic range operation does not match the source".into());
    }
    let mut pixels = decode(input)?;
    match config.mode {
        ImageDynamicRangeMode::Boost => {
            if !config.intensity.is_finite()
                || !(1.0..=MAX_BOOST_INTENSITY).contains(&config.intensity)
            {
                return Err(format!(
                    "HDR Boost intensity must be between 1 and {MAX_BOOST_INTENSITY}"
                ));
            }
            boost(&mut pixels, color.primaries, config.intensity);
            write_png(&pixels, output, [9, 16])?;
        }
        ImageDynamicRangeMode::Sdr => match color.hdr {
            Some(transfer) => {
                to_sdr(&mut pixels, color.primaries, transfer);
                write_png(&pixels, output, [1, 13])?;
            }
            // A gain-map JPEG's primary image is its SDR rendition: kept, without the gain map
            None => {
                let primaries = match color.primaries {
                    Primaries::DisplayP3 => 12,
                    _ => 1,
                };
                write_png(&pixels, output, [primaries, 13])?;
            }
        },
        ImageDynamicRangeMode::Original => {
            return Err("No dynamic range operation was requested".into())
        }
    }
    copy_exif(&bytes, output, strip_metadata)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transfer_functions_round_trip_and_match_ffmpeg() {
        for nits in [0.0, 1.0, 100.0, 203.0, 1000.0, 10_000.0] {
            assert!((pq_to_nits(nits_to_pq(nits)) - nits).abs() < nits * 1e-3 + 1e-3);
        }
        // Same 10-bit codes as the video filters (limited range): 203 nits × 1, 2, 4 & 8
        for (intensity, code) in [(1.0, 573), (2.0, 637), (4.0, 703), (8.0, 769)] {
            let signal = nits_to_pq(REFERENCE_WHITE_NITS * intensity);
            assert_eq!((64.0 + 876.0 * signal).round() as i32, code);
        }
        // HLG reference white (75%) is about 203 nits
        let white = hlg_to_nits([0.75; 3])[0];
        assert!((white - 203.0).abs() < 3.0, "{white}");
        assert!((srgb_to_linear(linear_to_srgb(0.5)) - 0.5).abs() < 1e-6);
        assert_eq!(mobius(0.2, 10.0), 0.2);
        assert!((mobius(10.0, 10.0) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn reads_signaling_from_the_bytes() {
        let work = std::env::temp_dir().join(format!("compresso-image-hdr-{}", std::process::id()));
        fs::create_dir_all(&work).unwrap();
        let path = work.join("pq.png");
        let pixels = Pixels {
            width: 2,
            height: 1,
            has_alpha: true,
            rgba: vec![[0.5, 0.5, 0.5, 1.0], [0.1, 0.2, 0.3, 0.5]],
        };
        write_png(&pixels, path.to_str().unwrap(), [9, 16]).unwrap();
        let info = inspect(path.to_str().unwrap()).unwrap();
        assert_eq!(info.dynamic_range, DynamicRange::Hdr);
        assert!(super::super::image_codecs::png_is_hdr(&path).unwrap());

        let sdr = work.join("sdr.png");
        image::RgbImage::from_pixel(4, 4, Rgb([200, 100, 50]))
            .save(&sdr)
            .unwrap();
        assert_eq!(
            inspect(sdr.to_str().unwrap()).unwrap().dynamic_range,
            DynamicRange::Sdr
        );
        let mut jpeg = vec![0xFF, 0xD8];
        jpeg.extend_from_slice(b"...urn:iso:std:iso:ts:21496:-1...");
        let color = source_color(&jpeg);
        assert!(color.has_gain_map);
        fs::remove_dir_all(work).ok();
    }

    #[test]
    fn boost_and_remove_hdr_round_trip_white_and_alpha() {
        let work =
            std::env::temp_dir().join(format!("compresso-image-hdr-ops-{}", std::process::id()));
        fs::create_dir_all(&work).unwrap();
        let source = work.join("source.png");
        let mut image = image::RgbaImage::from_pixel(8, 4, Rgba([255, 255, 255, 255]));
        image.put_pixel(0, 0, Rgba([255, 255, 255, 64]));
        image.put_pixel(1, 0, Rgba([128, 64, 32, 255]));
        image.save(&source).unwrap();
        let boosted = work.join("boosted.png");
        process(
            source.to_str().unwrap(),
            boosted.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Boost,
                intensity: 2.0,
            },
            true,
        )
        .unwrap();
        assert!(super::super::image_codecs::png_is_hdr(&boosted).unwrap());
        let hdr = image::open(&boosted).unwrap().to_rgba16();
        // White at 406 nits in PQ; alpha untouched
        let expected = (nits_to_pq(406.0) * 65535.0).round() as i32;
        assert!((hdr.get_pixel(4, 2)[0] as i32 - expected).abs() < 40);
        assert_eq!(hdr.get_pixel(0, 0)[3], 64 * 257);
        assert_eq!(
            inspect(boosted.to_str().unwrap()).unwrap().dynamic_range,
            DynamicRange::Hdr
        );

        // Back to SDR as the video filters do (406 nits: 228 in limited range, 247 in full), and
        // colours keep their order
        let sdr = work.join("sdr.png");
        process(
            boosted.to_str().unwrap(),
            sdr.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Sdr,
                intensity: 1.0,
            },
            true,
        )
        .unwrap();
        assert!(!super::super::image_codecs::png_is_hdr(&sdr).unwrap());
        let sdr = image::open(&sdr).unwrap().to_rgba8();
        assert!((245..=249).contains(&sdr.get_pixel(4, 2)[0]), "{:?}", sdr.get_pixel(4, 2));
        let color = sdr.get_pixel(1, 0);
        assert!(color[0] > color[1] && color[1] > color[2], "{color:?}");
        assert_eq!(sdr.get_pixel(0, 0)[3], 64);

        // Boosting an HDR image, or removing HDR from an SDR one, is refused
        assert!(process(
            boosted.to_str().unwrap(),
            work.join("x.png").to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Boost,
                intensity: 2.0,
            },
            true,
        )
        .is_err());
        assert!(process(
            source.to_str().unwrap(),
            work.join("x.png").to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Boost,
                intensity: 8.5,
            },
            true,
        )
        .is_err());
        fs::remove_dir_all(work).ok();
    }

    #[test]
    fn gain_map_jpeg_keeps_its_sdr_rendition() {
        let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/image-hdr/gain-map.jpg");
        let info = inspect(fixture).unwrap();
        assert_eq!(info.dynamic_range, DynamicRange::Hdr);
        assert!(info.has_gain_map && !info.supports_hdr_jpeg);
        let output = std::env::temp_dir().join(format!("compresso-gain-map-{}.png", std::process::id()));
        process(
            fixture,
            output.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Sdr,
                intensity: 1.0,
            },
            true,
        )
        .unwrap();
        assert!(!super::super::image_codecs::png_is_hdr(&output).unwrap());
        let base = image::open(fixture).unwrap().to_rgb8();
        let sdr = image::open(&output).unwrap().to_rgb8();
        assert_eq!(base.dimensions(), sdr.dimensions());
        assert_eq!(base.get_pixel(1, 1), sdr.get_pixel(1, 1));
        assert_eq!(
            inspect(output.to_str().unwrap()).unwrap().dynamic_range,
            DynamicRange::Sdr
        );
        fs::remove_file(output).ok();
    }
}
