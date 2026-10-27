import { DateValue } from '@internationalized/date'
import { TimelineAction } from '@xzdarcy/timeline-engine'

import {
  AudioChannelConfig,
  AudioStream,
  BatchResolution,
  Chapter,
  ContainerInfo,
  CropAspectRatio,
  ExifInfo,
  extensions,
  ImageBasicInfo,
  ImageColorInfo,
  ImageDimensions,
  MediaTransformHistory,
  MediaTransforms,
  PortableTransform,
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
  /**
   * Compressed to a file size instead of a quality (see `utils/targetSize.ts`): the resolution &
   * frame rate chosen are then upper limits, lowered to fit
   */
  shouldUseTargetSize?: boolean
  /** The size, in MB */
  targetSizeInMB?: number | null
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
    /** Shape the crop is locked to in the editor (`null` for a free crop) */
    aspectRatio?: CropAspectRatio | null
    /** Set by a preset, until it is changed in the editor */
    isFromPreset?: boolean
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
  /**
   * Transforms of all videos of a batch (set on the batch config only, by a preset); each video's
   * own crop is computed from its size
   */
  batchTransform?: PortableTransform | null
  /** Video preset the settings come from (see `src/types/preset.ts`) */
  presetId?: string
  /** Preset settings that could not be applied to this video (e.g. audio without an audio track) */
  presetSkippedFields?: string[]
}

export type Video = {
  id: string | null
  /**
   * An audio file (MP3, WAV, ...): compressed like a video without a picture, with only the
   * settings that apply to audio (format, quality, trim, speed, audio, metadata)
   */
  isAudioFile?: boolean
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
  /**
   * While compressing to a target size: the size it comes out at, about its estimate at the quality
   * settings when those fit, or else up to the target size
   */
  estimatedOutputSize?: { sizeInBytes: number; isUpTo: boolean } | null
  /**
   * While compressing to a target size & compressed again to get closer to it: the round it is in
   * (2 for the second), & whether this round is without hardware acceleration
   */
  targetSizeRound?: {
    round: number
    isWithoutHardwareAcceleration: boolean
  } | null
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
    /** Its entry in the history (see `-history.ts`), updated when it is saved */
    historyId?: string
    /**
     * Compressed to a target size: every output made for it (by size, the one used among them),
     * any of which can be used instead (see `chooseOutputOption`)
     */
    options?: { pathRaw: string; sizeInBytes: number }[] | null
    /**
     * Another of `options`, looked at while this output is saved: shown in its place, & saved
     * instead only with "Replace saved file" (see `previewOutputOption`)
     */
    previewOption?: { pathRaw: string; sizeInBytes: number } | null
    targetSizeInBytes?: number | null
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
  /** Compressed to fit within `targetSizeInKB` instead of at `quality` (see `imageTargetSize.ts`) */
  shouldUseTargetSize?: boolean
  targetSizeInKB?: number
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
    /** Shape the crop is locked to in the editor (`null` for a free crop) */
    aspectRatio?: CropAspectRatio | null
    /** Set by a preset, until it is changed in the editor */
    isFromPreset?: boolean
  }
  isImageTransformEditMode?: boolean
  /**
   * Size of the longer side all images of a batch are resized to (set on the batch config only, by a
   * preset). Images with their own custom dimensions keep those; smaller images are upscaled.
   */
  batchLongerSide?: number | null
  /**
   * Transforms of all images of a batch (set on the batch config only, by a preset); each image's
   * own crop is computed from its size
   */
  batchTransform?: PortableTransform | null
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
    /** Its entry in the history (see `-history.ts`), updated when it is saved */
    historyId?: string
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

export type MediaTab = 'all' | 'videos' | 'images' | 'audio'

export type App = {
  activeTab: MediaTab
  batchId?: string
  media: ((Video & { type: 'video' }) | (Image & { type: 'image' }))[]
  isLoadingMediaFiles: boolean
  totalSelectedMediaCount: number
  /** Media is being added to an existing selection (see `addMedia`) */
  isAppendingMedia: boolean
  /** The compression waits for the drop zone to finish the media it is compressing (macOS) */
  isWaitingForDropZone?: boolean
  /** Before compressing to a target size, the size at the quality settings is estimated */
  isEstimatingSize?: boolean
  /** A batch is paused: the media being compressed finishes, the next waits until resumed */
  isBatchPaused?: boolean
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
    /** Settings of the batch's audio files (see `Video.isAudioFile`), apart from its videos' */
    audioFileConfig: VideoConfig
  }
  showMediaInfo?: boolean
}
