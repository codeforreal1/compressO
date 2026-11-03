use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDynamicRangeInfo {
    pub supported: bool,
    pub dynamic_range: DynamicRange,
    pub has_gain_map: bool,
    /// HDR JPEG (gain map) can be written: Core Image, on macOS 15 and later
    #[serde(default)]
    pub supports_hdr_jpeg: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DynamicRange {
    #[default]
    Unknown,
    Sdr,
    Hdr,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ImageDynamicRangeMode {
    #[default]
    Original,
    Boost,
    Sdr,
}

/// The strongest HDR Boost, for images & videos (SDR white at 8×; most screens show less)
pub const MAX_BOOST_INTENSITY: f32 = 8.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDynamicRangeConfig {
    pub mode: ImageDynamicRangeMode,
    pub intensity: f32,
}

pub fn inspect(path: &str) -> Result<ImageDynamicRangeInfo, String> {
    #[cfg(target_os = "macos")]
    {
        let json = crate::macos::bridge::ffi::imageDynamicRangeInfo(path.to_owned());
        serde_json::from_str(&json)
            .map_err(|e| format!("Invalid image dynamic range information: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(ImageDynamicRangeInfo::default())
    }
}

/// The dynamic range of a source: with Core Image on macOS 15 and later, otherwise from the file
/// itself (see `image_dynamic_range_portable`), JPEG XL & HEIC decoded to PNG first. Also gives the
/// file the portable processing reads (the decoded PNG for those).
pub async fn inspect_source(
    app: &tauri::AppHandle,
    path: &str,
    owner: &str,
    cancel_ids: &[String],
) -> Result<(ImageDynamicRangeInfo, String), String> {
    let source = path.to_owned();
    let mut native = tauri::async_runtime::spawn_blocking(move || inspect(&source))
        .await
        .map_err(|e| e.to_string())??;
    if native.supported {
        native.supports_hdr_jpeg = true;
        return Ok((native, path.to_owned()));
    }
    let readable = if super::image_codecs::is_modern(&super::image_codecs::extension(path)) {
        super::image_codecs::decoded_png(app, path, owner, cancel_ids)
            .await?
            .to_string_lossy()
            .into_owned()
    } else {
        path.to_owned()
    };
    let decoded = readable.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        super::image_dynamic_range_portable::inspect(&decoded)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok((info, readable))
}

pub fn applies(mode: ImageDynamicRangeMode, range: DynamicRange) -> bool {
    matches!(
        (mode, range),
        (ImageDynamicRangeMode::Boost, DynamicRange::Sdr)
            | (ImageDynamicRangeMode::Sdr, DynamicRange::Hdr)
    )
}

pub fn process(
    input: &str,
    output: &str,
    config: &ImageDynamicRangeConfig,
    strip_metadata: bool,
) -> Result<(), String> {
    process_with_sdr_base(input, output, config, strip_metadata, None)
}

pub fn process_with_sdr_base(
    input: &str,
    output: &str,
    config: &ImageDynamicRangeConfig,
    strip_metadata: bool,
    sdr_output: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mode = match config.mode {
            ImageDynamicRangeMode::Boost => "boost",
            ImageDynamicRangeMode::Sdr => "sdr",
            ImageDynamicRangeMode::Original => "original",
        };
        let error = crate::macos::bridge::ffi::processImageDynamicRange(
            input.to_owned(),
            output.to_owned(),
            mode.to_owned(),
            config.intensity,
            strip_metadata,
            sdr_output.unwrap_or_default().to_owned(),
        );
        if error.is_empty() {
            Ok(())
        } else {
            Err(error)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (input, output, config, strip_metadata, sdr_output);
        Err("Image dynamic range processing is available on macOS only".into())
    }
}

pub fn encode_hdr_jpeg(
    base: &str,
    hdr: &str,
    output: &str,
    quality: u8,
    strip_metadata: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let error = crate::macos::bridge::ffi::encodeHdrJpeg(
            base.to_owned(),
            hdr.to_owned(),
            output.to_owned(),
            quality.clamp(1, 100),
            strip_metadata,
        );
        if error.is_empty() {
            Ok(())
        } else {
            Err(error)
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (base, hdr, output, quality, strip_metadata);
        Err("HDR JPEG export is available on macOS only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operations_follow_the_source_and_leave_unknown_images_alone() {
        for range in [DynamicRange::Unknown, DynamicRange::Sdr, DynamicRange::Hdr] {
            assert!(!applies(ImageDynamicRangeMode::Original, range));
            assert_eq!(
                applies(ImageDynamicRangeMode::Boost, range),
                range == DynamicRange::Sdr
            );
            assert_eq!(
                applies(ImageDynamicRangeMode::Sdr, range),
                range == DynamicRange::Hdr
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn jpeg_boost_keeps_gain_map_and_sdr_fallback_at_each_quality() {
        let directory =
            std::env::temp_dir().join(format!("compresso-jpeg-boost-{}", nanoid::nanoid!()));
        std::fs::create_dir(&directory).unwrap();
        let work = super::super::image_codecs::Workspace(directory);
        let source = work.0.join("source.png");
        image::RgbImage::from_pixel(32, 24, image::Rgb([180, 100, 50]))
            .save(&source)
            .unwrap();
        if !inspect(source.to_str().unwrap()).unwrap().supported {
            return;
        }
        for intensity in [1.0, 2.0, 4.0, 8.0] {
            let base = work.0.join("base.png");
            let hdr = work.0.join("hdr.png");
            process_with_sdr_base(
                source.to_str().unwrap(),
                hdr.to_str().unwrap(),
                &ImageDynamicRangeConfig {
                    mode: ImageDynamicRangeMode::Boost,
                    intensity,
                },
                true,
                Some(base.to_str().unwrap()),
            )
            .unwrap();
            for quality in [35, 90] {
                let output = work.0.join(format!("output-{quality}.jpg"));
                encode_hdr_jpeg(
                    base.to_str().unwrap(),
                    hdr.to_str().unwrap(),
                    output.to_str().unwrap(),
                    quality,
                    true,
                )
                .unwrap();
                let info = inspect(output.to_str().unwrap()).unwrap();
                assert!(info.has_gain_map);
                assert_eq!(info.dynamic_range, DynamicRange::Hdr);
                let decoded = work.0.join("decoded-hdr.png");
                process(
                    output.to_str().unwrap(),
                    decoded.to_str().unwrap(),
                    &ImageDynamicRangeConfig {
                        mode: ImageDynamicRangeMode::Original,
                        intensity: 1.0,
                    },
                    true,
                )
                .unwrap();
                let expected = image::open(&hdr).unwrap().to_rgb16();
                let actual = image::open(&decoded).unwrap().to_rgb16();
                for (actual, expected) in actual
                    .get_pixel(16, 12)
                    .0
                    .iter()
                    .zip(expected.get_pixel(16, 12).0)
                {
                    assert!((*actual as i32 - expected as i32).abs() < 2000, "HDR rendition changed at intensity {intensity}, quality {quality}: {actual} vs {expected}");
                }
                // Ordinary JPEG readers see the original SDR rendition, not boosted/clipped pixels.
                let fallback = image::open(&output).unwrap().to_rgb8();
                assert_eq!(fallback.dimensions(), (32, 24));
                for (actual, expected) in fallback.get_pixel(16, 12).0.iter().zip([180i16, 100, 50])
                {
                    assert!(
                        (*actual as i16 - expected).abs() < 15,
                        "SDR fallback changed: {actual} vs {expected}"
                    );
                }
            }
        }
    }

    #[test]
    fn prepared_renditions_cannot_be_injected_through_ipc() {
        let config: super::super::domain::ImageCompressionConfig = serde_json::from_value(serde_json::json!({
            "imageId": "test", "imagePath": "source.png", "convertToExtension": "jpg", "quality": 50,
            "hdrJpegBasePath": "untrusted.png",
        })).unwrap();
        assert!(config.hdr_jpeg_base_path.is_none());
        assert!(serde_json::to_value(config)
            .unwrap()
            .get("hdrJpegBasePath")
            .is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn gain_map_jpeg_is_detected_and_converted_to_sdr() {
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/image-hdr/gain-map.jpg");
        let info = inspect(source.to_str().unwrap()).unwrap();
        if !info.supported {
            return;
        }
        assert!(info.has_gain_map);
        assert_eq!(info.dynamic_range, DynamicRange::Hdr);
        let directory =
            std::env::temp_dir().join(format!("compresso-gainmap-sdr-{}", nanoid::nanoid!()));
        std::fs::create_dir(&directory).unwrap();
        let work = super::super::image_codecs::Workspace(directory);
        let output = work.0.join("sdr.png");
        process(
            source.to_str().unwrap(),
            output.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Sdr,
                intensity: 1.0,
            },
            true,
        )
        .unwrap();
        let info = inspect(output.to_str().unwrap()).unwrap();
        assert_eq!(info.dynamic_range, DynamicRange::Sdr);
        assert!(!info.has_gain_map);
        let pixels = image::open(output).unwrap().to_rgb16();
        // The SDR rendition should keep color and remain below clipped white.
        let pixel = pixels.get_pixel(0, 0);
        assert!(pixel[0] > pixel[1] && pixel[1] > pixel[2]);
        assert!(pixel[0] < 65535);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_boost_and_sdr_conversion_preserve_alpha_and_signal_range() {
        let directory =
            std::env::temp_dir().join(format!("compresso-native-hdr-{}", nanoid::nanoid!()));
        std::fs::create_dir(&directory).unwrap();
        let work = super::super::image_codecs::Workspace(directory);
        let source = work.0.join("source.png");
        let boosted = work.0.join("boosted.png");
        let sdr = work.0.join("sdr.png");
        image::RgbaImage::from_fn(16, 16, |x, _| {
            image::Rgba([200, 180, 100, if x < 8 { 128 } else { 255 }])
        })
        .save(&source)
        .unwrap();
        let info = inspect(source.to_str().unwrap()).unwrap();
        if !info.supported {
            return;
        } // Supported app versions before macOS 15.
        assert_eq!(info.dynamic_range, DynamicRange::Sdr);
        process(
            source.to_str().unwrap(),
            boosted.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Boost,
                intensity: 4.0,
            },
            true,
        )
        .unwrap();
        assert_eq!(
            inspect(boosted.to_str().unwrap()).unwrap().dynamic_range,
            DynamicRange::Hdr
        );
        assert!(super::super::image_codecs::png_is_hdr(&boosted).unwrap());
        let neutral = work.0.join("neutral.png");
        process(
            source.to_str().unwrap(),
            neutral.to_str().unwrap(),
            &ImageDynamicRangeConfig {
                mode: ImageDynamicRangeMode::Boost,
                intensity: 1.0,
            },
            true,
        )
        .unwrap();
        let low = image::open(&neutral).unwrap().to_rgba16();
        let high = image::open(&boosted).unwrap().to_rgba16();
        assert!(high.get_pixel(15, 0)[0] > low.get_pixel(15, 0)[0]);
        for intensity in [f32::NAN, 0.0, 8.1] {
            assert!(process(
                source.to_str().unwrap(),
                neutral.to_str().unwrap(),
                &ImageDynamicRangeConfig {
                    mode: ImageDynamicRangeMode::Boost,
                    intensity,
                },
                true
            )
            .is_err());
        }
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
        assert_eq!(
            inspect(sdr.to_str().unwrap()).unwrap().dynamic_range,
            DynamicRange::Sdr
        );
        assert!(!super::super::image_codecs::png_is_hdr(&sdr).unwrap());
        for path in [&boosted, &sdr] {
            let pixels = image::open(path).unwrap().to_rgba16();
            assert_eq!(pixels.dimensions(), (16, 16));
            assert!((pixels.get_pixel(0, 0)[3] as i32 - 32896).abs() < 260);
            assert_eq!(pixels.get_pixel(15, 0)[3], 65535);
        }
    }
}
