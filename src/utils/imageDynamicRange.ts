import type {
  ImageDynamicRangeConfig,
  ImageDynamicRangeInfo,
} from '@/types/imageDynamicRange'

/** The operation is based on the loaded source, never on the current preview/output. */
export function getImageDynamicRangeOperation(
  config: ImageDynamicRangeConfig | undefined,
  info: ImageDynamicRangeInfo | undefined,
  output: string,
): ImageDynamicRangeConfig | null {
  if (!info?.supported || !config) return null
  if (config.mode === 'boost' && !supportsHdrBoostOutput(output)) return null
  if (
    (info.dynamicRange === 'sdr' && config.mode === 'boost') ||
    (info.dynamicRange === 'hdr' && config.mode === 'sdr')
  ) {
    return {
      mode: config.mode,
      intensity: Number.isFinite(config.intensity)
        ? Math.min(4, Math.max(1, config.intensity))
        : 2,
    }
  }
  return null
}

export function supportsHdrBoostOutput(output: string) {
  return ['png', 'jxl', 'jpg', 'jpeg'].includes(output)
}

export function isHdrJpegOutput(
  output: string,
  operation: ImageDynamicRangeConfig | null,
  info: ImageDynamicRangeInfo | undefined,
) {
  return (
    ['jpg', 'jpeg'].includes(output) &&
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
