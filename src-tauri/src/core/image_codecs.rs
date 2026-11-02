//! JPEG XL and HEIC/HEIF adapters. CLI filenames are ASCII and relative so codec C runtimes
//! never receive Windows extended-length paths or user filenames they cannot represent.
use super::media_process::MediaProcessExecutorBuilder;
use crate::sys::fs::ensure_assets_dir;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::AppHandle;

pub fn is_modern(extension: &str) -> bool {
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "jxl" | "heic" | "heif"
    )
}

pub fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
}

fn copy_input(input: &str, output: &Path) -> Result<(), String> {
    // Do not inherit Windows read-only attributes from an original on a camera/network drive;
    // the temporary copy must remain removable without changing the user's source file.
    let mut source = fs::File::open(input).map_err(|e| e.to_string())?;
    let mut target = fs::File::create(output).map_err(|e| e.to_string())?;
    std::io::copy(&mut source, &mut target).map_err(|e| e.to_string())?;
    Ok(())
}

/// These describe the pixels, and must survive even when private EXIF/XMP metadata is stripped.
pub fn preserve_png_color(input: &Path, output: &Path) -> Result<(), String> {
    use img_parts::{png::Png, Bytes};
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(());
    }
    let original = Png::from_bytes(Bytes::from(bytes)).map_err(|e| e.to_string())?;
    let kinds = [
        *b"iCCP", *b"cICP", *b"cHRM", *b"gAMA", *b"sRGB", *b"cLLI", *b"mDCV",
    ];
    let chunks: Vec<_> = original
        .chunks()
        .iter()
        .filter(|chunk| kinds.contains(&chunk.kind()))
        .cloned()
        .collect();
    if chunks.is_empty() {
        return Ok(());
    }
    let mut png = Png::from_bytes(Bytes::from(fs::read(output).map_err(|e| e.to_string())?))
        .map_err(|e| e.to_string())?;
    png.chunks_mut()
        .retain(|chunk| !kinds.contains(&chunk.kind()));
    for chunk in chunks.into_iter().rev() {
        png.chunks_mut().insert(1, chunk);
    }
    fs::write(output, png.encoder().bytes()).map_err(|e| e.to_string())
}

