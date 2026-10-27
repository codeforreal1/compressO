/**
 * Compressing an image to a file size (e.g. 500 KB for a form) instead of a quality. The backend
 * finds the highest quality that fits, & lowers the dimensions only when even the lowest quality
 * is larger (see `compress_image_to_size` in `src-tauri/src/core/image.rs`). Not for SVGs (vector)
 * & GIFs (animated).
 */

/** A kilobyte as sizes are shown in the app (see `BYTES_PER_MB` in `targetSize.ts`) */
export const BYTES_PER_KB = 1000

/** A megabyte in kilobytes, for a target size shown in MB */
export const KB_PER_MB = 1000

export const DEFAULT_IMAGE_TARGET_SIZE_IN_KB = 500
export const MIN_IMAGE_TARGET_SIZE_IN_KB = 10
export const MAX_IMAGE_TARGET_SIZE_IN_KB = 100 * KB_PER_MB

/** How much the target size's arrows change it, in KB, & while shown in MB */
export const IMAGE_TARGET_SIZE_STEP_IN_KB = 50
export const IMAGE_TARGET_SIZE_STEP_IN_MB = 0.5

const UNSUPPORTED_EXTENSIONS = ['svg', 'gif']

/** Whether an image can be compressed to a size, by its format & the one it is converted to */
export function supportsImageTargetSize(
  extension: string | null | undefined,
  convertToExtension: string | null | undefined,
) {
  const output =
    !convertToExtension || convertToExtension === '-'
      ? extension
      : convertToExtension
  return ![extension, output].some((value) =>
    UNSUPPORTED_EXTENSIONS.includes((value ?? '').toLowerCase()),
  )
}

/** A target size as shown, e.g. `500 KB` or `1.5 MB` */
export function formatImageTargetSize(sizeInKB: number) {
  if (sizeInKB >= KB_PER_MB) {
    const sizeInMB = sizeInKB / KB_PER_MB
    return `${Number.isInteger(sizeInMB) ? sizeInMB : sizeInMB.toFixed(1)} MB`
  }
  return `${Math.round(sizeInKB)} KB`
}
