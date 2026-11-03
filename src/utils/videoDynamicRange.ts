import type { VideoConfig } from '@/types/app'
import { getOutputVideoContainer } from '@/utils/video'

/** Codecs & containers that hold HDR (see `carries_hdr` in `video_dynamic_range.rs`) */
const HDR_VIDEO_CODECS = ['libx265', 'libvpx-vp9', 'libaom-av1']
const HDR_VIDEO_CONTAINERS = ['mp4', 'mov', 'mkv', 'webm', 'ts']

/**
 * What a video's output allows for its dynamic range (see `operation` in
 * `video_dynamic_range.rs`):
 * - `canHoldHdr`: its format & chosen codec can hold HDR (the automatic codec is HEVC for HDR)
 * - `isLossless`: compressed losslessly, which keeps an HDR source as it is unless Remove HDR is
 *   on, & never brightens an SDR one
 */
export function getVideoHdrOutput(
  config: VideoConfig,
  sourceExtension: string | null | undefined,
) {
  const container = getOutputVideoContainer(
    config.convertToExtension,
    sourceExtension,
  )
  const codec =
    config.shouldEnableCustomVideoCodec && config.customVideoCodec !== '-'
      ? config.customVideoCodec
      : null
  return {
    canHoldHdr:
      HDR_VIDEO_CONTAINERS.includes(container) &&
      (!codec || HDR_VIDEO_CODECS.includes(codec)),
    isLossless:
      !!config.shouldDisableCompression && !config.shouldUseTargetSize,
  }
}
