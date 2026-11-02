export type ImageDynamicRangeInfo = {
  supported: boolean
  dynamicRange: 'sdr' | 'hdr' | 'unknown'
  hasGainMap: boolean
}

export type ImageDynamicRangeConfig = {
  mode: 'original' | 'boost' | 'sdr'
  intensity: number
}
