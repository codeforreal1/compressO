export type ImageDynamicRangeInfo = {
  supported: boolean
  dynamicRange: 'sdr' | 'hdr' | 'unknown'
  hasGainMap: boolean
  /** HDR JPEG (gain map) can be written: Core Image, on macOS 15 and later */
  supportsHdrJpeg?: boolean
}

export type ImageDynamicRangeConfig = {
  mode: 'original' | 'boost' | 'sdr'
  intensity: number
}
