/**
 * Compressing a video to a file size (e.g. 10 MB for Discord) instead of a quality: the bitrate,
 * resolution & frame rate a video gets to fit in a size. Used for the estimate shown under the
 * target size, and for what is sent to the backend (see `getMediaItemConfig`), which encodes at the
 * bitrate and encodes again lower while the output is still larger.
 */

/** How much the target size's arrows change it, in MB */
export const TARGET_SIZE_STEP_IN_MB = 1

export const DEFAULT_TARGET_SIZE_IN_MB = 10

/** A gigabyte in megabytes (see `BYTES_PER_MB`), for a target size shown in GB */
export const MB_PER_GB = 1000

/** How much the target size's arrows change it while shown in GB */
export const TARGET_SIZE_STEP_IN_GB = 0.1
export const MIN_TARGET_SIZE_IN_MB = 1
export const MAX_TARGET_SIZE_IN_MB = 10000

/**
 * A megabyte as sizes are shown in the app (& by Finder on macOS, see
 * `formatBytes`): 1,000,000 bytes, so an output within its target size never reads as larger. It is
 * also within a limit counted in 1,048,576-byte megabytes.
 */
export const BYTES_PER_MB = 1000 * 1000

/** Part of the size kept for the container & the encoder's drift from the bitrate */
const SIZE_MARGIN = 0.95

/** Below this video bitrate (kbit/s), a video is not watchable at any resolution */
const MIN_VIDEO_BITRATE = 100

/**
 * Bits per pixel of each frame a codec needs to look acceptable: the resolution & frame rate are
 * lowered until a video gets at least this much. More efficient codecs need less.
 */
const MIN_BITS_PER_PIXEL: Record<string, number> = {
  libx264: 0.05,
  libx265: 0.035,
  'libvpx-vp9': 0.04,
  'libaom-av1': 0.03,
  libsvtav1: 0.03,
}
const DEFAULT_MIN_BITS_PER_PIXEL = MIN_BITS_PER_PIXEL.libx264

/**
 * With the size the quality settings give known (see `-sizeEstimate.ts`), simple footage (e.g. a
 * screen recording) needs far fewer bits than the above: the resolution is kept down to this part
 * of the bits the quality settings would use, & never below the lowest
 */
const QUALITY_BITS_SHARE = 0.6
const LOWEST_BITS_PER_PIXEL = 0.002

/**
 * The quality settings are used when their estimated size is within this much over the target
 * size too (the estimate is not exact, & a larger output is compressed again at the bitrate)
 */
const QUALITY_FIT_MARGIN = 1.1

/** The shorter sides a video is lowered to (e.g. 720 for 1280x720), from the largest */
const RESOLUTION_STEPS = [2160, 1440, 1080, 720, 540, 480, 360, 240] as const

/** The frame rates a video is lowered to, before its resolution is */
const FRAME_RATE_STEPS = [30, 24] as const

export type TargetSizePlanInput = {
  targetSizeInMB: number
  /** The output's duration, in seconds (only the trimmed parts, with the speed) */
  durationInSeconds: number
  /**
   * The largest size the video can have: its size after transforms, or the resolution chosen
   * (which is then an upper limit)
   */
  dimensions: { width: number; height: number }
  /** The highest frame rate: the video's own, or the one chosen (an upper limit) */
  fps: number | null
  /** The video's size & full duration, so it is never made larger than it is */
  sourceSizeInBytes: number | null
  sourceDurationInSeconds: number | null
  /** Audio tracks kept in the output (0 without audio) */
  audioTrackCount: number
  /** The audio bitrate chosen (kbit/s), or `null` to choose one that suits the size */
  audioBitrate: number | null
  /** The video codec chosen, or `null` for H.264 */
  videoCodec: string | null
  /** The estimated size at the quality settings, in bytes, when known */
  qualitySizeInBytes: number | null
}

export type TargetSizePlan = {
  /** Whether the video fits in the size at an acceptable quality */
  isReachable: boolean
  /** The smallest size it can have at an acceptable quality, in MB */
  minimumSizeInMB: number
  /** The bitrates it is encoded at, in kbit/s */
  videoBitrate: number
  audioBitrate: number | null
  /** The size it is encoded at (lowered to fit), and whether it is lower than the input's */
  dimensions: [number, number]
  isResolutionLowered: boolean
  /** The frame rate it is encoded at, when lowered to fit */
  fps: number | null
  /** The size in bytes the backend keeps it under */
  sizeInBytes: number
  /**
   * Whether the quality settings already fit (by the estimate): it is compressed at them, at its
   * full resolution, & only at the bitrate when that still came out larger
   */
  fitsAtQuality: boolean
}

const toEven = (value: number) => Math.max(2, Math.round(value / 2) * 2)

