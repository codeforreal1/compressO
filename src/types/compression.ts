import { AudioConfig, MediaMetadataConfig, SubtitlesConfig } from './app'
import { FileMetadata } from './fs'

export const extensions = {
  video: {
    mp4: 'mp4',
    mov: 'mov',
    mkv: 'mkv',
    webm: 'webm',
    avi: 'avi',
    ts: 'ts',
    gif: 'gif',
  },
  image: {
    png: 'png',
    jpg: 'jpg',
    jpeg: 'jpeg',
    webp: 'webp',
    gif: 'gif',
    svg: 'svg',
  },
} as const

export type VideoExtension = keyof typeof extensions.video
export type ImageExtension = keyof typeof extensions.image

export const compressionPresets = {
  ironclad: 'ironclad',
  thunderbolt: 'thunderbolt',
} as const

export type VideoCompressionResult = {
  videoId: string
  fileName: string
  filePath: string
  fileMetadata: FileMetadata
}

export enum CustomEvents {
  VideoCompressionProgress = 'VideoCompressionProgress',
  CancelInProgressCompression = 'CancelInProgressCompression',
  BatchVideoCompressionProgress = 'BatchVideoCompressionProgress',
  BatchVideoIndividualCompressionCompletion = 'BatchVideoIndividualCompressionCompletion',
  ImageCompressionProgress = 'ImageCompressionProgress',
  BatchImageCompressionProgress = 'BatchImageCompressionProgress',
  BatchImageIndividualCompressionCompletion = 'BatchImageIndividualCompressionCompletion',
  BatchMediaCompressionProgress = 'BatchMediaCompressionProgress',
  BatchMediaIndividualCompressionCompletion = 'BatchMediaIndividualCompressionCompletion',
}

export type VideoCompressionProgress = {
  videoId: string
  batchId: string
  currentDuration: string
}
export type BatchVideoIndividualCompressionResult = {
  batchId: string
  result: VideoCompressionResult
}

export type VideoThumbnail = {
  id: string
  fileName: string
  filePath: string
}

export type VideoInfo = {
  duration: number
  dimensions: [number, number]
  fps: number
}

export type VideoStream = {
  codec: string
  codecLongName: string
  profile: string
  codecType: string

  width: number
  height: number
  codedWidth: number
  codedHeight: number

  rFrameRate: string
  avgFrameRate: string

  pixFmt: string
  colorSpace: string | null
  colorRange: string | null
  colorPrimaries: string | null
  colorTransfer: string | null
  chromaLocation: string | null

  bitRate: string | null
  duration: string | null

  nbFrames: string | null
  refs: number | null

  gopSize: number | null
  level: number | null

  fieldOrder: string
  timeBase: string
  rotation: number | null
}

export type AudioStream = {
  codec: string
  codecLongName: string
  codecType: string
  profile: string | null

  channels: string
  channelLayout: string

  sampleRate: string
  sampleFmt: string | null
  bitsPerSample: number | null

  bitRate: string | null
  duration: string | null

  tags: readonly (readonly [string, string])[] | null
}

export type SubtitleStream = {
  index: number
  codec: string
  codecLongName: string
  codecType: string
  language: string | null
  title: string | null
  disposition: {
    default: boolean
    forced: boolean
    attachedPic: boolean
    comment: boolean
    karaoke: boolean
    lyrics: boolean
  }
}

export type Chapter = {
  id: number
  timeBase: string
  start: number
  end: number
  title: string | null
}

export type ContainerInfo = {
  filename: string
  formatName: string
  formatLongName: string
  duration: number | null
  size: number
  bitRate: number | null
  nbStreams: number
  tags: [string, string][] | null
}

export type MediaTransforms = {
  crop: { top: number; left: number; width: number; height: number }
  rotate: number
  flip: { horizontal: boolean; vertical: boolean }
}

export type MediaTransformHistory =
  | {
      type: 'crop'
      value: { top: number; left: number; width: number; height: number }
    }
  | { type: 'rotate'; value: number }
  | { type: 'flip'; value: { horizontal: boolean; vertical: boolean } }

