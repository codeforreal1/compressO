import type { ImageDynamicRangeConfig } from './imageDynamicRange'

/** The source's dynamic range, from its colour signaling (see `video_dynamic_range.rs`) */
export type VideoDynamicRangeInfo = {
  dynamicRange: 'sdr' | 'hdr' | 'unknown'
  format: 'hdr10' | 'hlg' | 'dolbyVision' | null
}

/** Same as images: HDR Boost for SDR sources, Remove HDR (`sdr`) for HDR sources */
export type VideoDynamicRangeConfig = ImageDynamicRangeConfig