/** An audio bitrate (kbit/s) that suits a total bitrate: less of a small size goes to the audio */
function getAudioBitrate(totalBitrate: number) {
  if (totalBitrate >= 2000) return 128
  if (totalBitrate >= 800) return 96
  if (totalBitrate >= 300) return 64
  return 48
}

/** How a video fits in a target size (see the top of this file) */
export function planTargetSize(input: TargetSizePlanInput): TargetSizePlan {
  const {
    targetSizeInMB,
    durationInSeconds,
    dimensions,
    sourceSizeInBytes,
    sourceDurationInSeconds,
    audioTrackCount,
    videoCodec,
  } = input
  const duration = Math.max(durationInSeconds, 0.1)
  const sizeInBytes = Math.floor(targetSizeInMB * BYTES_PER_MB)
  const totalBitrate = (sizeInBytes * SIZE_MARGIN * 8) / 1000 / duration

  const audioBitrate =
    audioTrackCount > 0
      ? (input.audioBitrate ?? getAudioBitrate(totalBitrate))
      : null
  const audioShare = (audioBitrate ?? 0) * audioTrackCount

  let videoBitrate = Math.floor(totalBitrate - audioShare)
  // Never more than the whole input has: a video that already fits keeps its quality
  if (sourceSizeInBytes && sourceDurationInSeconds) {
    const sourceBitrate =
      (sourceSizeInBytes * 8) / 1000 / Math.max(sourceDurationInSeconds, 0.1)
    videoBitrate = Math.min(videoBitrate, Math.floor(sourceBitrate))
  }
  const isReachable = videoBitrate >= MIN_VIDEO_BITRATE
  videoBitrate = Math.max(videoBitrate, MIN_VIDEO_BITRATE)

  const minimumSizeInMB =
    Math.ceil(
      (((MIN_VIDEO_BITRATE + audioShare) * 1000 * duration) /
        8 /
        SIZE_MARGIN /
        BYTES_PER_MB) *
        10,
    ) / 10

  const { width, height } = dimensions
  const sourceFps = input.fps && input.fps > 0 ? input.fps : 30

  // The largest resolution (then the highest frame rate) with enough bits for each pixel: what the
  // codec needs, or less for footage the quality settings compress well
  const codecBitsPerPixel =
    MIN_BITS_PER_PIXEL[videoCodec ?? ''] ?? DEFAULT_MIN_BITS_PER_PIXEL
  const qualityVideoBitrate = input.qualitySizeInBytes
    ? (input.qualitySizeInBytes * 8) / 1000 / duration - audioShare
    : null
  const minBitsPerPixel =
    qualityVideoBitrate && qualityVideoBitrate > 0
      ? Math.min(
          codecBitsPerPixel,
          Math.max(
            ((qualityVideoBitrate * 1000) / (width * height * sourceFps)) *
              QUALITY_BITS_SHARE,
            LOWEST_BITS_PER_PIXEL,
          ),
        )
      : codecBitsPerPixel
  const shorterSide = Math.min(width, height)
  const sizes: [number, number][] = [
    [toEven(width), toEven(height)],
    ...RESOLUTION_STEPS.filter((step) => step < shorterSide).map(
      (step): [number, number] => {
        const scale = step / shorterSide
        return [toEven(width * scale), toEven(height * scale)]
      },
    ),
  ]
  const frameRates = [
    sourceFps,
    ...FRAME_RATE_STEPS.filter((step) => step < sourceFps),
  ]
  const fits = ([w, h]: [number, number], fps: number) =>
    (videoBitrate * 1000) / (w * h * fps) >= minBitsPerPixel

  // At each resolution the frame rate is lowered first (motion at 24 fps still looks smooth,
  // while a lower resolution looks blurry)
  let chosenSize = sizes[sizes.length - 1]
  let chosenFps = frameRates[frameRates.length - 1]
  search: for (const size of sizes) {
    for (const fps of frameRates) {
      if (fits(size, fps)) {
        chosenSize = size
        chosenFps = fps
        break search
      }
    }
  }

  return {
    isReachable,
    minimumSizeInMB,
    videoBitrate,
    audioBitrate,
    dimensions: chosenSize,
    isResolutionLowered: chosenSize !== sizes[0],
    fps: chosenFps !== sourceFps ? chosenFps : null,
    sizeInBytes,
    fitsAtQuality:
      input.qualitySizeInBytes != null &&
      input.qualitySizeInBytes <= sizeInBytes * QUALITY_FIT_MARGIN,
  }
}

/** A size in MB as shown, e.g. `10` or `7.5` */
export function formatSizeInMB(sizeInMB: number) {
  return Number.isInteger(sizeInMB) ? `${sizeInMB}` : sizeInMB.toFixed(1)
}
