import type { CropAspectRatio } from '@/types/compression'

export const CONTRACT_VERSION = 1 as const

export type ContractMediaType = 'video' | 'image' | 'audio'
export type ContractValidationMode = 'preset' | 'oneShot'

export type ResolutionPreset = '480p' | '720p' | '1080p' | '2k' | '4k'
/** `null` keeps the original size; a preset name or even longer-side pixel count */
export type Resolution = ResolutionPreset | number | null

export type Transform = {
  rotate: 0 | 90 | 180 | 270
  flipHorizontal: boolean
  flipVertical: boolean
  /** Largest centered crop of this aspect ratio; `null` for no crop */
  crop: CropAspectRatio | null
} | null

/** `null` keeps the source's dynamic range */
export type Hdr =
  | { mode: 'boost'; intensity: number }
  | { mode: 'remove' }
  | null

export type VideoCodecName = 'h264' | 'hevc' | 'vp9' | 'av1' | 'mpeg4'
export type AudioCodecName =
  | 'aac'
  | 'mp3'
  | 'opus'
  | 'vorbis'
  | 'ac3'
  | 'alac'
  | 'flac'
  | 'pcm'

export type AudioChannelMode =
  | { layout: 'mono'; source: 'mix' | 'left' | 'right' }
  | { layout: 'stereo'; swapChannels: boolean }
  | null

export type AudioBitrateKbps = 64 | 96 | 128 | 160 | 192 | 256 | 320

export type AudioSettings = {
  volumePercent: number
  codec: AudioCodecName | null
  channels: AudioChannelMode
  bitrateKbps: AudioBitrateKbps | null
}

export type MetadataTags = {
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
}

export type MetadataSettings =
  | { mode: 'strip' }
  | { mode: 'keep'; set?: MetadataTags | null }

export type PresetMetadataSettings = { mode: 'strip' } | { mode: 'keep' }

export type SubtitleTrack = {
  path: string
  language?: string
  title?: string | null
}

export type SubtitlesSettings = {
  preserveExisting: boolean
  tracks: SubtitleTrack[]
}

export type OutputSettings = {
  saveTo: 'sameFolder' | 'folder' | 'ask'
  folder?: string | null
  fileNameTemplate: string
}

export type VideoOutputFormat =
  | 'mp4'
  | 'mov'
  | 'mkv'
  | 'webm'
  | 'avi'
  | 'ts'
  | 'gif'
  | 'mp3'
  | 'm4a'
  | 'wav'
  | 'flac'
  | 'ogg'
  | 'opus'

export type ImageOutputFormat =
  | 'png'
  | 'jpg'
  | 'jpeg'
  | 'webp'
  | 'svg'
  | 'avif'
  | 'jxl'
  | 'heic'
  | 'heif'

export type AudioOutputFormat = 'mp3' | 'm4a' | 'wav' | 'flac' | 'ogg' | 'opus'

type ContractBase<M extends ContractMediaType, S> = {
  $schema?: string
  version: typeof CONTRACT_VERSION
  mediaType: M
  /** Preset name; optional for one-shot compression (fills `{preset}` token in file names) */
  name?: string
  settings: S
  /** `null` or omitted follows Settings -> Output (Standard preset behavior) */
  output?: OutputSettings | null
}

export type VideoCompression =
  | { mode: 'quality'; quality: number }
  | { mode: 'targetSize'; targetSizeMB: number }
  | { mode: 'none' }

export type VideoClips =
  | { mode: 'count'; count: number }
  | { mode: 'duration'; seconds: number }
  | null

export type VideoPresetContract = ContractBase<
  'video',
  {
    format: VideoOutputFormat | null
    compression: VideoCompression
    speed: number | null
    metadata: PresetMetadataSettings
    video: {
      codec: VideoCodecName | null
      resolution: Resolution
      fps: number | null
      transform: Transform
      hdr: Hdr
    }
    audio: AudioSettings
    clips: VideoClips
  }
>

export type VideoContract = ContractBase<
  'video',
  {
    format: VideoOutputFormat | null
    compression: VideoCompression
    speed: number | null
    /** `set` is one-shot only (single file or batch); rejected when saving a preset */
    metadata: MetadataSettings
    video: {
      codec: VideoCodecName | null
      resolution: Resolution
      fps: number | null
      transform: Transform
      hdr: Hdr
      /** One-shot only (single file or batch); rejected when saving a preset */
      thumbnail?: string | null
    }
    audio: AudioSettings
    /** One-shot only (single file or batch); rejected when saving a preset */
    subtitles?: SubtitlesSettings | null
    clips: VideoClips
  }
>

export type SvgTracingSettings = {
  filterSpeckle: number
  colorPrecision: number
  layerDifference: number
  cornerThreshold: number
  lengthThreshold: number
  spliceThreshold: number
  blackAndWhite: boolean
}

export type ImageContract = ContractBase<
  'image',
  {
    format: ImageOutputFormat | null
    compression:
      | { mode: 'quality'; quality: number }
      | { mode: 'lossless' }
      | { mode: 'targetSize'; targetSizeMB: number }
    stripMetadata: boolean
    image: {
      resolution: Resolution
      transform: Transform
      hdr: Hdr
    }
    svg: {
      scale: number
      tracing: SvgTracingSettings | null
    }
  }
>

export type ImagePresetContract = ImageContract

export type AudioPresetContract = ContractBase<
  'audio',
  {
    format: AudioOutputFormat | null
    compression:
      | { mode: 'quality'; quality: number }
      | { mode: 'targetSize'; targetSizeMB: number }
    speed: number | null
    metadata: PresetMetadataSettings
    audio: AudioSettings
  }
>

export type AudioContract = ContractBase<
  'audio',
  {
    format: AudioOutputFormat | null
    compression:
      | { mode: 'quality'; quality: number }
      | { mode: 'targetSize'; targetSizeMB: number }
    speed: number | null
    /** `set` is one-shot only (single file or batch); rejected when saving a preset */
    metadata: MetadataSettings
    audio: AudioSettings
  }
>

export type MediaContract = VideoContract | ImageContract | AudioContract
export type PresetContract =
  | VideoPresetContract
  | ImagePresetContract
  | AudioPresetContract

export type ContractValidationIssue = {
  path: string
  code: string
  message: string
  allowed?: readonly (string | number)[]
}

export type ContractValidationResult<T extends MediaContract = MediaContract> =
  | {
      ok: true
      contract: T
      warnings: ContractValidationIssue[]
    }
  | {
      ok: false
      errors: ContractValidationIssue[]
      warnings: ContractValidationIssue[]
    }
