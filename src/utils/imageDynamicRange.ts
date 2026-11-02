import type {
  ImageDynamicRangeConfig,
  ImageDynamicRangeInfo,
} from '@/types/imageDynamicRange'

/** The strongest HDR Boost, for images & videos (SDR white at 8×; most screens show less) */
export const MAX_HDR_BOOST_INTENSITY = 8

/** The operation is based on the loaded source, never on the current preview/output. */
export function getImageDynamicRangeOperation(
  config: ImageDynamicRangeConfig | undefined,
  info: ImageDynamicRangeInfo | undefined,
  output: string,
): ImageDynamicRangeConfig | null {
  if (!info?.supported || !config) return null
  if (config.mode === 'boost' && !supportsHdrBoostOutput(output, info))
    return null
  if (
    (info.dynamicRange === 'sdr' && config.mode === 'boost') ||
    (info.dynamicRange === 'hdr' && config.mode === 'sdr')
  ) {
    return {
      mode: config.mode,
      intensity: Number.isFinite(config.intensity)
        ? Math.min(MAX_HDR_BOOST_INTENSITY, Math.max(1, config.intensity))
        : 2,
    }
  }
  return null
}

/** PNG & JPEG XL everywhere; JPEG with a gain map only where it can be written (macOS 15+) */
export function supportsHdrBoostOutput(
  output: string,
  info: ImageDynamicRangeInfo | undefined,
) {
  return (
    ['png', 'jxl'].includes(output) ||
    (!!info?.supportsHdrJpeg && ['jpg', 'jpeg'].includes(output))
  )
}

export function isHdrJpegOutput(
  output: string,
  operation: ImageDynamicRangeConfig | null,
  info: ImageDynamicRangeInfo | undefined,
) {
  return (
    ['jpg', 'jpeg'].includes(output) &&
    !!info?.supportsHdrJpeg &&
    (operation?.mode === 'boost' ||
      (info?.supported &&
        info.dynamicRange === 'hdr' &&
        operation?.mode !== 'sdr'))
  )
}

/** HDR PNG uses lossless optimization; palette quantization would destroy HDR. */
export function isHdrPngOutput(
  output: string,
  operation: ImageDynamicRangeConfig | null,
  info: ImageDynamicRangeInfo | undefined,
) {
  return (
    output === 'png' &&
    (operation?.mode === 'boost' ||
      (info?.dynamicRange === 'hdr' && operation?.mode !== 'sdr'))
  )
}