pub struct Workspace(pub PathBuf);
impl Workspace {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let directory = ensure_assets_dir(app)?.join(format!("codec-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
        Ok(Self(directory))
    }
}
impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub async fn run(
    app: &AppHandle,
    command: Command,
    owner: &str,
    cancel_ids: &[String],
) -> Result<String, String> {
    let output = Arc::new(Mutex::new(String::new()));
    let captured = output.clone();
    let result = MediaProcessExecutorBuilder::new(app.clone())
        .owner_window(owner)
        .command(command)
        .with_cancel_support(cancel_ids.to_vec(), None)
        .with_stdout_callback(Arc::new(move |_, line| {
            if let Ok(mut text) = captured.lock() {
                if text.len() < 64 * 1024 {
                    text.push_str(&line);
                    text.push('\n');
                }
            }
        }))
        .build()
        .map_err(|err| {
            log::error!("[image_codec] Could not prepare codec process: {err}");
            err
        })?
        .spawn_and_wait()
        .await
        .map_err(|err| {
            log::error!("[image_codec] Codec process failed: {err}");
            err
        })?;
    if !result.success() {
        log::error!("[image_codec] Codec exited with status {}", result.code());
        return Err("Image codec failed. See the app log for decoder/encoder diagnostics.".into());
    }
    let text = output.lock().map_err(|e| e.to_string())?.clone();
    Ok(text)
}

/// Full-resolution, lossless intermediate, also usable as a WebView-independent preview.
pub async fn decoded_png(
    app: &AppHandle,
    input: &str,
    owner: &str,
    cancel_ids: &[String],
) -> Result<PathBuf, String> {
    let ext = extension(input);
    if !is_modern(&ext) {
        return Err("This image does not need a codec preview".into());
    }
    log::info!("[image_codec] Preparing {ext} preview");
    let mut file = fs::File::open(input).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    hash.update(b"compresso-image-preview-v1");
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    let destination = ensure_assets_dir(app)?.join(format!("preview-{:x}.png", hash.finalize()));
    if image::open(&destination).is_ok() {
        return Ok(destination);
    }
    let work = Workspace::new(app)?;
    let source = format!("input.{ext}");
    copy_input(input, &work.0.join(&source))?;
    if ext == "jxl" {
        let mut info = super::tool_bundle::command(app, "jxlinfo")?;
        info.current_dir(&work.0).arg(&source);
        let details = run(app, info, owner, cancel_ids).await?;
        validate_jxl_info(&details)?;
    }
    let decoder = if ext == "jxl" { "djxl" } else { "heif-dec" };
    let mut command = super::tool_bundle::command(app, decoder)?;
    command.current_dir(&work.0);
    if ext == "jxl" {
        command.args([&source, "output.png"]);
    } else {
        command.args(["--quiet", &source, "output.png"]);
    }
    log::info!("[image_codec] Running {decoder} to decode {ext}");
    run(app, command, owner, cancel_ids).await?;
    // Check the actual pixels, not only the tool's exit code, before publishing the preview.
    image::image_dimensions(work.0.join("output.png"))
        .map_err(|e| format!("Invalid decoded image: {e}"))?;
    if destination.exists() && image::open(&destination).is_err() {
        fs::remove_file(&destination).map_err(|e| e.to_string())?;
    }
    fs::rename(work.0.join("output.png"), &destination)
        .or_else(|error| {
            if image::open(&destination).is_ok() {
                Ok(())
            } else {
                Err(error)
            }
        })
        .map_err(|e| e.to_string())?;
    log::info!("[image_codec] Finished decoding {ext}");
    Ok(destination)
}

fn validate_jxl_info(details: &str) -> Result<(), String> {
    if details.contains("JPEG XL animation") {
        return Err("Animated JPEG XL images are not supported yet".into());
    }
    if details.contains("-bit float")
        || details.contains("CMY+Black")
        || details.contains("Gain map (jhgm)")
    {
        return Err("Floating-point/HDR and CMYK JPEG XL images are not supported yet".into());
    }
    Ok(())
}

/// Integer PQ/HLG pixels can pass through PNG into cjxl without tone mapping. Other
/// exporters currently reduce bit depth or discard this signaling, so reject those
/// conversions rather than silently producing an incorrectly rendered image.
pub fn validate_png_output(input: &Path, format: &str) -> Result<(), String> {
    if matches!(format, "jxl" | "png") {
        return Ok(());
    }
    if png_is_hdr(input)? {
        return Err("HDR image conversion currently supports PNG or JPEG XL output only. Convert to SDR to use another format.".into());
    }
    Ok(())
}

pub fn png_is_hdr(input: &Path) -> Result<bool, String> {
    let bytes = fs::read(input).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok(false);
    }
    let png = img_parts::png::Png::from_bytes(img_parts::Bytes::from(bytes))
        .map_err(|e| e.to_string())?;
    Ok(png
        .chunks()
        .iter()
        .any(|chunk| chunk.kind() == *b"cICP" && matches!(chunk.contents().get(1), Some(16 | 18))))
}

