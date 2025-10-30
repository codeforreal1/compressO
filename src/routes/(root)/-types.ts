import { compressionPresets, extensions } from '@/types/compression'

export type VideoConfig = {
  convertToExtension: keyof typeof extensions.video
  presetName: keyof typeof compressionPresets
  shouldDisableCompression: boolean
  shouldMuteVideo: boolean
  shouldEnableQuality?: boolean
  quality?: number | null
  shouldEnableCustomDimensions?: boolean
  customDimensions?: [number, number]
  shouldEnableCustomFPS?: boolean
  customFPS?: number
  shouldTransformVideo?: boolean
  transformVideoCoordinates?: {
    top: number
    left: number
    width: number
    height: number
  }
}

export type Video = {
  id?: string | null
  isFileSelected: boolean
  pathRaw?: string | null
  path?: string | null
  fileName?: string | null
  mimeType?: string | null
  sizeInBytes?: number | null
  size?: string | null
  extension?: null | string
  thumbnailPathRaw?: string | null
  thumbnailPath?: string | null
  isThumbnailGenerating?: boolean
  videoDurationMilliseconds?: number | null
  videDurationRaw?: string | null
  isCompressing?: boolean
  isCompressionSuccessful?: boolean
  compressedVideo?: {
    pathRaw?: string | null
    path?: string | null
    fileName?: string | null
    fileNameToDisplay?: string | null
    mimeType?: string | null
    sizeInBytes?: number | null
    size?: string | null
    extension?: null | string
    isSaved?: boolean
    isSaving?: boolean
    savedPath?: string
  } | null
  compressionProgress?: number
  config: VideoConfig
  dimensions?: { width: number; height: number }
  fps?: number
}
