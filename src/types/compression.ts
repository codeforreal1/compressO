import { t } from '@/i18n'
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
    avif: 'avif',
  },
  // Audio extracted from a video
  audio: {
    mp3: 'mp3',
    m4a: 'm4a',
    wav: 'wav',
    flac: 'flac',
    ogg: 'ogg',
    opus: 'opus',
  },
} as const

// Formats that can be opened but aren't offered as an output extension
export const inputOnlyExtensions = {
  video: ['m4v', 'mts', 'm2ts'],
  image: ['bmp', 'tiff', 'tif'],
  audio: ['aac', 'm4b', 'aiff', 'aif', 'wma', 'oga', 'mp2'],
} as const

export const inputExtensions = {
  video: [...Object.keys(extensions.video), ...inputOnlyExtensions.video],
  image: [...Object.keys(extensions.image), ...inputOnlyExtensions.image],
  // Audio files (compressed as videos without a picture, see `Video.isAudioFile`)
  audio: [...Object.keys(extensions.audio), ...inputOnlyExtensions.audio],
}

export type VideoExtension = keyof typeof extensions.video
export type ImageExtension = keyof typeof extensions.image
export type AudioExtension = keyof typeof extensions.audio

export type VideoCodecOption = {
  value: string
  name: string
  description: string
  compatible_containers: VideoExtension[]
}

/** Video codecs that can be chosen, with the output containers that can hold them */
export const VIDEO_CODECS: readonly VideoCodecOption[] = [
  {
    value: 'libx264',
    name: 'H.264 (AVC)',
    get description() {
      return t('codecs.video.libx264')
    },
    compatible_containers: [
      'mp4',
      'mov',
      'mkv',
      'avi',
      'ts',
    ] as VideoExtension[],
  },
  {
    value: 'libx265',
    name: 'H.265 (HEVC)',
    get description() {
      return t('codecs.video.libx265')
    },
    compatible_containers: ['mp4', 'mov', 'mkv', 'ts'] as VideoExtension[],
  },
  {
    value: 'libvpx-vp9',
    name: 'VP9',
    get description() {
      return t('codecs.video.libvpx_vp9')
    },
    compatible_containers: ['webm', 'mkv'] as VideoExtension[],
  },
  {
    // Kept as is for saved presets; compressed with SVT-AV1 when ffmpeg has it (see `ffmpeg.rs`)
    value: 'libaom-av1',
    name: 'AV1',
    get description() {
      return t('codecs.video.libaom_av1')
    },
    compatible_containers: ['mp4', 'mkv', 'webm'] as VideoExtension[],
  },
  {
    value: 'mpeg4',
    name: 'MPEG-4',
    get description() {
      return t('codecs.video.mpeg4')
    },
    compatible_containers: ['mp4', 'mov', 'mkv', 'avi'] as VideoExtension[],
  },
]

/**
 * Whether a video codec (a `VIDEO_CODECS` value) can be written in an output container (see
 * `getOutputVideoContainer`); unknown codecs are left to ffmpeg
 */
export function isVideoCodecCompatible(codec: string, container: string) {
  const option = VIDEO_CODECS.find((c) => c.value === codec)
  return (
    !option ||
    option.compatible_containers.includes(container as VideoExtension)
  )
}

/**
 * Resolutions as the size of the longer side (the width of a landscape media, the height of a
 * portrait one; 16:9 sizes, e.g. 1080p is 1920x1080 or 1080x1920). Used by the resolution buttons,
 * the batch resolution & presets. Smaller media is upscaled. `original` keeps the original size.
 */
export const batchResolutions = {
  original: null,
  '480p': 854,
  '720p': 1280,
  '1080p': 1920,
  '2k': 2560,
  '4k': 3840,
} as const

/** A listed resolution, or another size of the longer side (e.g. `1700px`, from a preset) */
export type BatchResolution = keyof typeof batchResolutions | `${number}px`

/** Size of the longer side of a batch resolution (`null` keeps the original size) */
export function getBatchResolutionLongerSide(
  resolution: BatchResolution | null | undefined,
): number | null {
  if (!resolution) return null
  if (resolution in batchResolutions) {
    return batchResolutions[resolution as keyof typeof batchResolutions]
  }
  const longerSide = Number.parseInt(resolution, 10)
  return Number.isFinite(longerSide) && longerSide > 0 ? longerSide : null
}

/** Batch resolution for a size of the longer side, e.g. `1920` -> `1080p`, `1700` -> `1700px` */
export function getBatchResolutionForLongerSide(
  longerSide: number | null | undefined,
): BatchResolution {
  if (!longerSide) return 'original'
  const listed = (
    Object.keys(batchResolutions) as (keyof typeof batchResolutions)[]
  ).find((key) => batchResolutions[key] === longerSide)
  return listed ?? `${longerSide}px`
}

/** Whether an output extension extracts only the audio of a video */
export function isAudioExtension(
  extension: string | null | undefined,
): extension is AudioExtension {
  return !!extension && extension in extensions.audio
}

/** Whether a file with this extension is opened as an audio file (see `inputExtensions.audio`) */
export function isAudioFileExtension(extension: string | null | undefined) {
  return (
    !!extension &&
    (inputExtensions.audio as string[]).includes(extension.toLowerCase())
  )
}

/**
 * Format an audio file is written in when its output format is "Same as input" (or a video format,
 * in a batch): its own, or the closest one that can be written for formats that can only be read
 */
export function getAudioFileOutputExtension(
  extension: string | null | undefined,
): AudioExtension {
  const source = extension?.toLowerCase()
  if (isAudioExtension(source)) return source
  switch (source) {
    case 'aac':
    case 'm4b':
      return 'm4a'
    case 'aiff':
    case 'aif':
      return 'wav'
    case 'oga':
      return 'ogg'
    default:
      return 'mp3'
  }
}

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

/** Shapes a crop can be locked to, as width:height */
export const cropAspectRatios = {
  '1:1': [1, 1],
  '4:5': [4, 5],
  '9:16': [9, 16],
  '16:9': [16, 9],
  '4:3': [4, 3],
} as const

export type CropAspectRatio = keyof typeof cropAspectRatios

/**
 * Transforms that apply to any media (e.g. in a preset): rotation & flips, and a crop as a shape
 * (the largest centered area of the ratio), which is turned into each media's own crop
 */
export type PortableTransform = {
  /** Clockwise, in degrees (0, 90, 180 or 270) */
  rotate: number
  /** Flips after the rotation, in the output's axes */
  flip: { horizontal: boolean; vertical: boolean }
  aspectRatio: CropAspectRatio | null
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