export type BatchCompressionResult = {
  results: Record<string, VideoCompressionResult>
}

export type BatchVideoCompressionProgress = {
  batchId: string
  currentIndex: number
  totalCount: number
  videoProgress: VideoCompressionProgress
}

export type VideoFileMetadata = {
  id: string
  fileName: string
  path: string
  size: number
  thumbnailPath?: string
  duration?: string
  dimensions?: [number, number]
  fps?: number
}

export type VideoTrimSegment = {
  start: number
  end: number
}

export type AudioChannelConfig = {
  channelLayout: 'mono' | 'stereo' | null
  monoSource?: { left: boolean; right: boolean }
  stereoSwapChannels?: boolean
}

export type VideoCompressionConfig = {
  videoPath: string
  convertToExtension: string
  presetName?: string | null
  videoId: string
  batchId?: string | null
  audioConfig: AudioConfig
  quality: number
  dimensions?: [number, number] | null
  fps?: string | null
  videoCodec?: string | null
  transformHistory?: MediaTransformHistory[] | null
  stripMetadata?: boolean
  metadataConfig?: MediaMetadataConfig | null
  customThumbnailPath?: string | null
  trimSegments?: VideoTrimSegment[] | null
  subtitlesConfig?: SubtitlesConfig | null
  speed?: number | null
}

export type ImageCompressionProgress = {
  imageId: string
  batchId: string
  progress: number
}

export type ImageCompressionResult = {
  imageId: string
  fileName: string
  filePath: string
  fileMetadata?: FileMetadata
}

export type SvgConfig = {
  filterSpeckle?: number | null
  colorPrecision?: number | null
  layerDifference?: number | null
  cornerThreshold?: number | null
  lengthThreshold?: number | null
  spliceThreshold?: number | null
  isBw?: boolean | null
}

export type ImageCompressionConfig = {
  imageId: string
  imagePath: string
  convertToExtension: string
  isLossless: boolean
  quality: number
  stripMetadata: boolean
  svgScaleFactor: number | null
  svgConfig?: SvgConfig | null
  dimensions?: [number, number] | null
  transformHistory?: MediaTransformHistory[] | null
}

export type MediaItem = {
  videoConfig?: VideoCompressionConfig
  imageConfig?: ImageCompressionConfig
}

export type MediaCompressionProgress =
  | ({ mediaType: 'video' } & VideoCompressionProgress)
  | ({ mediaType: 'image' } & ImageCompressionProgress)

export type MediaCompressionResult =
  | ({ mediaType: 'video' } & VideoCompressionResult)
  | ({ mediaType: 'image' } & ImageCompressionResult)

export type BatchMediaCompressionProgress = {
  batchId: string
  currentIndex: number
  totalCount: number
  mediaProgress: MediaCompressionProgress
}

export type BatchMediaIndividualCompressionResult = {
  batchId: string
  result: MediaCompressionResult
}

export type MediaBatchCompressionResult = {
  results: Record<string, MediaCompressionResult>
}

export type ImageBasicInfo = {
  filename: string
  format: string
  formatLongName: string
  mimeType: string
  size: number
}

export type ImageDimensions = {
  width: number
  height: number
  aspectRatio: string
  orientation: number | null
  dpi: [number, number] | null
  megapixels: number
}

export type ImageColorInfo = {
  colorType: string
  bitDepth: number
  hasAlpha: boolean
  colorSpace: string | null
  pixelFormat: string
}

export type ExifTag = {
  key: string
  value: string
  category: string
}

export type ExifInfo = {
  tags: ExifTag[]
  make: string | null
  model: string | null
  software: string | null
  dateTimeOriginal: string | null
  dateTimeDigitized: string | null
  copyright: string | null
  artist: string | null
  gpsCoordinates: [number, number] | null
  lensModel: string | null
  iso: number | null
  exposureTime: string | null
  fNumber: string | null
  focalLength: string | null
  flash: string | null
}
