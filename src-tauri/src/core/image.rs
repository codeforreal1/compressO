use crate::core::domain::{
    BatchImageCompressionProgress, CustomEvents, ImageBatchCompressionResult,
    ImageBatchIndividualCompressionResult, ImageCompressionConfig, ImageCompressionProgress,
    ImageCompressionResult, ImageContainer, ImageTargetSize, MediaTransformHistory, SvgConfig,
};
use crate::core::ffmpeg::build_transform_filters;
use crate::core::ffmpeg::FFMPEG;
use crate::core::media_process::MediaProcessExecutorBuilder;
use crate::core::orientation::{get_image_orientation, reset_exif_orientation, write_upright_copy};
use crate::sys::fs::{ensure_assets_dir, get_file_metadata, get_image_dimension};
use crate::utils::event::EventListenerGuard;
use image::{ImageDecoder, ImageEncoder, ImageReader};
use img_parts::{
    jpeg::Jpeg,
    png::{Png, PngChunk},
    Bytes,
};
use log::error;
use nanoid::nanoid;
use oxipng::{optimize, Deflaters, InFile, Options, OutFile, StripChunks};
use resvg::{self, tiny_skia, usvg};
use std::fs;
use std::io::BufWriter;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Listener};

pub const EXTENSIONS: [&str; 10] = [
    "png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "jxl", "heic", "heif",
];

/// Formats accepted as input but never written; they're converted to PNG by default.
pub const INPUT_ONLY_EXTENSIONS: [&str; 3] = ["bmp", "tiff", "tif"];

/// The qualities searched for a target size (see `ImageCompressor::compress_image_to_size`): the
/// highest is tried first (above it, outputs grow much more than they improve)
const TARGET_SIZE_MAX_QUALITY: u8 = 95;
/// Below this quality an image looks worse than a smaller one at it: the dimensions are lowered
/// first, & lower qualities are only tried at the smallest dimensions
const TARGET_SIZE_FLOOR_QUALITY: u8 = 40;
const TARGET_SIZE_MIN_QUALITY: u8 = 1;
/// The search stops when the qualities that fit & that are too large are this close
const TARGET_SIZE_QUALITY_PRECISION: u8 = 3;
/// An output this close under the size (as a part of it) is kept without searching further
const TARGET_SIZE_CLOSE_ENOUGH: f64 = 0.93;
/// How many times the dimensions are lowered at most
const TARGET_SIZE_SCALE_ROUNDS: usize = 5;
/// The dimensions are never lowered below this longer side, in pixels
const TARGET_SIZE_MIN_LONGER_SIDE: f64 = 320.0;

/// Whether an image can be compressed to a target size: not SVGs (vector) & GIFs (animated), as
/// input or output
pub fn supports_target_size(input_path: &str, convert_to_extension: &str) -> bool {
    let input = super::image_codecs::extension(input_path);
    let output = convert_to_extension.to_lowercase();
    !matches!(input.as_str(), "svg" | "gif") && !matches!(output.as_str(), "svg" | "gif")
}

/// One compression of an image while reaching a target size, kept aside
#[derive(Clone)]
struct SizeAttempt {
    path: PathBuf,
    size: u64,
    quality: u8,
    /// The part of its size it was compressed at (1 for its full size)
    scale: f64,
}

pub struct ImageCompressor {
    app: AppHandle,
    assets_dir: PathBuf,
    owner_window: String,
}

impl ImageCompressor {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let assets_dir = ensure_assets_dir(app)?;