pub async fn encode(
    app: &AppHandle,
    input: &str,
    output: &str,
    format: &str,
    quality: u8,
    lossless: bool,
    owner: &str,
    cancel_ids: &[String],
) -> Result<(), String> {
    validate_png_output(Path::new(input), format)?;
    let pixels = image::open(input).map_err(|e| e.to_string())?;
    if format != "jxl"
        && lossless
        && pixels.color().bits_per_pixel() / pixels.color().channel_count() as u16 > 8
    {
        return Err("Lossless HEIC/HEIF output currently supports 8-bit input. Use lossless JPEG XL or PNG to preserve higher bit depths.".into());
    }
    let work = Workspace::new(app)?;
    // A decoded PNG avoids a lossy intermediate and carries alpha and 16-bit pixel data.
    if format != "jxl" && !lossless {
        // This x265 build encodes 8-bit HEIC. Bit-depth reduction is an explicit part of lossy
        // output; lossless higher-depth requests are rejected above rather than mislabeled.
        pixels
            .to_rgba8()
            .save(work.0.join("input.png"))
            .map_err(|e| e.to_string())?;
        preserve_png_color(Path::new(input), &work.0.join("input.png"))?;
        // The normalized input contains EXIF only when the user elected to keep it.
        use image::ImageDecoder;
        let exif = {
            let mut decoder = image::ImageReader::open(input)
                .map_err(|e| e.to_string())?
                .into_decoder()
                .map_err(|e| e.to_string())?;
            decoder.exif_metadata().map_err(|e| e.to_string())?
        };
        if let Some(exif) = exif {
            let mut png = img_parts::png::Png::from_bytes(img_parts::Bytes::from(
                fs::read(work.0.join("input.png")).map_err(|e| e.to_string())?,
            ))
            .map_err(|e| e.to_string())?;
            png.chunks_mut().insert(
                1,
                img_parts::png::PngChunk::new(*b"eXIf", img_parts::Bytes::from(exif)),
            );
            fs::write(work.0.join("input.png"), png.encoder().bytes())
                .map_err(|e| e.to_string())?;
        }
    } else {
        copy_input(input, &work.0.join("input.png"))?;
    }
    drop(pixels);
    let encoder = if format == "jxl" { "cjxl" } else { "heif-enc" };
    let mut command = super::tool_bundle::command(app, encoder)?;
    command.current_dir(&work.0);
    let name = format!("output.{format}");
    command.args(encoder_arguments(format, quality, lossless));
    run(app, command, owner, cancel_ids).await?;
    let encoded = work.0.join(name);
    if fs::metadata(&encoded).map_err(|e| e.to_string())?.len() == 0 {
        return Err("Image encoder produced an empty file".into());
    }
    fs::copy(encoded, output).map_err(|e| e.to_string())?;
    Ok(())
}

fn encoder_arguments(format: &str, quality: u8, lossless: bool) -> Vec<String> {
    if format == "jxl" {
        vec![
            "input.png".into(),
            "output.jxl".into(),
            "--effort=7".into(),
            if lossless {
                "--distance=0".into()
            } else {
                format!("--quality={}", quality.clamp(1, 99))
            },
        ]
    } else {
        let mut args = vec![
            "-e".into(),
            "x265".into(),
            "-o".into(),
            format!("output.{format}"),
        ];
        if lossless {
            args.extend(["-L", "-p", "chroma=444"].map(String::from));
        } else {
            args.extend(["-q".into(), quality.clamp(1, 100).to_string()]);
        }
        args.push("input.png".into());
        args
    }
}

fn jpeg_arguments(strip_metadata: bool) -> Vec<String> {
    let mut args = ["input.jpg", "output.jxl", "--lossless_jpeg=1", "--effort=7"]
        .map(String::from)
        .to_vec();
    if strip_metadata {
        args.extend(
            [
                "--allow_jpeg_reconstruction=0",
                "-x",
                "strip=exif",
                "-x",
                "strip=xmp",
                "-x",
                "strip=jumbf",
            ]
            .map(String::from),
        );
    }
    args
}

