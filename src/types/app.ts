import { DateValue } from '@internationalized/date'
import { TimelineAction } from '@xzdarcy/timeline-engine'

import {
  AudioChannelConfig,
  AudioStream,
  BatchResolution,
  Chapter,
  ContainerInfo,
  ExifInfo,
  extensions,
  ImageBasicInfo,
  ImageColorInfo,
  ImageDimensions,
  MediaTransformHistory,
  MediaTransforms,
  SubtitleStream,
  SvgConfig,
  VideoStream,
} from '@/types/compression'

export type MediaMetadataConfig = {
  title?: string | null
  artist?: string | null
  album?: string | null
  year?: string | null
  comment?: string | null
  description?: string | null
  synopsis?: string | null
  genre?: string | null
  copyright?: string | null
  creationTime?: string | null
  creationTimeRaw?: DateValue | null
  shouldEnableCreationTime?: boolean
}

export type AudioConfig = {
  volume: number
  audioChannelConfig?: AudioChannelConfig | null
  bitrate?: number | null
  audioCodec?: string | null
  selectedAudioTracks?: readonly number[] | null
}

export type SubtitleConfig = {
  subtitlePath: string | null
  language: string
  title?: string
  fileName: string | null
}

export type SubtitlesConfig = {
  subtitles: SubtitleConfig[]
  shouldEnableSubtitles?: boolean
  preserveExistingSubtitles?: boolean
  title?: string | null
}

export type VideoConfig = {
  convertToExtension:
    | keyof typeof extensions.video
    | keyof typeof extensions.audio
    | '-'
  shouldDisableCompression: boolean
  audioConfig: AudioConfig
  quality?: number | null
  shouldEnableCustomDimensions?: boolean
  customDimensions?: [number, number]
  /** Resolution for all videos of a batch (set on the batch config only) */
  batchResolution?: BatchResolution
  shouldEnableCustomFPS?: boolean
  customFPS?: number
  shouldEnableCustomVideoCodec?: boolean
  customVideoCodec?: string
  shouldTransformVideo?: boolean
  transformVideoConfig?: {
    transforms: MediaTransforms
    transformHistory: MediaTransformHistory[]
    previewUrl?: string
  }
  isVideoTransformEditMode?: boolean
  shouldTrimVideo?: boolean
  trimConfig?: TimelineAction[]
  isVideoTrimEditMode?: boolean
  shouldStripMetadata?: boolean
  metadataConfig?: MediaMetadataConfig | null
  customThumbnailPath?: string | null
  shouldEnableCustomThumbnail?: boolean
  shouldEnableCustomChannel?: boolean
  shouldEnableCustomBitrate?: boolean
  shouldEnableCustomAudioCodec?: boolean
  shouldEnableAudioTrackSelection?: boolean
  selectedAudioTracks?: number[]
  subtitlesConfig?: SubtitlesConfig | null
  shouldEnableCustomSpeed?: boolean
  customSpeed?: number | null
  /** Video preset the settings come from (see `src/types/preset.ts`) */
  presetId?: string
  /** Preset settings that could not be applied to this video (e.g. audio without an audio track) */
  presetSkippedFields?: string[]
}

export type Video = {
  id: string | null
  pathRaw?: string | null
  path?: string | null
  /** Folder relative to the dropped folder (e.g. `Vacation/Day1`), mirrored when batch saving */
  relativeDir?: string
  fileName?: string | null
  mimeType?: string | null
  sizeInBytes?: number | null
  size?: string | null
  extension?: null | string
  thumbnailPathRaw?: string | null
  thumbnailPath?: string | null
  videoDuration?: number | null
  isCompressing?: boolean
  isProcessCompleted?: boolean
  compressedFile?: {
    isSuccessful?: boolean
    pathRaw?: string | null
    path?: string | null
    fileName?: string | null
    fileNameToDisplay?: string | null
    mimeType?: string | null
    sizeInBytes?: number | null
    size?: string | null
    extension?: null | string
    isSaving?: boolean
    isSaved?: boolean
    savedPath?: string
  } | null
  compressionProgress?: number
  config: VideoConfig
  isConfigDirty?: boolean
  dimensions?: { width: number; height: number }
  fps?: number
  previewMode?: 'video' | 'image'
  previewVideoFrameUrl?: string | null
  videoInfoRaw?: {
    containerInfo?: ContainerInfo
    videoStreams?: VideoStream[]
    audioStreams?: AudioStream[]
    subtitleStreams?: SubtitleStream[]
    chapters?: Chapter[]
  }
}

export type ImageConfig = {
  convertToExtension: keyof typeof extensions.image | '-'
  isLossless: boolean
  quality: number
  shouldStripMetadata: boolean
  metadataConfig?: MediaMetadataConfig | null
  svgScaleFactor?: number
  svgConfig?: SvgConfig
  shouldEnableAdvancedSvgSetting?: boolean
  shouldEnableCustomDimensions?: boolean
  customDimensions?: [number, number]
  shouldTransformImage?: boolean
  transformImageConfig?: {
    transforms: MediaTransforms
    transformHistory: MediaTransformHistory[]
    previewUrl?: string
  }
  isImageTransformEditMode?: boolean
  /**
   * Size of the longer side all images of a batch are resized to (set on the batch config only, by a
   * preset). Images with their own custom dimensions keep those; smaller images are upscaled.
   */
  batchLongerSide?: number | null
  /** Image preset the settings come from (see `src/types/preset.ts`) */
  presetId?: string
  /** Preset settings that could not be applied to this image (e.g. the format of a GIF) */
  presetSkippedFields?: string[]
}

export type Image = {
  id: string | null
  pathRaw?: string | null
  path?: string | null
  /** Folder relative to the dropped folder (e.g. `Vacation/Day1`), mirrored when batch saving */
  relativeDir?: string
  fileName?: string | null
  mimeType?: string | null
  sizeInBytes?: number | null
  size?: string | null
  extension?: null | string
  thumbnailPathRaw?: string | null
  thumbnailPath?: string | null
  isCompressing?: boolean
  isProcessCompleted?: boolean
  compressedFile?: {
    isSuccessful?: boolean
    pathRaw?: string | null
    path?: string | null
    fileName?: string | null
    fileNameToDisplay?: string | null
    mimeType?: string | null
    sizeInBytes?: number | null
    size?: string | null
    extension?: null | string
    isSaving?: boolean
    isSaved?: boolean
    savedPath?: string
  } | null
  compressionProgress?: number
  config: ImageConfig
  isConfigDirty?: boolean
  dimensions?: { width: number; height: number }
  imageInfoRaw?: {
    basicInfo?: ImageBasicInfo
    dimensions?: ImageDimensions
    colorInfo?: ImageColorInfo
    exifInfo?: ExifInfo
  }
}

export type App = {
  activeTab: 'all' | 'videos' | 'images'
  batchId?: string
  media: ((Video & { type: 'video' }) | (Image & { type: 'image' }))[]
  isLoadingMediaFiles: boolean
  totalSelectedMediaCount: number
  /** Media is being added to an existing selection (see `addMedia`) */
  isAppendingMedia: boolean
  currentMediaIndex: number
  isCompressing: boolean
  totalProgress: number
  isProcessCompleted: boolean
  isBatchCompressionCancelled: boolean
  isSaving: boolean
  isSaved: boolean
  savedPath?: string
  selectedMediaIndexForCustomization: number
  commonConfigForBatchCompression: {
    videoConfig: VideoConfig
    imageConfig: ImageConfig
  }
  showMediaInfo?: boolean
}
