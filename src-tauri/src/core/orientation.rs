//! EXIF orientation of photos. Cameras & phones often store a portrait photo as landscape pixels
//! with an orientation in its metadata ("rotate 90° when displaying"), which viewers apply. FFmpeg
//! & the compressors ignore it (and drop it), so such photos are made upright before any edit:
//! their pixels are rotated/flipped, and the orientation kept in the metadata is reset.

use std::fs;
use std::io::BufWriter;
use std::path::Path;

use image::codecs::jpeg::JpegEncoder;
use image::metadata::Orientation;
use image::{ImageDecoder, ImageReader};
use img_parts::{jpeg::Jpeg, png::Png, Bytes, ImageEXIF};

/// Orientation of an image from its metadata; `None` when it is upright (or not known)
pub fn get_image_orientation(path: &str) -> Option<Orientation> {
    let mut decoder = ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .into_decoder()
        .ok()?;
    match decoder.orientation().ok()? {
        Orientation::NoTransforms => None,
        orientation => Some(orientation),
    }
}

/// Whether an orientation turns the image by a quarter, so its width & height are swapped
pub fn swaps_width_and_height(orientation: Orientation) -> bool {
    matches!(
        orientation,
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    )
}

/// Writes an upright copy of an image (its pixels rotated/flipped by `orientation`), in the format of
/// `output_path`'s extension. JPEGs are written at full quality, as they are compressed afterwards.
pub fn write_upright_copy(
    input_path: &str,
    output_path: &str,
    orientation: Orientation,
) -> Result<(), String> {
    let mut image = ImageReader::open(input_path)
        .map_err(|err| err.to_string())?
        .with_guessed_format()
        .map_err(|err| err.to_string())?
        .decode()
        .map_err(|err| err.to_string())?;
    image.apply_orientation(orientation);

    let extension = Path::new(output_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if matches!(extension.as_str(), "jpg" | "jpeg") {
        let file = fs::File::create(output_path).map_err(|err| err.to_string())?;
        // JPEG has no alpha channel
        let image = image::DynamicImage::ImageRgb8(image.to_rgb8());
        image
            .write_with_encoder(JpegEncoder::new_with_quality(BufWriter::new(file), 100))
            .map_err(|err| err.to_string())
    } else {
        image.save(output_path).map_err(|err| err.to_string())
    }
}

/// Resets the orientation kept in an image's EXIF to upright, for an image whose pixels were made
/// upright: otherwise viewers would rotate it again. Only JPEG & PNG keep metadata.
pub fn reset_exif_orientation(path: &str) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let bytes = Bytes::from(fs::read(path).map_err(|err| err.to_string())?);

    let reset = |exif: Option<Bytes>| {
        exif.map(|exif| {
            let mut exif = exif.to_vec();
            let _ = Orientation::remove_from_exif_chunk(&mut exif);
            Bytes::from(exif)
        })
    };

    let encoded = match extension.as_str() {
        "jpg" | "jpeg" => {
            let mut jpeg = Jpeg::from_bytes(bytes).map_err(|err| err.to_string())?;
            let Some(exif) = reset(jpeg.exif()) else {
                return Ok(());
            };
            jpeg.set_exif(Some(exif));
            jpeg.encoder().bytes()
        }
        "png" => {
            let mut png = Png::from_bytes(bytes).map_err(|err| err.to_string())?;
            let Some(exif) = reset(png.exif()) else {
                return Ok(());
            };
            png.set_exif(Some(exif));
            png.encoder().bytes()
        }
        _ => return Ok(()),
    };
    fs::write(path, encoded).map_err(|err| err.to_string())
}