pub async fn transcode_jpeg(
    app: &AppHandle,
    input: &str,
    output: &str,
    strip_metadata: bool,
    owner: &str,
    cancel_ids: &[String],
) -> Result<(), String> {
    let work = Workspace::new(app)?;
    copy_input(input, &work.0.join("input.jpg"))?;
    let mut command = super::tool_bundle::command(app, "cjxl")?;
    command
        .current_dir(&work.0)
        .args(jpeg_arguments(strip_metadata));
    run(app, command, owner, cancel_ids).await?;
    fs::copy(work.0.join("output.jxl"), output).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> PathBuf {
        let target = env!("COMPRESSO_TARGET");
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join(format!(
                "compresso_{name}-{target}{}",
                if cfg!(windows) { ".exe" } else { "" }
            ))
    }

    fn execute(directory: &Path, name: &str, args: &[String]) -> std::process::Output {
        let mut command = Command::new(tool(name));
        command.current_dir(directory).args(args);
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{name}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    fn heif_test_tool(encode: bool) -> &'static str {
        if encode {
            "heif-enc"
        } else {
            "heif-dec"
        }
    }

    fn decode_test_arguments(format: &str) -> Vec<String> {
        if format == "jxl" {
            vec!["output.jxl".into(), "decoded.png".into()]
        } else {
            vec![format!("output.{format}"), "decoded.png".into()]
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn hdr_jpeg_transforms_and_quality_retries_keep_both_renditions() {
        use super::super::image_dynamic_range::{
            self, DynamicRange, ImageDynamicRangeConfig, ImageDynamicRangeMode,
        };
        let directory =
            std::env::temp_dir().join(format!("compresso-hdr-jpeg-edit-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        let source = work.0.join("source.png");
        image::RgbaImage::from_fn(48, 32, |x, y| {
            image::Rgba([
                (x * 5) as u8,
                (y * 7) as u8,
                123,
                if x < 12 { 128 } else { 255 },
            ])
        })
        .save(&source)
        .unwrap();
        if !image_dynamic_range::inspect(source.to_str().unwrap())
            .unwrap()
            .supported
        {
            return;
        }
        let base = work.0.join("base.png");
        let hdr = work.0.join("hdr.png");
        image_dynamic_range::process_with_sdr_base(
            source.to_str().unwrap(),
            hdr.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Boost,
                intensity: 4.0,
            },
            true,
            Some(base.to_str().unwrap()),
        )
        .unwrap();
        for name in ["base", "hdr"] {
            execute(
                &work.0,
                "ffmpeg",
                &[
                    "-v",
                    "error",
                    "-i",
                    &format!("{name}.png"),
                    "-vf",
                    "format=rgba64le,crop=32:24:8:4,transpose=1,scale=40:56",
                    "-map_metadata",
                    "-1",
                    "-y",
                    &format!("{name}-edited.png"),
                ]
                .map(String::from),
            );
            preserve_png_color(
                &work.0.join(format!("{name}.png")),
                &work.0.join(format!("{name}-edited.png")),
            )
            .unwrap();
        }
        let mut sizes = Vec::new();
        for quality in [95, 40, 1] {
            let output = work.0.join("output.jpeg");
            image_dynamic_range::encode_hdr_jpeg(
                work.0.join("base-edited.png").to_str().unwrap(),
                work.0.join("hdr-edited.png").to_str().unwrap(),
                output.to_str().unwrap(),
                quality,
                true,
            )
            .unwrap();
            let info = image_dynamic_range::inspect(output.to_str().unwrap()).unwrap();
            assert_eq!(info.dynamic_range, DynamicRange::Hdr);
            assert!(info.has_gain_map);
            assert_eq!(image::image_dimensions(&output).unwrap(), (40, 56));
            sizes.push(fs::metadata(&output).unwrap().len());
        }
        assert!(
            sizes.windows(2).any(|pair| pair[0] != pair[1]),
            "JPEG quality did not affect output size"
        );
        // Recompress a gain-map JPEG with Remove HDR off: preserve its HDR rendition.
        let output = work.0.join("output.jpeg");
        image_dynamic_range::process_with_sdr_base(
            output.to_str().unwrap(),
            hdr.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Original,
                intensity: 1.0,
            },
            false,
            Some(base.to_str().unwrap()),
        )
        .unwrap();
        image_dynamic_range::encode_hdr_jpeg(
            base.to_str().unwrap(),
            hdr.to_str().unwrap(),
            work.0.join("recompressed.jpg").to_str().unwrap(),
            80,
            false,
        )
        .unwrap();
        assert!(
            image_dynamic_range::inspect(work.0.join("recompressed.jpg").to_str().unwrap())
                .unwrap()
                .has_gain_map
        );
    }

    #[test]
    fn integer_hdr_jxl_is_supported_but_unsupported_representations_are_rejected() {
        for transfer in ["PQ", "HLG", "sRGB"] {
            assert!(validate_jxl_info(&format!(
                "JPEG XL image, 32x24, (possibly) lossless, 10-bit RGB\nTransfer function: {transfer}"
            ))
            .is_ok());
        }
        for details in [
            "JPEG XL animation",
            "32-bit float",
            "Color space: CMY+Black",
            "Gain map (jhgm)",
        ] {
            assert!(validate_jxl_info(details).is_err(), "{details}");
        }
    }

    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn integer_hdr_jxl_survives_normalization_and_recompression() {
        use img_parts::{
            png::{Png, PngChunk},
            Bytes,
        };

        let directory =
            std::env::temp_dir().join(format!("compresso-hdr-jxl-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        let pixels = image::ImageBuffer::<image::Rgb<u16>, Vec<u16>>::from_fn(32, 24, |x, y| {
            image::Rgb([
                (x * 1901) as u16,
                (y * 2701) as u16,
                ((x + y) * 1103) as u16,
            ])
        });
        for (transfer, name) in [(16, "PQ"), (18, "HLG")] {
            pixels.save(work.0.join("input.png")).unwrap();
            let mut png =
                Png::from_bytes(Bytes::from(fs::read(work.0.join("input.png")).unwrap())).unwrap();
            png.chunks_mut().insert(
                1,
                PngChunk::new(*b"cICP", Bytes::from(vec![12, transfer, 0, 1])),
            );
            fs::write(work.0.join("input.png"), png.encoder().bytes()).unwrap();
            execute(&work.0, "cjxl", &encoder_arguments("jxl", 80, true));
            let details = execute(&work.0, "jxlinfo", &["output.jxl".into()]);
            let details = String::from_utf8(details.stdout).unwrap();
            validate_jxl_info(&details).unwrap();
            assert!(
                details.contains(&format!("Transfer function: {name}")),
                "{details}"
            );
            #[cfg(target_os = "macos")]
            {
                use super::super::image_dynamic_range::{
                    self, DynamicRange, ImageDynamicRangeConfig, ImageDynamicRangeMode,
                };
                let source = work.0.join("output.jxl");
                let info = image_dynamic_range::inspect(source.to_str().unwrap()).unwrap();
                if info.supported {
                    assert_eq!(
                        info.dynamic_range,
                        DynamicRange::Hdr,
                        "Native {name} JXL detection"
                    );
                    let output = work.0.join("sdr.png");
                    image_dynamic_range::process(
                        source.to_str().unwrap(),
                        output.to_str().unwrap(),
                        &ImageDynamicRangeConfig {
                            mode: ImageDynamicRangeMode::Sdr,
                            intensity: 1.0,
                        },
                        true,
                    )
                    .unwrap();
                    assert_eq!(
                        image_dynamic_range::inspect(output.to_str().unwrap())
                            .unwrap()
                            .dynamic_range,
                        DynamicRange::Sdr
                    );
                }
            }
            execute(&work.0, "djxl", &["output.jxl".into(), "source.png".into()]);

            // The app normalizes decoded pixels before applying private-metadata stripping.
            let source = image::open(work.0.join("source.png")).unwrap();
            source.save(work.0.join("input.png")).unwrap();
            preserve_png_color(&work.0.join("source.png"), &work.0.join("input.png")).unwrap();
            validate_png_output(&work.0.join("input.png"), "jxl").unwrap();
            for format in ["jpg", "webp", "avif", "heic", "heif"] {
                assert!(validate_png_output(&work.0.join("input.png"), format).is_err());
            }
            for lossless in [true, false] {
                execute(&work.0, "cjxl", &encoder_arguments("jxl", 60, lossless));
                let details = execute(&work.0, "jxlinfo", &["output.jxl".into()]);
                let details = String::from_utf8(details.stdout).unwrap();
                assert!(details.contains("Primaries: P3"), "{details}");
                assert!(
                    details.contains(&format!("Transfer function: {name}")),
                    "{details}"
                );
                execute(
                    &work.0,
                    "djxl",
                    &["output.jxl".into(), "decoded.png".into()],
                );
                let restored = image::open(work.0.join("decoded.png")).unwrap();
                assert_eq!(restored.color(), image::ColorType::Rgb16);
                if lossless {
                    assert_eq!(source.to_rgb16(), restored.to_rgb16());
                }
            }
        }
    }

    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn native_formats_round_trip_alpha_reencode_and_reject_corrupt_files() {
        let directory =
            std::env::temp_dir().join(format!("CompressO 日本語 codec test {}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        // Different color/alpha values, including transparent pixels, expose chroma/alpha loss.
        let image = image::RgbaImage::from_fn(48, 32, |x, y| {
            image::Rgba([
                (x * 5) as u8,
                (y * 7) as u8,
                ((x + y) * 3) as u8,
                if x < 12 { 0 } else { 255 },
            ])
        });
        image.save(work.0.join("input.png")).unwrap();
        for format in ["jxl", "heic", "heif"] {
            execute(
                &work.0,
                if format == "jxl" {
                    "cjxl"
                } else {
                    heif_test_tool(true)
                },
                &encoder_arguments(format, 80, true),
            );
            execute(
                &work.0,
                if format == "jxl" {
                    "djxl"
                } else {
                    heif_test_tool(false)
                },
                &decode_test_arguments(format),
            );
            let decoded = image::open(work.0.join("decoded.png")).unwrap().to_rgba8();
            assert_eq!(decoded.dimensions(), image.dimensions());
            for (original, restored) in image.pixels().zip(decoded.pixels()) {
                assert_eq!(original[3], restored[3], "{format}: alpha");
                if original[3] != 0 {
                    assert_eq!(original, restored, "{format}: visible pixels");
                }
            }
            let encoded_name = format!("output.{format}");
            fs::remove_file(work.0.join(&encoded_name)).unwrap();
            execute(
                &work.0,
                if format == "jxl" {
                    "cjxl"
                } else {
                    heif_test_tool(true)
                },
                &encoder_arguments(format, 60, false),
            );
            fs::remove_file(work.0.join("decoded.png")).unwrap();
            execute(
                &work.0,
                if format == "jxl" {
                    "djxl"
                } else {
                    heif_test_tool(false)
                },
                &decode_test_arguments(format),
            );
            assert_eq!(
                image::image_dimensions(work.0.join("decoded.png")).unwrap(),
                image.dimensions()
            );
            fs::copy(work.0.join("decoded.png"), work.0.join("input.png")).unwrap();
            fs::remove_file(work.0.join(&encoded_name)).unwrap();
            execute(
                &work.0,
                if format == "jxl" {
                    "cjxl"
                } else {
                    heif_test_tool(true)
                },
                &encoder_arguments(format, 50, false),
            );
            fs::write(work.0.join(format!("bad.{format}")), b"invalid image bytes").unwrap();
            let decoder = if format == "jxl" {
                "djxl"
            } else {
                heif_test_tool(false)
            };
            let mut corrupt = Command::new(tool(decoder));
            corrupt.current_dir(&work.0);
            corrupt.args([format!("bad.{format}"), "bad.png".into()]);
            assert!(!corrupt.output().unwrap().status.success());
            fs::remove_file(work.0.join("decoded.png")).unwrap();
            // Restore the original fixture for the next format.
            image.save(work.0.join("input.png")).unwrap();
        }
    }

    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn jpeg_xl_preserves_sixteen_bit_pixels() {
        let directory = std::env::temp_dir().join(format!("compresso-jxl16-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        let image = image::ImageBuffer::<image::Rgba<u16>, Vec<u16>>::from_fn(32, 24, |x, y| {
            image::Rgba([
                (x * 1901) as u16,
                (y * 2701) as u16,
                ((x + y) * 1103) as u16,
                65535,
            ])
        });
        image.save(work.0.join("input.png")).unwrap();
        execute(&work.0, "cjxl", &encoder_arguments("jxl", 80, true));
        execute(
            &work.0,
            "djxl",
            &["output.jxl".into(), "decoded.png".into()],
        );
        assert_eq!(
            image::open(work.0.join("decoded.png")).unwrap().to_rgba16(),
            image
        );
    }

    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn jpeg_transcoding_reconstructs_original_and_supports_metadata_stripping() {
        let directory =
            std::env::temp_dir().join(format!("compresso-jpeg-jxl-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        image::RgbImage::from_fn(48, 32, |x, y| {
            image::Rgb([(x * 5) as u8, (y * 7) as u8, 123])
        })
        .save(work.0.join("input.jpg"))
        .unwrap();
        execute(&work.0, "cjxl", &jpeg_arguments(false));
        execute(
            &work.0,
            "djxl",
            &["output.jxl".into(), "restored.jpg".into()],
        );
        assert_eq!(
            fs::read(work.0.join("input.jpg")).unwrap(),
            fs::read(work.0.join("restored.jpg")).unwrap()
        );
        fs::remove_file(work.0.join("output.jxl")).unwrap();
        execute(&work.0, "cjxl", &jpeg_arguments(true));
        execute(
            &work.0,
            "djxl",
            &["output.jxl".into(), "decoded.png".into()],
        );
        assert_eq!(
            image::image_dimensions(work.0.join("decoded.png")).unwrap(),
            (48, 32)
        );
    }

    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn collections_use_the_primary_image_and_jxl_animations_are_rejected() {
        let directory =
            std::env::temp_dir().join(format!("compresso-collection-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        let first = image::RgbaImage::from_pixel(48, 32, image::Rgba([255, 0, 0, 255]));
        let second = image::RgbaImage::from_pixel(24, 16, image::Rgba([0, 0, 255, 255]));
        first.save(work.0.join("first.png")).unwrap();
        second.save(work.0.join("second.png")).unwrap();
        execute(
            &work.0,
            "heif-enc",
            &[
                "-e",
                "x265",
                "-L",
                "-p",
                "chroma=444",
                "-o",
                "collection.heic",
                "first.png",
                "second.png",
            ]
            .map(String::from),
        );
        execute(
            &work.0,
            "heif-dec",
            &["collection.heic", "primary.png"].map(String::from),
        );
        assert_eq!(
            image::open(work.0.join("primary.png")).unwrap().to_rgba8(),
            first
        );
        assert!(!work.0.join("primary-1.png").exists());
        let file = fs::File::create(work.0.join("animation.gif")).unwrap();
        let mut gif = image::codecs::gif::GifEncoder::new(file);
        for pixels in [first.clone(), first] {
            gif.encode_frame(image::Frame::from_parts(
                pixels,
                0,
                0,
                image::Delay::from_numer_denom_ms(100, 1),
            ))
            .unwrap();
        }
        drop(gif);
        execute(
            &work.0,
            "cjxl",
            &["animation.gif", "animation.jxl", "--distance=0"].map(String::from),
        );
        let details = execute(&work.0, "jxlinfo", &["animation.jxl".into()]);
        assert!(
            validate_jxl_info(&String::from_utf8(details.stdout).unwrap())
                .unwrap_err()
                .contains("Animated")
        );
    }

    #[test]
    #[ignore = "requires matching prebuilt image codecs"]
    fn png_color_description_survives_normalization_and_jxl_encoding() {
        use img_parts::{
            png::{Png, PngChunk},
            Bytes,
        };
        let directory = std::env::temp_dir().join(format!("compresso-color-{}", nanoid::nanoid!()));
        fs::create_dir(&directory).unwrap();
        let work = Workspace(directory);
        image::RgbImage::from_pixel(32, 24, image::Rgb([220, 30, 100]))
            .save(work.0.join("input.png"))
            .unwrap();
        let mut png =
            Png::from_bytes(Bytes::from(fs::read(work.0.join("input.png")).unwrap())).unwrap();
        png.chunks_mut().insert(
            1,
            PngChunk::new(*b"cICP", Bytes::from_static(&[12, 13, 0, 1])),
        );
        png.chunks_mut().insert(
            2,
            PngChunk::new(*b"tEXt", Bytes::from_static(b"private\0test metadata")),
        );
        fs::write(work.0.join("source.png"), png.encoder().bytes()).unwrap();
        preserve_png_color(&work.0.join("source.png"), &work.0.join("input.png")).unwrap();
        let normalized =
            Png::from_bytes(Bytes::from(fs::read(work.0.join("input.png")).unwrap())).unwrap();
        assert!(normalized
            .chunks()
            .iter()
            .any(|chunk| chunk.kind() == *b"cICP"));
        assert!(!normalized
            .chunks()
            .iter()
            .any(|chunk| chunk.kind() == *b"tEXt"));
        execute(&work.0, "cjxl", &encoder_arguments("jxl", 80, true));
        let details = execute(&work.0, "jxlinfo", &["output.jxl".into()]);
        assert!(String::from_utf8(details.stdout)
            .unwrap()
            .contains("Primaries: P3"));
    }
}
