use crate::core::domain::{ExifInfo, ExifTag, ImageBasicInfo, ImageColorInfo, ImageDimensions};
use exiftool_rs::ExifTool;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

pub struct ImageInfo;

impl ImageInfo {
    pub fn get_basic_info(path: &str) -> Result<ImageBasicInfo, String> {
        let path_obj = Path::new(path);
        let file_name = path_obj
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let size = metadata.len();

        let format = Self::detect_format(path)?;

        let (format_long_name, mime_type) = match format.as_str() {
            "JPEG" => ("Joint Photographic Experts Group", "image/jpeg".to_string()),
            "PNG" => ("Portable Network Graphics", "image/png".to_string()),
            "GIF" => ("Graphics Interchange Format", "image/gif".to_string()),
            "WEBP" => ("WebP Image", "image/webp".to_string()),
            "BMP" => ("Bitmap Image", "image/bmp".to_string()),
            "TIFF" => ("Tagged Image File Format", "image/tiff".to_string()),
            "JXL" => ("JPEG XL", "image/jxl".to_string()),
            "HEIC" => ("High Efficiency Image", "image/heic".to_string()),
            "HEIF" => (
                "High Efficiency Image File Format",
                "image/heif".to_string(),
            ),
            "AVIF" => ("AV1 Image File Format", "image/avif".to_string()),
            "ICO" => ("Icon Image", "image/x-icon".to_string()),
            "PNM" => ("Portable Any Map", "image/x-portable-anymap".to_string()),
            "TGA" => ("Truevision Graphics Adapter", "image/x-tga".to_string()),
            _ => ("Unknown Format", "application/octet-stream".to_string()),
        };

        Ok(ImageBasicInfo {
            filename: file_name,
            format,
            format_long_name: format_long_name.to_string(),
            mime_type,
            size,
        })
    }

    pub fn get_dimensions(path: &str) -> Result<ImageDimensions, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let image = image::ImageReader::new(reader)
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;

        let width = image.width();
        let height = image.height();

        let gcd = Self::gcd(width, height);
        let aspect_ratio = format!("{}/{}", width / gcd, height / gcd);

        let megapixels = (width as f64 * height as f64) / 1_000_000.0;

        let (orientation, dpi) = Self::get_orientation_and_dpi(path)?;

