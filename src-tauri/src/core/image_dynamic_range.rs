use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDynamicRangeInfo {
    pub supported: bool,
    pub dynamic_range: DynamicRange,
    pub has_gain_map: bool,
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
    #[cfg(target_os = "macos")]
    {
        let mode = match config.mode {
            ImageDynamicRangeMode::Boost => "boost",
            ImageDynamicRangeMode::Sdr => "sdr",
            ImageDynamicRangeMode::Original => {
                return Err("No dynamic range operation selected".into())
            }
        };
        let error = crate::macos::bridge::ffi::processImageDynamicRange(
            input.to_owned(),
            output.to_owned(),
            mode.to_owned(),
            config.intensity,
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
        let _ = (input, output, config, strip_metadata);
        Err("Image dynamic range processing is available on macOS only".into())
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
        for intensity in [f32::NAN, 0.0, 4.1] {
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