        Ok(Self {
            app: app.to_owned(),
            assets_dir,
            owner_window: String::from("main"),
        })
    }

    /// Window the processes belong to (the main window by default), see `MediaProcessExecutorBuilder`
    pub fn with_owner_window(mut self, label: &str) -> Self {
        self.owner_window = label.to_string();
        self
    }

    pub fn get_asset_dir(&self) -> String {
        self.assets_dir.display().to_string()
    }

    pub fn get_pngquant_command(&self) -> Result<Command, String> {
        super::tool_bundle::command(&self.app, "pngquant")
            .map_err(|e| format!("Failed to create pngquant command: {}", e))
    }

    pub fn get_jpegoptim_command(&self) -> Result<Command, String> {
        super::tool_bundle::command(&self.app, "jpegoptim")
            .map_err(|e| format!("Failed to create jpegoptim command: {}", e))
    }

    pub fn get_gifski_command(&self) -> Result<Command, String> {
        super::tool_bundle::command(&self.app, "gifski")
            .map_err(|e| format!("Failed to create gifski command: {}", e))
    }

    pub async fn compress_image(
        &mut self,
        input_path: &str,
        convert_to_extension: &str,
        svg_scale_factor: Option<f32>,
        is_lossless: Option<bool>,
        quality: u8,
        image_id: &str,
        batch_id: Option<&str>,
        strip_metadata: Option<bool>,
        svg_config: Option<SvgConfig>,
        dimensions: Option<(f64, f64)>,
        transform_history: Option<&MediaTransformHistory>,
    ) -> Result<ImageCompressionResult, String> {
        let original_path = Path::new(input_path);
        if !original_path.exists() {
            return Err(String::from("Image file does not exist."));
        }

        let original_metadata = get_file_metadata(input_path)?;
        let original_extension = original_metadata.extension.to_lowercase();

        let convert_to_extension = if INPUT_ONLY_EXTENSIONS.contains(&convert_to_extension) {
            "png"
        } else {
            convert_to_extension
        };
        let output_extension = convert_to_extension;

        if super::image_codecs::is_modern(&original_extension)
            || super::image_codecs::is_modern(output_extension)
        {
            return self
                .compress_modern_image(
                    input_path,
                    output_extension,
                    svg_scale_factor,
                    is_lossless,
                    quality,
                    image_id,
                    batch_id,
                    strip_metadata,
                    svg_config,
                    dimensions,
                    transform_history,
                )
                .await;
        }

        let supported = EXTENSIONS.iter().any(|&ext| ext == output_extension);
        if !supported {
            return Err(format!(
                "Unsupported convert to extension: {}",
                output_extension
            ));
        }

        let output_filename = format!("{}.{}", image_id, output_extension);
        let output_path: PathBuf = [self.assets_dir.clone(), PathBuf::from(&output_filename)]
            .iter()
            .collect();

        let need_conversion = convert_to_extension != original_extension;

        // avif is decoded to png upfront, so its intermediate files hold png data
        let working_extension = if original_extension == "avif" {
            "png"
        } else {
            original_extension.as_str()
        };

        let intermediate_path: Option<PathBuf> = if need_conversion {
            let temp_filename = format!("{}_temp.{}", image_id, working_extension);
            Some(
                [self.assets_dir.clone(), PathBuf::from(&temp_filename)]
                    .iter()
                    .collect(),
            )
        } else {
            None
        };

        let batch_id = match batch_id {
            Some(id) => String::from(id),
            None => nanoid!(),
        };

        let decoded_avif_path: Option<PathBuf> = if original_extension == "avif" {
            let decoded_path: PathBuf = [
                self.assets_dir.clone(),
                PathBuf::from(format!("{}_decoded.png", image_id)),
            ]
            .iter()
            .collect();
            self.decode_avif_to_png(input_path, decoded_path.to_str().unwrap())
                .await?;
            Some(decoded_path)
        } else {
            None
        };
        let source_path = decoded_avif_path
            .as_ref()
            .and_then(|p| p.to_str())
            .unwrap_or(input_path);

        // Photos stored sideways with an EXIF orientation (e.g. portrait photos from phones) are made
        // upright first: the transforms, the dimensions & the crop are all for the image as it is
        // displayed, and the compressors drop the orientation
        let orientation = if matches!(
            original_extension.as_str(),
            "jpg" | "jpeg" | "png" | "webp" | "tiff" | "tif"
        ) {
            get_image_orientation(input_path)
        } else {
            None
        };
        let upright_path: Option<PathBuf> = match orientation {
            Some(orientation) => {
                let upright_path: PathBuf = [
                    self.assets_dir.clone(),
                    PathBuf::from(format!("{}_upright.{}", image_id, working_extension)),
                ]
                .iter()
                .collect();
                write_upright_copy(source_path, upright_path.to_str().unwrap(), orientation)?;
                Some(upright_path)
            }
            None => None,
        };
        let source_path = upright_path
            .as_ref()
            .and_then(|p| p.to_str())
            .unwrap_or(source_path);

        // Removed once the image is done (not on a timer: an image compressed again right away, e.g.
        // to reach a target size, writes the same file)
        let mut transform_temp_to_remove: Option<PathBuf> = None;
        let transform_input_path = if !original_extension.eq("svg")
            && (dimensions.is_some() || transform_history.is_some())
        {
            let transform_temp_filename = format!("{}_transformed.{}", image_id, working_extension);
            let transform_temp_path: PathBuf = [
                self.assets_dir.clone(),
                PathBuf::from(&transform_temp_filename),
            ]
            .iter()
            .collect();

            // only send the dimensions to ffmpeg if the new dimension > original dimension; otherwise gifski will handle it
            let filtered_dimensions = if original_extension.eq("gif") {
                if let Ok((original_width, _1)) = get_image_dimension(input_path) {
                    if let Some((new_width, _2)) = dimensions {
                        if new_width > (original_width as f64) {
                            dimensions
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                dimensions
            };

            self.apply_spatial_transformations(
                source_path,
                transform_temp_path.to_str().unwrap(),
                filtered_dimensions,
                transform_history,
            )
            .await?;

            let transform_temp_path_string = transform_temp_path.to_str().unwrap().to_string();
            transform_temp_to_remove = Some(transform_temp_path);
            transform_temp_path_string
        } else {
            source_path.to_string()
        };

        let compression_output_path = intermediate_path.as_ref().unwrap_or(&output_path);

        match original_extension.as_str() {
            "png" => {
                self.compress_png(
                    &transform_input_path,
                    compression_output_path.to_str().unwrap(),
                    image_id,
                    batch_id.as_str(),
                    is_lossless.unwrap_or(true),
                    quality,
                )
                .await?
            }
            "jpg" | "jpeg" => {
                self.compress_jpeg(
                    &transform_input_path,
                    compression_output_path.to_str().unwrap(),
                    image_id,
                    batch_id.as_str(),
                    is_lossless.unwrap_or(true),
                    quality,
                )
                .await?
            }
            "webp" => {
                self.compress_webp(
                    &transform_input_path,
                    compression_output_path.to_str().unwrap(),
                    is_lossless.unwrap_or(true),
                    quality,
                )
                .await?
            }
            "gif" => {
                self.compress_gif(
                    &transform_input_path,
                    compression_output_path.to_str().unwrap(),
                    image_id,
                    batch_id.as_str(),
                    is_lossless.unwrap_or(true),
                    quality,
                    dimensions,
                )
                .await?
            }
            "avif" if !need_conversion => {
                self.compress_avif(
                    &transform_input_path,
                    compression_output_path.to_str().unwrap(),
                    quality,
                )
                .await?
            }
            "bmp" | "tiff" | "tif" | "avif" => {
                // No dedicated compressor; these are re-encoded during the conversion below
            }
            "svg" => {
                if convert_to_extension != "svg" {
                    // Completely skip the compression for svg if converting to another format
                } else {
                    self.compress_svg(
                        &transform_input_path,
                        compression_output_path.to_str().unwrap(),
                    )
                    .await?
                }
            }
            _ => {
                return Err(format!(
                    "Unsupported source format: {}. Original file will be copied.",
                    original_extension
                ))
            }
        };

        if !Path::exists(&compression_output_path) {
            // If compression was skipped, copy the original file
            fs::copy(&transform_input_path, &compression_output_path).map_err(|e| e.to_string())?;
        }

        if need_conversion {
            let convert_to_ext = convert_to_extension;
            match original_extension.as_str() {
                "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tiff" | "tif" | "avif" => {
                    if convert_to_ext.eq("svg") {
                        let svg_result = self.convert_raster_to_svg_img(
                            compression_output_path.to_str().unwrap(),
                            output_path.to_str().unwrap(),
                            svg_config.clone(),
                        );

                        // If above conversion fails, retry with png
                        if svg_result.is_err() && original_extension != "png" {
                            log::warn!("[image] Direct SVG conversion failed, converting to PNG and retrying");

                            let temp_png_path = format!(
                                "{}_temp_png.png",
                                output_path.to_str().unwrap().trim_end_matches(".svg")
                            );

                            match self
                                .convert_image_via_ffmpeg(
                                    compression_output_path.to_str().unwrap(),
                                    &temp_png_path,
                                    "png",
                                    100, // full quality
                                )
                                .await
                            {
                                Ok(_) => {
                                    let retry_result = self.convert_raster_to_svg_img(
                                        &temp_png_path,
                                        output_path.to_str().unwrap(),
                                        svg_config.clone(),
                                    );

                                    let _ = fs::remove_file(&temp_png_path);

                                    retry_result?;
                                }
                                Err(e) => {
                                    log::error!("[image] PNG conversion for retry failed: {}", e);
                                    return Err(format!("SVG conversion failed: {}", e));
                                }
                            }
                        } else {
                            svg_result?;
                        }
                    } else if convert_to_ext.eq("avif") {
                        self.compress_avif(
                            compression_output_path.to_str().unwrap(),
                            output_path.to_str().unwrap(),
                            quality,
                        )
                        .await?;
                    } else {
                        self.convert_image_via_ffmpeg(
                            compression_output_path.to_str().unwrap(),
                            output_path.to_str().unwrap(),
                            output_extension,
                            quality,
                        )
                        .await?;
                    }
                }
                "svg" if convert_to_ext.eq("avif") => {
                    let temp_png_path = format!(
                        "{}_temp_png.png",
                        output_path.to_str().unwrap().trim_end_matches(".avif")
                    );
                    self.convert_svg_to_raster_img(
                        compression_output_path.to_str().unwrap(),
                        &temp_png_path,
                        "png",
                        svg_scale_factor,
                    )?;
                    let avif_result = self
                        .compress_avif(&temp_png_path, output_path.to_str().unwrap(), quality)
                        .await;
                    let _ = fs::remove_file(&temp_png_path);
                    avif_result?;
                }
                "svg" => self.convert_svg_to_raster_img(
                    compression_output_path.to_str().unwrap(),
                    output_path.to_str().unwrap(),
                    convert_to_ext,
                    svg_scale_factor,
                )?,
                _ => return Err("Unsupported extension".to_string()),
            }

            // Clean up intermediate temp file
            if let Some(intermediate) = intermediate_path {
                let _ = fs::remove_file(&intermediate);
            }
        }

        if let Some(decoded_avif) = decoded_avif_path {
            let _ = fs::remove_file(&decoded_avif);
        }
        if let Some(upright) = upright_path {
            let _ = fs::remove_file(&upright);
        }
        if let Some(transform_temp) = transform_temp_to_remove {
            let _ = fs::remove_file(&transform_temp);
        }

        if !strip_metadata.unwrap_or(true) {
            match output_extension {
                "png" => {
                    let _ = self.copy_image_metadata(
                        ImageContainer::Png,
                        input_path,
                        output_path.to_str().unwrap(),
                    );
                }
                "jpg" | "jpeg" => {
                    let _ = self.copy_image_metadata(
                        ImageContainer::Jpeg,
                        input_path,
                        output_path.to_str().unwrap(),
                    );
                }
                _ => {
                    // No support for now
                }
            }
            // The kept orientation would rotate the upright pixels again
            if orientation.is_some() {
                let _ = reset_exif_orientation(output_path.to_str().unwrap());
            }
        }

        let compressed_metadata = get_file_metadata(&output_path.to_string_lossy().to_string())?;

        Ok(ImageCompressionResult {
            image_id: image_id.to_string(),
            file_name: output_filename,
            file_path: output_path.display().to_string(),
            file_metadata: Some(compressed_metadata),
            is_target_size_reached: None,
        })
    }

    /// Compresses an image as its config says: to fit within its target size when it has one (see
    /// `compress_image_to_size`), otherwise at its quality
    pub async fn compress_image_config(
        &mut self,
        config: &ImageCompressionConfig,
        batch_id: Option<&str>,
    ) -> Result<ImageCompressionResult, String> {
        if let Some(target) = &config.target_size {
            if supports_target_size(&config.image_path, &config.convert_to_extension) {
                return self.compress_image_to_size(config, batch_id, target).await;
            }
        }
        self.compress_image(
            &config.image_path,
            config.convert_to_extension.as_str(),
            config.svg_scale_factor,
            config.is_lossless,
            config.quality,
            &config.image_id,
            batch_id,
            config.strip_metadata,
            config.svg_config.clone(),
            config.dimensions,
            config.transform_history.as_ref(),
        )
        .await
    }

    /// Compresses an image to fit within a size (see `ImageTargetSize`). The output's size is never
    /// predicted, only measured: each attempt is a full compression, & the one kept becomes the
    /// output as it is (nothing is encoded again after it is chosen), so encoders need not give the
    /// same bytes every time.
    ///
    /// The highest quality that fits is found by halving the range of qualities. When even a
    /// fairly low quality (`TARGET_SIZE_FLOOR_QUALITY`) is larger, the dimensions are lowered by
    /// how much it is over (the size of an image follows its number of pixels) & the qualities
    /// searched again, down to a smallest size, where lower qualities are tried last. The largest
    /// attempt within the size is kept (the most quality), or the smallest when none fits.
    pub async fn compress_image_to_size(
        &mut self,
        config: &ImageCompressionConfig,
        batch_id: Option<&str>,
        target: &ImageTargetSize,
    ) -> Result<ImageCompressionResult, String> {
        let limit = target.size_in_bytes.max(1);
        // Without its dimensions, only the quality is lowered
        let smallest_scale = match target.dimensions {
            Some((width, height)) => {
                (TARGET_SIZE_MIN_LONGER_SIDE / width.max(height).max(1.0)).min(1.0)
            }
            None => 1.0,
        };
        let output_extension = config.convert_to_extension.as_str();

        // Each attempt is moved aside as `<id>_size<n>.<extension>`, as the next one writes the
        // same output
        let mut attempts: Vec<SizeAttempt> = Vec::new();
        let result = async {
            let mut scale = 1.0_f64;
            for round in 0..TARGET_SIZE_SCALE_ROUNDS {
                let highest = self
                    .size_attempt(
                        config,
                        batch_id,
                        scale,
                        TARGET_SIZE_MAX_QUALITY,
                        &mut attempts,
                    )
                    .await?;
                if highest <= limit {
                    break;
                }
                let at_floor = self
                    .size_attempt(
                        config,
                        batch_id,
                        scale,
                        TARGET_SIZE_FLOOR_QUALITY,
                        &mut attempts,
                    )
                    .await?;
                if at_floor <= limit {
                    self.search_quality(
                        config,
                        batch_id,
                        scale,
                        limit,
                        (TARGET_SIZE_FLOOR_QUALITY, TARGET_SIZE_MAX_QUALITY),
                        &mut attempts,
                    )
                    .await?;
                    break;
                }
                let is_smallest =
                    scale <= smallest_scale + f64::EPSILON || round + 1 == TARGET_SIZE_SCALE_ROUNDS;
                if is_smallest {
                    // At the smallest dimensions, a lower quality is the only way left
                    let lowest = self
                        .size_attempt(
                            config,
                            batch_id,
                            scale,
                            TARGET_SIZE_MIN_QUALITY,
                            &mut attempts,
                        )
                        .await?;
                    if lowest <= limit {
                        self.search_quality(
                            config,
                            batch_id,
                            scale,
                            limit,
                            (TARGET_SIZE_MIN_QUALITY, TARGET_SIZE_FLOOR_QUALITY),
                            &mut attempts,
                        )
                        .await?;
                    }
                    break;
                }
                // Pixels for the size it is over at the floor quality, & a little less, as smaller
                // images compress slightly less well; always lower by a step, never below the
                // smallest size
                let estimated = scale * (limit as f64 / at_floor as f64).sqrt() * 0.95;
                scale = estimated.min(scale * 0.9).max(smallest_scale);
            }
            // The lowered dimensions are estimated: an output well under the size is made once
            // more a little larger, at the same quality (below a size that was too large)
            if let Some(fitting) = attempts
                .iter()
                .filter(|attempt| attempt.size <= limit)
                .max_by_key(|attempt| attempt.size)
                .cloned()
            {
                if fitting.scale < 1.0
                    && (fitting.size as f64) < limit as f64 * TARGET_SIZE_CLOSE_ENOUGH
                {
                    let too_large = attempts
                        .iter()
                        .filter(|attempt| {
                            attempt.size > limit
                                && attempt.quality == fitting.quality
                                && attempt.scale > fitting.scale
                        })
                        .map(|attempt| attempt.scale)
                        .fold(1.0_f64, f64::min);
                    let larger =
                        (fitting.scale * (limit as f64 / fitting.size as f64).sqrt() * 0.97)
                            .min(too_large - 0.01)
                            .min(1.0);
                    if larger > fitting.scale * 1.03 {
                        self.size_attempt(config, batch_id, larger, fitting.quality, &mut attempts)
                            .await?;
                    }
                }
            }
            Ok::<(), String>(())
        }
        .await;

        if let Err(error) = result {
            for attempt in &attempts {
                let _ = fs::remove_file(&attempt.path);
            }
            return Err(error);
        }

        let best = attempts
            .iter()
            .filter(|attempt| attempt.size <= limit)
            .max_by_key(|attempt| attempt.size)
            .or_else(|| attempts.iter().min_by_key(|attempt| attempt.size))
            .cloned()
            .ok_or_else(|| String::from("The image could not be compressed."))?;
        log::info!(
            "[image] Target size {} bytes: kept {} bytes (quality {}, {:.0}% of its size) of {} attempts",
            limit,
            best.size,
            best.quality,
            best.scale * 100.0,
            attempts.len()
        );

        // The extension the attempts were written with (e.g. PNG for a BMP)
        let extension = best
            .path
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or(output_extension);
        let output_filename = format!("{}.{}", config.image_id, extension);
        let output_path = self.assets_dir.join(&output_filename);
        for attempt in &attempts {
            if attempt.path != best.path {
                let _ = fs::remove_file(&attempt.path);
            }
        }
        fs::rename(&best.path, &output_path).map_err(|e| e.to_string())?;

        Ok(ImageCompressionResult {
            image_id: config.image_id.clone(),
            file_name: output_filename,
            file_path: output_path.display().to_string(),
            file_metadata: Some(get_file_metadata(output_path.to_str().unwrap())?),
            is_target_size_reached: Some(best.size <= limit),
        })
    }

    /// The highest quality in `(fits, too_large)` whose output is within `limit`, at a part of the
    /// image's size, by halving the range (see `compress_image_to_size`)
    async fn search_quality(
        &mut self,
        config: &ImageCompressionConfig,
        batch_id: Option<&str>,
        scale: f64,
        limit: u64,
        (mut fits, mut too_large): (u8, u8),
        attempts: &mut Vec<SizeAttempt>,
    ) -> Result<(), String> {
        while too_large - fits > TARGET_SIZE_QUALITY_PRECISION {
            let quality = fits + (too_large - fits) / 2;
            let size = self
                .size_attempt(config, batch_id, scale, quality, attempts)
                .await?;
            if size <= limit {
                fits = quality;
                if size as f64 >= limit as f64 * TARGET_SIZE_CLOSE_ENOUGH {
                    break;
                }
            } else {
                too_large = quality;
            }
        }
        Ok(())
    }

    /// One attempt to reach a target size (see `compress_image_to_size`): the image compressed at a
    /// quality & a part of its size, moved aside; its size in bytes
    async fn size_attempt(
        &mut self,
        config: &ImageCompressionConfig,
        batch_id: Option<&str>,
        scale: f64,
        quality: u8,
        attempts: &mut Vec<SizeAttempt>,
    ) -> Result<u64, String> {
        let dimensions = if scale < 1.0 {
            let (width, height) = config
                .target_size
                .as_ref()
                .and_then(|target| target.dimensions)
                .ok_or("The image has no dimensions to lower")?;
            Some((
                (width * scale).round().max(1.0),
                (height * scale).round().max(1.0),
            ))
        } else {
            config.dimensions
        };
        let result = self
            .compress_image(
                &config.image_path,
                config.convert_to_extension.as_str(),
                config.svg_scale_factor,
                // A lossless output cannot be made smaller by its quality
                Some(false),
                quality,
                &config.image_id,
                batch_id,
                config.strip_metadata,
                config.svg_config.clone(),
                dimensions,
                config.transform_history.as_ref(),
            )
            .await?;
        let output = PathBuf::from(&result.file_path);
        let extension = output
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or(config.convert_to_extension.as_str())
            .to_string();
        let path = self.assets_dir.join(format!(
            "{}_size{}.{}",
            config.image_id,
            attempts.len(),
            extension
        ));
        fs::rename(&output, &path).map_err(|e| e.to_string())?;
        let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
        log::info!(
            "[image] Target size attempt {}: quality {}, {:.0}% of its size, {} bytes",
            attempts.len(),
            quality,
            scale * 100.0,
            size
        );
        attempts.push(SizeAttempt {
            path,
            size,
            quality,
            scale,
        });
        Ok(size)
    }

    pub async fn compress_images_batch(
        &mut self,
        batch_id: &str,
        images: Vec<ImageCompressionConfig>,
    ) -> Result<ImageBatchCompressionResult, String> {
        let mut results: std::collections::HashMap<String, ImageCompressionResult> =
            std::collections::HashMap::new();
        let total_count = images.len();

        for (index, image_config) in images.iter().enumerate() {
            let image_id = &image_config.image_id;

            let app_clone = self.app.clone();
            let batch_id_clone = batch_id.to_string();
            let image_id_clone = image_id.clone();

            // Removed again once this media is done (see `EventListenerGuard`)
            // Progress of the whole app (from any window)
            let _progress_listener = {
                let window = app_clone.clone();
                let event_id = app_clone.listen_any(
                    CustomEvents::ImageCompressionProgress.as_ref(),
                    move |evt| {
                        if let Ok(progress) =
                            serde_json::from_str::<ImageCompressionProgress>(evt.payload())
                        {
                            if progress.image_id == image_id_clone {
                                let batch_progress = BatchImageCompressionProgress {
                                    batch_id: batch_id_clone.to_owned(),
                                    current_index: index,
                                    total_count,
                                    image_progress: progress,
                                };
                                let _ = window.emit(
                                    CustomEvents::BatchImageCompressionProgress.as_ref(),
                                    batch_progress,
                                );
                            }
                        }
                    },
                );
                EventListenerGuard::for_app(app_clone.clone(), event_id)
            };

            let config = ImageCompressionConfig {
                strip_metadata: Some(image_config.strip_metadata.unwrap_or(true)),
                ..image_config.clone()
            };

            match self.compress_image_config(&config, Some(batch_id)).await {
                Ok(result) => {
                    let image_id = result.image_id.clone();
                    results.insert(image_id.clone(), result.clone());

                    let app_clone2 = self.app.clone();
                    let batch_id_clone2 = batch_id.to_string();

                    tokio::spawn(async move {
                        {
                            // To the whole app (any window can be compressing)
                            let window = app_clone2.clone();
                            let individual_result = ImageBatchIndividualCompressionResult {
                                batch_id: batch_id_clone2,
                                result,
                            };
                            let _ = window.emit(
                                CustomEvents::BatchImageIndividualCompressionCompletion.as_ref(),
                                individual_result,
                            );
                        }
                    });
                }
                Err(e) => {
                    error!("Failed to compress image at index {}: {}", index, e);
                }
            }
        }

        Ok(ImageBatchCompressionResult { results })
    }

    async fn compress_png(
        &mut self,
        input_path: &str,
        output_path: &str,
        image_id: &str,
        batch_id: &str,
        is_lossless: bool,
        quality: u8,
    ) -> Result<(), String> {
        if is_lossless {
            let mut options = Options::default();

            options.deflate = Deflaters::Libdeflater { compression: 12 };
            options.optimize_alpha = true;
            options.strip = StripChunks::All;

            optimize(
                &InFile::Path(PathBuf::from(input_path)),
                &OutFile::Path {
                    path: Some(PathBuf::from(output_path)),
                    preserve_attrs: false,
                },
                &options,
            )
            .map_err(|e| format!("PNG optimization failed: {:?}", e))?;

            return Ok(());
        } else {
            // pngquant compresses this copy in place: on Windows it reads its arguments in the
            // system's legacy code page, so it cannot open originals whose names have other
            // characters (e.g. the narrow space before "PM" in macOS screenshot names). The copy's
            // name is plain.
            std::fs::copy(input_path, &output_path).map_err(|e| e.to_string())?;

            let quality_str = quality.clamp(1, 100).to_string();

            let result = self
                .run_pngquant(output_path, output_path, image_id, batch_id, &quality_str)
                .await;

            match result {
                Err(e) => {
                    if e.eq("CANCELLED") {
                        return Err(e);
                    }

                    log::warn!(
                        "[image] pngquant attempt 1 failed: {}. Retrying with quality 0-{}...",
                        e,
                        quality
                    );

                    self.run_pngquant(
                        output_path,
                        output_path,
                        image_id,
                        batch_id,
                        &format!("0-{}", quality),
                    )
                    .await?;
                    return Ok(());
                }
                Ok(_) => {
                    return Ok(());
                }
            }
        }
    }

    async fn run_pngquant(
        &mut self,
        input_path: &str,
        output_path: &str,
        image_id: &str,
        batch_id: &str,
        quality_str: &str,
    ) -> Result<PathBuf, String> {
        let mut args: Vec<&str> = vec!["--quality", quality_str, "--force", "--strip"];

        args.push("--output");
        args.push(output_path);
        args.push(input_path);

        log::info!("[image] pngquant command: {:?}", args);

        let mut pngquant_cmd = self.get_pngquant_command()?;

        pngquant_cmd.args(&args);

        let cancel_callback = Arc::new(|| {
            log::info!("CANCELLED PNG");
        });

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(pngquant_cmd)
            .with_cancel_support(
                vec![image_id.to_string(), batch_id.to_string()],
                Some(cancel_callback),
            )
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err(String::from("Failed to run pngquant"));
        }

        Ok(PathBuf::from(output_path))
    }

    async fn compress_jpeg(
        &mut self,
        input_path: &str,
        output_path: &str,
        image_id: &str,
        batch_id: &str,
        is_lossless: bool,
        quality: u8,
    ) -> Result<(), String> {
        std::fs::copy(input_path, &output_path).map_err(|e| e.to_string())?;

        let jpeg_quality = quality.max(1).min(100).to_string();

        let mut args: Vec<&str> = vec!["-o", "-q", "--all-progressive", "--strip-all"];

        if is_lossless {
            args.push("--max=100");
        } else {
            args.push("-m");
            args.push(&jpeg_quality);
        }

        args.push(output_path);

        log::info!("[image] jpegoptim final command{:?}", args);

        let mut jpegoptim_cmd = self.get_jpegoptim_command()?;

        jpegoptim_cmd.args(&args);

        let cancel_callback = Arc::new(|| {
            log::info!("CANCELLED JPEG");
        });

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(jpegoptim_cmd)
            .with_cancel_support(
                vec![image_id.to_string(), batch_id.to_string()],
                Some(cancel_callback),
            )
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err(String::from("Failed to convert to jpeg."));
        }

        Ok(())
    }

    async fn compress_modern_image(
        &mut self,
        input: &str,
        format: &str,
        svg_scale: Option<f32>,
        lossless: Option<bool>,
        quality: u8,
        image_id: &str,
        batch_id: Option<&str>,
        strip_metadata: Option<bool>,
        svg_config: Option<SvgConfig>,
        dimensions: Option<(f64, f64)>,
        transforms: Option<&MediaTransformHistory>,
    ) -> Result<ImageCompressionResult, String> {
        let work = super::image_codecs::Workspace::new(&self.app)?;
        let cancel_ids = vec![
            image_id.to_string(),
            batch_id.unwrap_or(image_id).to_string(),
        ];
        let ext = super::image_codecs::extension(input);
        if format == "jxl"
            && matches!(ext.as_str(), "jpg" | "jpeg")
            && lossless.unwrap_or(true)
            && dimensions.is_none()
            && transforms.is_none()
            && get_image_orientation(input).is_none()
        {
            let output_filename = format!("{image_id}.jxl");
            let output = self.assets_dir.join(&output_filename);
            super::image_codecs::transcode_jpeg(
                &self.app,
                input,
                output.to_str().unwrap(),
                strip_metadata.unwrap_or(true),
                &self.owner_window,
                &cancel_ids,
            )
            .await?;
            return Ok(ImageCompressionResult {
                image_id: image_id.to_string(),
                file_name: output_filename,
                file_path: output.to_string_lossy().into_owned(),
                file_metadata: Some(get_file_metadata(output.to_str().unwrap())?),
                is_target_size_reached: None,
            });
        }
        let decoded = if super::image_codecs::is_modern(&ext) {
            super::image_codecs::decoded_png(&self.app, input, &self.owner_window, &cancel_ids)
                .await?
        } else if ext == "svg" {
            let path = work.0.join("source.png");
            self.convert_svg_to_raster_img(
                input,
                path.to_str().ok_or("Invalid cache path")?,
                "png",
                svg_scale,
            )?;
            path
        } else if ext == "avif" {
            let path = work.0.join("source.png");
            self.decode_avif_to_png(input, path.to_str().ok_or("Invalid cache path")?)
                .await?;
            path
        } else if ext == "gif" {
            return Err("Converting GIF to JPEG XL or HEIC/HEIF is not supported yet; export a still image first".into());
        } else {
            PathBuf::from(input)
        };
        let decoded_str = decoded.to_str().ok_or("Invalid image path")?;
        if !super::image_codecs::is_modern(format) {
            return Box::pin(self.compress_image(
                decoded_str,
                format,
                svg_scale,
                lossless,
                quality,
                image_id,
                batch_id,
                strip_metadata,
                svg_config,
                dimensions,
                transforms,
            ))
            .await;
        }
        // Normalize all supported raster sources to lossless PNG, never recompress the source
        // JPEG/WebP at the requested output quality before the final encode.
        let orientation = get_image_orientation(decoded_str);
        let normalized = work.0.join("normalized.png");
        let profile = {
            let mut decoder = ImageReader::open(&decoded)
                .map_err(|e| e.to_string())?
                .with_guessed_format()
                .map_err(|e| e.to_string())?
                .into_decoder()
                .map_err(|e| e.to_string())?;
            let profile = decoder.icc_profile().map_err(|e| e.to_string())?;
            let exif = if !strip_metadata.unwrap_or(true) {
                let mut exif = decoder.exif_metadata().map_err(|e| e.to_string())?;
                if let Some(data) = &mut exif {
                    let _ = image::metadata::Orientation::remove_from_exif_chunk(data);
                }
                exif
            } else {
                None
            };
            let mut pixels =
                image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
            if let Some(orientation) = orientation {
                pixels.apply_orientation(orientation);
            }
            let mut encoder = image::codecs::png::PngEncoder::new(
                fs::File::create(&normalized).map_err(|e| e.to_string())?,
            );
            if let Some(profile) = &profile {
                encoder
                    .set_icc_profile(profile.clone())
                    .map_err(|e| e.to_string())?;
            }
            if let Some(exif) = exif {
                encoder.set_exif_metadata(exif).map_err(|e| e.to_string())?;
            }
            pixels
                .write_with_encoder(encoder)
                .map_err(|e| e.to_string())?;
            profile
        };
        super::image_codecs::preserve_png_color(&decoded, &normalized)?;
        let transformed = work.0.join("transformed.png");
        let source = if dimensions.is_some() || transforms.is_some() {
            self.apply_spatial_transformations(
                normalized.to_str().unwrap(),
                transformed.to_str().unwrap(),
                dimensions,
                transforms,
            )
            .await?;
            if let Some(profile) = profile {
                let pixels = image::open(&transformed).map_err(|e| e.to_string())?;
                let mut encoder = image::codecs::png::PngEncoder::new(
                    fs::File::create(&transformed).map_err(|e| e.to_string())?,
                );
                encoder
                    .set_icc_profile(profile)
                    .map_err(|e| e.to_string())?;
                pixels
                    .write_with_encoder(encoder)
                    .map_err(|e| e.to_string())?;
            }
            super::image_codecs::preserve_png_color(&normalized, &transformed)?;
            if !strip_metadata.unwrap_or(true) {
                self.copy_image_metadata(
                    ImageContainer::Png,
                    normalized.to_str().unwrap(),
                    transformed.to_str().unwrap(),
                )?;
            }
            &transformed
        } else {
            &normalized
        };
        let output_filename = format!("{image_id}.{format}");
        let output = self.assets_dir.join(&output_filename);
        super::image_codecs::encode(
            &self.app,
            source.to_str().unwrap(),
            output.to_str().unwrap(),
            format,
            quality,
            lossless.unwrap_or(true),
            &self.owner_window,
            &cancel_ids,
        )
        .await?;
        Ok(ImageCompressionResult {
            image_id: image_id.to_string(),
            file_name: output_filename,
            file_path: output.to_string_lossy().into_owned(),
            file_metadata: Some(get_file_metadata(output.to_str().unwrap())?),
            is_target_size_reached: None,
        })
    }

    async fn compress_webp(
        &mut self,
        input_path: &str,
        output_path: &str,
        is_lossless: bool,
        quality: u8,
    ) -> Result<(), String> {
        let img = ImageReader::open(input_path)
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;

        let width = img.width();
        let height = img.height();
        let rgba: Vec<u8> = img.to_rgba8().into_raw();

        let webp_data = if is_lossless {
            let encoder = webp::Encoder::from_rgba(&rgba, width, height);
            encoder.encode_lossless()
        } else {
            let encoder_quality = quality.clamp(0, 100);
            let encoder = webp::Encoder::from_rgba(&rgba, width, height);
            encoder.encode(encoder_quality as f32)
        };

        std::fs::write(&output_path, webp_data.to_vec()).map_err(|e| e.to_string())?;

        Ok(())
    }

    async fn compress_avif(
        &self,
        input_path: &str,
        output_path: &str,
        quality: u8,
    ) -> Result<(), String> {
        // Intermediate files may carry another format's extension, so detect it from content
        let img = ImageReader::open(input_path)
            .and_then(|reader| reader.with_guessed_format())
            .map_err(|e| e.to_string())?
            .decode()
            .map_err(|e| e.to_string())?;

        let width = img.width();
        let height = img.height();
        let rgba: Vec<u8> = img.to_rgba8().into_raw();

        let file = fs::File::create(output_path).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);
        // speed: 1 (slowest, smallest) - 10 (fastest)
        let encoder = image::codecs::avif::AvifEncoder::new_with_speed_quality(
            &mut writer,
            6,
            quality.clamp(1, 100),
        );
        encoder
            .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// The image crate can't decode avif, so let ffmpeg decode it to png first
    async fn decode_avif_to_png(&self, input_path: &str, output_path: &str) -> Result<(), String> {
        // ffmpeg exposes the avif alpha plane as a second stream, so merge it back when present
        let with_alpha = vec![
            "-i",
            input_path,
            "-filter_complex",
            "[0:v:0][0:v:1]alphamerge",
            "-frames:v",
            "1",
            "-y",
            output_path,
        ];
        let without_alpha = vec!["-i", input_path, "-frames:v", "1", "-y", output_path];

        for cmd_args in [with_alpha, without_alpha] {
            let ffmpeg = FFMPEG::new(&self.app)?.with_owner_window(&self.owner_window);
            let mut ffmpeg_cmd = ffmpeg.get_ffmpeg_command()?;
            ffmpeg_cmd.args(&cmd_args);

            let executor = MediaProcessExecutorBuilder::new(self.app.clone())
                .owner_window(&self.owner_window)
                .command(ffmpeg_cmd)
                .build()?;

            if executor.spawn_and_wait().await?.success() && Path::new(output_path).exists() {
                return Ok(());
            }
        }

        Err(String::from("Failed to decode avif image."))
    }

    async fn compress_gif(
        &mut self,
        input_path: &str,
        output_path: &str,
        image_id: &str,
        batch_id: &str,
        is_lossless: bool,
        quality: u8,
        dimensions: Option<(f64, f64)>,
    ) -> Result<(), String> {
        let output_path_str = output_path.to_string();

        let gifski_quality = if is_lossless {
            100 // No support for true lossless, we'll just compress into highest quality
        } else {
            quality.clamp(1, 100)
        };

        let quality_str = gifski_quality.to_string();

        let mut args = vec!["-Q", &quality_str];

        let width_string: String = if dimensions.is_some() {
            let (w, _) = dimensions.unwrap();
            (w.round() as u32).to_string()
        } else {
            String::from("")
        };

        if width_string.len() > 0 {
            args.extend_from_slice(&["-W", &width_string]);
        }

        args.extend_from_slice(&["-o", &output_path_str, input_path]);

        log::info!("[image] gifski command: {:?}", args);

        let mut gifski_cmd = self.get_gifski_command()?;

        gifski_cmd.args(&args);

        let cancel_callback = Arc::new(|| {
            log::info!("CANCELLED GIF");
        });

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(gifski_cmd)
            .with_cancel_support(
                vec![image_id.to_string(), batch_id.to_string()],
                Some(cancel_callback),
            )
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err(String::from("gifski failed"));
        }

        Ok(())
    }

    async fn compress_svg(&mut self, input_path: &str, output_path: &str) -> Result<(), String> {
        let svg_content =
            svgcleaner::cleaner::load_file(input_path).map_err(|err| err.to_string())?;

        let tree = usvg::Tree::from_str(&svg_content, &usvg::Options::default())
            .map_err(|err| err.to_string())?;
        let normalized_svg = tree.to_string(&usvg::WriteOptions::default());

        let mut doc =
            svgcleaner::cleaner::parse_data(&normalized_svg, &svgcleaner::ParseOptions::default())
                .map_err(|err| err.to_string())?;

        svgcleaner::cleaner::clean_doc(
            &mut doc,
            &svgcleaner::CleaningOptions {
                remove_unused_defs: true,
                resolve_use: false,
                ungroup_groups: false,
                ungroup_defs: false,
                group_by_style: false,
                merge_gradients: false,
                remove_title: true,
                remove_desc: true,
                remove_metadata: true,
                remove_dupl_linear_gradients: true,
                remove_dupl_radial_gradients: true,
                remove_dupl_fe_gaussian_blur: true,
                remove_invalid_stops: true,
                remove_invisible_elements: true,
                remove_version: true,
                remove_unreferenced_ids: true,
                trim_ids: true,
                remove_xmlns_xlink_attribute: true,
                remove_needless_attributes: true,
                remove_gradient_attributes: true,
                remove_default_attributes: true,
                join_style_attributes: svgcleaner::StyleJoinMode::All,
                apply_transform_to_shapes: true,
                apply_transform_to_paths: true,
                apply_transform_to_gradients: true,
                paths_to_relative: true,
                convert_shapes: false,
                convert_segments: false,
                remove_unused_segments: false,
                coordinates_precision: 2,
                properties_precision: 2,
                paths_coordinates_precision: 2,
                transforms_precision: 2,
                remove_text_attributes: false,
                remove_unused_coordinates: false,
                regroup_gradient_stops: false,
            },
            &svgcleaner::WriteOptions::default(),
        )
        .map_err(|err| err.to_string())?;

        svgcleaner::cleaner::save_file(&doc.to_string().into_bytes(), output_path)
            .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub fn convert_raster_to_svg_img(
        &self,
        input_path: &str,
        output_path: &str,
        svg_config: Option<SvgConfig>,
    ) -> Result<(), String> {
        // @ref: https://www.visioncortex.org/vtracer/
        let config = svg_config.unwrap_or_default();

        let preset = if config.is_bw.unwrap_or(false) {
            vtracer::Preset::Bw
        } else {
            vtracer::Preset::Poster
        };

        vtracer::convert_image_to_svg(
            &PathBuf::from(input_path),
            &PathBuf::from(output_path),
            vtracer::Config {
                filter_speckle: config.filter_speckle.unwrap_or(4usize), // Filter Speckle: (0-128); higher is cleaner/smoother; @default=4
                color_precision: config.color_precision.unwrap_or(6i32), //  Color Precision: (1-8); higher is more accurate color but can over-saturate; @default=6
                layer_difference: config.layer_difference.unwrap_or(16i32), // Gradient Step: (0-128); higher is less layers; @default=16
                corner_threshold: config.corner_threshold.unwrap_or(60i32), // Corner threshold: (0-180); higher is smoother; @default=60
                length_threshold: config.length_threshold.unwrap_or(4.0f64), // Segment Length: (0-10); higher is more coarse; @default=4
                splice_threshold: config.splice_threshold.unwrap_or(45i32), // Splice Threshold: (0-180); higher is less accurate; @default 45
                ..vtracer::Config::from_preset(preset)
            },
        )
        .map_err(|err| err.to_string())?;

        Ok(())
    }

    pub fn convert_svg_to_raster_img(
        &self,
        input_path: &str,
        output_path: &str,
        output_format: &str,
        scale_factor: Option<f32>,
    ) -> Result<(), String> {
        let svg_data = fs::read(input_path).map_err(|err| err.to_string())?;
        let svg_string = std::str::from_utf8(&svg_data).map_err(|err| err.to_string())?;

        let tree = usvg::Tree::from_str(svg_string, &usvg::Options::default())
            .map_err(|err| err.to_string())?;

        let pixmap_size = tree.size().to_int_size();

        let scale_factor = scale_factor.unwrap_or(2.0);
        let scaled_width = (pixmap_size.width() as f32 * scale_factor) as u32;
        let scaled_height = (pixmap_size.height() as f32 * scale_factor) as u32;

        let mut pixmap =
            tiny_skia::Pixmap::new(scaled_width, scaled_height).ok_or("Failed to create pixmap")?;

        resvg::render(
            &tree,
            tiny_skia::Transform::from_scale(scale_factor, scale_factor),
            &mut pixmap.as_mut(),
        );

        match output_format {
            "png" => {
                pixmap
                    .save_png(&output_path)
                    .map_err(|err| err.to_string())?;
            }
            "jpg" | "jpeg" => {
                let rgba_data = pixmap.data();
                let mut rgb_data = Vec::with_capacity((scaled_width * scaled_height * 3) as usize);

                for pixel in rgba_data.chunks(4) {
                    let r = pixel[0];
                    let g = pixel[1];
                    let b = pixel[2];
                    let a = pixel[3] as f32 / 255.0;

                    // Composite over black background (0, 0, 0)
                    let r_composite = (r as f32 * a) as u8;
                    let g_composite = (g as f32 * a) as u8;
                    let b_composite = (b as f32 * a) as u8;

                    rgb_data.push(r_composite);
                    rgb_data.push(g_composite);
                    rgb_data.push(b_composite);
                }

                let file = fs::File::create(&output_path).map_err(|e| e.to_string())?;
                let mut writer = BufWriter::new(file);
                let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 100);
                encoder
                    .write_image(
                        &rgb_data,
                        scaled_width,
                        scaled_height,
                        image::ExtendedColorType::Rgb8,
                    )
                    .map_err(|err| err.to_string())?;
            }
            "webp" => {
                let encoder = webp::Encoder::from_rgba(pixmap.data(), scaled_width, scaled_height);
                let webp_data = encoder.encode_lossless();

                fs::write(&output_path, webp_data.to_vec()).map_err(|err| err.to_string())?;
            }
            _ => return Err(format!("Unsupported output format: {}", output_format)),
        }

        Ok(())
    }

    pub async fn convert_image_via_ffmpeg(
        &self,
        input_path: &str,
        output_path: &str,
        output_format: &str,
        quality: u8,
    ) -> Result<(), String> {
        if !PathBuf::from(input_path).exists() {
            return Err(String::from("Input image file does not exist."));
        }

        let mut cmd_args: Vec<String> = Vec::new();

        cmd_args.push("-i".to_string());
        cmd_args.push(input_path.to_string());

        let output_format_lower = output_format.to_lowercase();
        match output_format_lower.as_str() {
            "jpg" | "jpeg" => {
                let jpeg_qscale = (((100 - quality) as f32 / 99.0) * 9.0 + 1.0).round() as u32;
                cmd_args.push("-q:v".to_string()); // 1-31 scale (lower is better) but we'll interpolate between 1-10 only
                cmd_args.push(jpeg_qscale.to_string());
                cmd_args.push("-filter_complex".to_string());
                cmd_args.push(
                    "color=black:s=1x1[bg];[bg][0:v]scale2ref[bg][img];[bg][img]overlay[out]"
                        .to_string(),
                );
                cmd_args.push("-map".to_string());
                cmd_args.push("[out]".to_string());
                cmd_args.push("-frames:v".to_string());
                cmd_args.push("1".to_string());
            }
            "png" => {
                let compression_level = (((quality as f32 - 1.0) / 99.0 * 4.0) + 5.0).round() as u8;
                cmd_args.push("-compression_level".to_string());
                cmd_args.push(compression_level.to_string()); // 0-9 (higher is better) but we'll interpolate between 4-9 only
                cmd_args.push("-pred".to_string());
                cmd_args.push("mixed".to_string());
            }
            "webp" => {
                let webp_quality = ((quality as f32 - 1.0) / 99.0 * 50.0 + 50.0).round() as u8;
                cmd_args.push("-q:v".to_string());
                cmd_args.push(webp_quality.to_string()); // 0-100 (higher is better) but we'll interpolate between 50-100 only
                cmd_args.push("-lossless".to_string());
                cmd_args.push("0".to_string());
            }
            _ => {
                return Err("Unsupported output format".to_string());
            }
        }

        cmd_args.push("-map_metadata".to_string());
        cmd_args.push("-1".to_string());

        cmd_args.push("-y".to_string());
        cmd_args.push(output_path.to_string());

        log::info!("[ffmpeg-image] conversion command: {:?}", cmd_args);

        let ffmpeg = FFMPEG::new(&self.app)?.with_owner_window(&self.owner_window);
        let mut ffmpeg_cmd = ffmpeg.get_ffmpeg_command()?;

        ffmpeg_cmd.args(&cmd_args);

        let conversion_id = format!("img_convert_{}", nanoid!());

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(ffmpeg_cmd)
            .with_cancel_support(vec![conversion_id], None)
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err(String::from("FFmpeg conversion failed"));
        }

        if !PathBuf::from(output_path).exists() {
            return Err(String::from("Output file was not created"));
        }

        let output_metadata = get_file_metadata(&output_path)?;
        if output_metadata.size == 0 {
            return Err(String::from("Output file is empty"));
        }

        Ok(())
    }

    fn copy_image_metadata(
        &self,
        container: ImageContainer,
        src: &str,
        dst: &str,
    ) -> Result<(), String> {
        match container {
            ImageContainer::Png => {
                let src_bytes = fs::read(src).map_err(|err| err.to_string())?;
                let dst_bytes = fs::read(dst).map_err(|err| err.to_string())?;

                let src_png =
                    Png::from_bytes(Bytes::from(src_bytes)).map_err(|err| err.to_string())?;
                let mut dst_png =
                    Png::from_bytes(Bytes::from(dst_bytes)).map_err(|err| err.to_string())?;

                let metadata_kinds = [b"tEXt", b"zTXt", b"iTXt", b"iCCP", b"eXIf"];
                let mut chunks_to_keep: Vec<PngChunk> = Vec::new();

                for chunk in dst_png.chunks() {
                    let kind = chunk.kind();
                    let is_metadata = metadata_kinds.iter().any(|&mk| kind == *mk);
                    if !is_metadata {
                        chunks_to_keep.push(chunk.clone());
                    }
                }

                dst_png.chunks_mut().clear();
                for chunk in chunks_to_keep {
                    dst_png.chunks_mut().push(chunk);
                }

                for chunk in src_png.chunks() {
                    let kind = chunk.kind();
                    if kind == *b"tEXt"
                        || kind == *b"zTXt"
                        || kind == *b"iTXt"
                        || kind == *b"iCCP"
                        || kind == *b"eXIf"
                    {
                        dst_png
                            .chunks_mut()
                            .insert(1, PngChunk::new(kind, chunk.contents().clone()));
                    }
                }

                let encoded_bytes = dst_png.encoder().bytes();
                fs::write(dst, encoded_bytes).map_err(|err| err.to_string())?;
            }
            ImageContainer::Jpeg => {
                let src_bytes = fs::read(src).map_err(|err| err.to_string())?;
                let dst_bytes = fs::read(dst).map_err(|err| err.to_string())?;

                let src_jpeg =
                    Jpeg::from_bytes(Bytes::from(src_bytes)).map_err(|err| err.to_string())?;
                let mut dst_jpeg =
                    Jpeg::from_bytes(Bytes::from(dst_bytes)).map_err(|err| err.to_string())?;

                for segment in src_jpeg.segments() {
                    let marker = segment.marker();
                    if (0xE0..=0xEF).contains(&marker) || marker == 0xFE {
                        dst_jpeg.segments_mut().insert(1, segment.clone());
                    }
                }

                fs::write(dst, dst_jpeg.encoder().bytes()).map_err(|err| err.to_string())?;
            }
        }

        Ok(())
    }

    /// Applies spatial transformations (crop, rotate, flip, scale) to an image using FFmpeg
    async fn apply_spatial_transformations(
        &self,
        input_path: &str,
        output_path: &str,
        dimensions: Option<(f64, f64)>,
        transform_history: Option<&MediaTransformHistory>,
    ) -> Result<(), String> {
        if !PathBuf::from(input_path).exists() {
            return Err(String::from("Input image file does not exist."));
        }

        let mut filters = build_transform_filters(transform_history, dimensions);

        // Palette images (e.g. pngquant output) can't go through the transform filters as-is, and
        // ffmpeg's automatic conversion picks a format without alpha, turning transparent pixels
        // opaque. Converting to rgba first keeps the transparency.
        let extension = Path::new(input_path)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if !filters.is_empty() && !["jpg", "jpeg", "gif"].contains(&extension.as_str()) {
            let high_depth = ImageReader::open(input_path)
                .ok()
                .and_then(|reader| reader.with_guessed_format().ok())
                .and_then(|reader| reader.into_decoder().ok())
                .is_some_and(|decoder| {
                    decoder.color_type().bits_per_pixel()
                        / decoder.color_type().channel_count() as u16
                        > 8
                });
            filters.insert(
                0,
                if high_depth {
                    "format=rgba64le"
                } else {
                    "format=rgba"
                }
                .to_string(),
            );
        }
        let filter_complex = filters.join(",");

        let mut cmd_args: Vec<String> = Vec::new();
        cmd_args.push("-i".to_string());
        cmd_args.push(input_path.to_string());

        if !filter_complex.is_empty() {
            cmd_args.push("-vf".to_string());
            cmd_args.push(filter_complex);
        }

        cmd_args.push("-map_metadata".to_string());
        cmd_args.push("-1".to_string());

        cmd_args.push("-y".to_string());
        cmd_args.push(output_path.to_string());

        log::info!("[image-transform] FFmpeg command: {:?}", cmd_args);

        let ffmpeg = FFMPEG::new(&self.app)?.with_owner_window(&self.owner_window);
        let mut ffmpeg_cmd = ffmpeg.get_ffmpeg_command()?;

        ffmpeg_cmd.args(&cmd_args);

        let executor = MediaProcessExecutorBuilder::new(self.app.clone())
            .owner_window(&self.owner_window)
            .command(ffmpeg_cmd)
            .build()?;

        let result = executor.spawn_and_wait().await?;

        if !result.success() {
            return Err(String::from("FFmpeg transformation failed"));
        }

        if !PathBuf::from(output_path).exists() {
            return Err(String::from("Transformed output file was not created"));
        }

        let output_metadata = get_file_metadata(&output_path)?;
        if output_metadata.size == 0 {
            return Err(String::from("Transformed output file is empty"));
        }

        Ok(())
    }
}