        Ok(ImageDimensions {
            width,
            height,
            aspect_ratio,
            orientation,
            dpi,
            megapixels,
        })
    }

    pub fn get_color_info(path: &str) -> Result<ImageColorInfo, String> {
        let file = File::open(path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let image = image::ImageReader::new(reader)
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;

        let color = image.color();
        let (color_type, has_alpha) = match color {
            image::ColorType::L8 => ("Grayscale (8-bit)".to_string(), false),
            image::ColorType::La8 => ("Grayscale with Alpha (8-bit)".to_string(), true),
            image::ColorType::La16 => ("Grayscale (16-bit)".to_string(), false),
            image::ColorType::Rgb8 => ("RGB (8-bit)".to_string(), false),
            image::ColorType::Rgba8 => ("RGBA (8-bit)".to_string(), true),
            image::ColorType::Rgb16 => ("RGB (16-bit)".to_string(), false),
            image::ColorType::Rgba16 => ("RGBA (16-bit)".to_string(), true),
            _ => ("Unknown".to_string(), false),
        };

        let bit_depth = Self::get_bit_depth(color);

        Ok(ImageColorInfo {
            color_type,
            bit_depth,
            has_alpha,
            color_space: None,
            pixel_format: format!("{:?}", color),
        })
    }

    pub fn get_exif_info(path: &str) -> Result<ExifInfo, String> {
        let et = ExifTool::new();
        let tags_result = et
            .extract_info(path)
            .map_err(|e| format!("Failed to read EXIF data: {}", e))?;

        let mut tags = Vec::new();
        let mut make = None;
        let mut model = None;
        let mut software = None;
        let mut date_time_original = None;
        let mut date_time_digitized = None;
        let mut copyright = None;
        let mut artist = None;
        let mut gps_coordinates = None;
        let mut lens_model = None;
        let mut iso = None;
        let mut exposure_time = None;
        let mut f_number = None;
        let mut focal_length = None;
        let mut flash = None;

        for tag in &tags_result {
            let tag_name = tag.name.to_string();
            let tag_value = tag.print_value.to_string();
            let category = "EXIF".to_string();

            tags.push(ExifTag {
                key: tag_name.clone(),
                value: tag_value.clone(),
                category,
            });

            match tag_name.as_str() {
                "Make" => make = Some(tag_value),
                "Model" => model = Some(tag_value),
                "Software" => software = Some(tag_value),
                "DateTimeOriginal" => date_time_original = Some(tag_value),
                "DateTimeDigitized" | "CreateDate" => date_time_digitized = Some(tag_value),
                "Copyright" => copyright = Some(tag_value),
                "Artist" => artist = Some(tag_value),
                "LensModel" => lens_model = Some(tag_value),
                "ISO" => {
                    if let Ok(iso_val) = tag_value.parse::<u32>() {
                        iso = Some(iso_val);
                    }
                }
                "ExposureTime" => exposure_time = Some(tag_value),
                "FNumber" => f_number = Some(tag_value),
                "FocalLength" => focal_length = Some(tag_value),
                "Flash" => flash = Some(tag_value),
                "GPSLatitude" | "GPSLongitude" => {
                    // GPS coordinates handling will be done separately
                }
                _ => {}
            }
        }

        let gps_lat = tags_result
            .iter()
            .find(|t| t.name == "GPSLatitude")
            .and_then(|t| Self::parse_gps_coordinate(&t.print_value));
        let gps_lon = tags_result
            .iter()
            .find(|t| t.name == "GPSLongitude")
            .and_then(|t| Self::parse_gps_coordinate(&t.print_value));
        let gps_lat_ref = tags_result
            .iter()
            .find(|t| t.name == "GPSLatitudeRef")
            .map(|t| t.print_value.to_string());
        let gps_lon_ref = tags_result
            .iter()
            .find(|t| t.name == "GPSLongitudeRef")
            .map(|t| t.print_value.to_string());

        if let (Some(lat), Some(lon), Some(lat_ref), Some(lon_ref)) =
            (gps_lat, gps_lon, gps_lat_ref, gps_lon_ref)
        {
            let final_lat = if lat_ref == "S" { -lat } else { lat };
            let final_lon = if lon_ref == "W" { -lon } else { lon };
            gps_coordinates = Some((final_lat, final_lon));
        }

        Ok(ExifInfo {
            tags,
            make,
            model,
            software,
            date_time_original,
            date_time_digitized,
            copyright,
            artist,
            gps_coordinates,
            lens_model,
            iso,
            exposure_time,
            f_number,
            focal_length,
            flash,
        })
    }

    fn detect_format(path: &str) -> Result<String, String> {
        let extension = super::image_codecs::extension(path);
        if super::image_codecs::is_modern(&extension) {
            return Ok(extension.to_uppercase());
        }
        let file = File::open(path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let format = image::ImageReader::new(reader)
            .with_guessed_format()
            .map_err(|e| e.to_string())?
            .format();

        Ok(format!("{:?}", format).to_string())
    }

    fn gcd(a: u32, b: u32) -> u32 {
        if b == 0 {
            a
        } else {
            Self::gcd(b, a % b)
        }
    }

    fn get_orientation_and_dpi(path: &str) -> Result<(Option<u32>, Option<(u32, u32)>), String> {
        let et = ExifTool::new();
        let tags_result = et
            .extract_info(path)
            .map_err(|e| format!("Failed to read EXIF data: {}", e))?;

        let mut orientation = None;
        let mut x_density = None;
        let mut y_density = None;

        for tag in &tags_result {
            match tag.name.as_str() {
                "Orientation" => {
                    if let Ok(val) = tag.print_value.parse::<u32>() {
                        orientation = Some(val);
                    }
                }
                "XResolution" => {
                    if let Ok(val) = tag.print_value.parse::<u32>() {
                        x_density = Some(val);
                    }
                }
                "YResolution" => {
                    if let Ok(val) = tag.print_value.parse::<u32>() {
                        y_density = Some(val);
                    }
                }
                _ => {}
            }
        }

        let dpi = match (x_density, y_density) {
            (Some(x), Some(y)) => Some((x, y)),
            _ => None,
        };

        Ok((orientation, dpi))
    }

    fn parse_gps_coordinate(coord_str: &str) -> Option<f64> {
        let parts: Vec<&str> = coord_str.split_whitespace().collect();
        if parts.len() >= 4 {
            let degrees = parts[0].parse::<f64>().ok()?;
            let minutes = parts
                .iter()
                .find(|p| p.ends_with('\''))
                .and_then(|p| p.trim_end_matches('\'').parse::<f64>().ok())?;
            let seconds = parts
                .iter()
                .find(|p| p.ends_with('"'))
                .and_then(|p| p.trim_end_matches('"').parse::<f64>().ok())?;

            Some(degrees + minutes / 60.0 + seconds / 3600.0)
        } else {
            coord_str.parse::<f64>().ok()
        }
    }

    fn get_bit_depth(color: image::ColorType) -> u8 {
        match color {
            image::ColorType::L8
            | image::ColorType::Rgb8
            | image::ColorType::La8
            | image::ColorType::Rgba8 => 8,
            image::ColorType::La16 | image::ColorType::Rgb16 | image::ColorType::Rgba16 => 16,
            _ => 8,
        }
    }

    /// Returns `true` only when `path` is an animated WebP (`VP8X` animation bit or `ANIM`/`ANMF`
    /// chunks); static WebPs and other image formats return `false`.
    pub fn is_animated_webp(path: &str) -> bool {
        let Ok(mut file) = File::open(path) else {
            return false;
        };
        let mut header = [0u8; 256];
        let Ok(len) = file.read(&mut header) else {
            return false;
        };
        is_animated_webp_bytes(&header[..len])
    }
}

fn is_animated_webp_bytes(bytes: &[u8]) -> bool {
    if bytes.len() < 20 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return false;
    }
    let mut pos = 12usize;
    while pos + 8 <= bytes.len() {
        let fourcc = &bytes[pos..pos + 4];
        let chunk_size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        if fourcc == b"VP8X" {
            return bytes.get(pos + 8).is_some_and(|flags| (flags & 0x02) != 0);
        }
        if fourcc == b"ANIM" || fourcc == b"ANMF" {
            return true;
        }
        if fourcc == b"VP8 " || fourcc == b"VP8L" {
            return false;
        }
        // RIFF chunks are padded to an even byte boundary.
        pos = pos.saturating_add(8).saturating_add(chunk_size + (chunk_size & 1));
    }
    false
}

#[cfg(test)]
mod webp_animation_tests {
    use super::is_animated_webp_bytes;

    fn make_webp(chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let mut out = b"RIFF\x00\x00\x00\x00WEBP".to_vec();
        for (id, payload) in chunks {
            out.extend_from_slice(*id);
            out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            out.extend_from_slice(payload);
            if payload.len() % 2 == 1 {
                out.push(0);
            }
        }
        out
    }

    #[test]
    fn detects_animated_and_static_webp_accurately() {
        let static_vp8 = make_webp(&[(b"VP8 ", &[0; 12])]);
        assert!(!is_animated_webp_bytes(&static_vp8));

        let static_vp8l = make_webp(&[(b"VP8L", &[0; 12])]);
        assert!(!is_animated_webp_bytes(&static_vp8l));

        // VP8X with alpha (0x10) and ICC (0x20), animation bit (0x02) clear
        let static_vp8x = make_webp(&[(b"VP8X", &[0x30, 0, 0, 0, 10, 0, 0, 10, 0, 0])]);
        assert!(!is_animated_webp_bytes(&static_vp8x));

        // VP8X with animation bit set (0x02)
        let animated_vp8x = make_webp(&[(b"VP8X", &[0x02, 0, 0, 0, 10, 0, 0, 10, 0, 0])]);
        assert!(is_animated_webp_bytes(&animated_vp8x));

        // Non-WebP bytes
        assert!(!is_animated_webp_bytes(b"\x89PNG\r\n\x1a\n000000000000"));
    }
}
