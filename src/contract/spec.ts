import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  batchResolutions,
  cropAspectRatios,
  extensions,
  VIDEO_CODECS,
} from '@/types/compression'
import {
  MAX_AUDIO_TARGET_SIZE_IN_MB,
  MIN_AUDIO_TARGET_SIZE_IN_MB,
} from '@/utils/audioTargetSize'
import { FILE_NAME_TOKENS } from '@/utils/fileNameTemplate'
import { MAX_HDR_BOOST_INTENSITY } from '@/utils/imageDynamicRange'
import {
  KB_PER_MB,
  MAX_IMAGE_TARGET_SIZE_IN_KB,
  MIN_IMAGE_TARGET_SIZE_IN_KB,
} from '@/utils/imageTargetSize'
import {
  DEFAULT_TARGET_SIZE_IN_MB,
  MAX_TARGET_SIZE_IN_MB,
  MIN_TARGET_SIZE_IN_MB,
} from '@/utils/targetSize'
import {
  type AudioCodecName,
  type AudioContract,
  type AudioOutputFormat,
  CONTRACT_VERSION,
  type ContractMediaType,
  type ContractValidationMode,
  type ImageContract,
  type ImageOutputFormat,
  type MetadataTags,
  type ResolutionPreset,
  type VideoCodecName,
  type VideoContract,
  type VideoOutputFormat,
} from './types'

/** Mapping between public contract video codec names and internal FFmpeg encoder names */
export const VIDEO_CODEC_TO_INTERNAL: Record<VideoCodecName, string> = {
  h264: 'libx264',
  hevc: 'libx265',
  vp9: 'libvpx-vp9',
  av1: 'libaom-av1',
  mpeg4: 'mpeg4',
}

export const INTERNAL_TO_VIDEO_CODEC: Record<string, VideoCodecName> =
  Object.fromEntries(
    Object.entries(VIDEO_CODEC_TO_INTERNAL).map(([pub, internal]) => [
      internal,
      pub as VideoCodecName,
    ]),
  )

/** Mapping between public contract audio codec names and internal FFmpeg encoder names */
export const AUDIO_CODEC_TO_INTERNAL: Record<AudioCodecName, string> = {
  aac: 'aac',
  mp3: 'libmp3lame',
  opus: 'libopus',
  vorbis: 'libvorbis',
  ac3: 'ac3',
  alac: 'alac',
  flac: 'flac',
  pcm: 'pcm_s16le',
}

export const INTERNAL_TO_AUDIO_CODEC: Record<string, AudioCodecName> =
  Object.fromEntries(
    Object.entries(AUDIO_CODEC_TO_INTERNAL).map(([pub, internal]) => [
      internal,
      pub as AudioCodecName,
    ]),
  )

export const VIDEO_CODEC_NAMES = Object.keys(
  VIDEO_CODEC_TO_INTERNAL,
) as VideoCodecName[]

export const AUDIO_CODEC_NAMES = Object.keys(
  AUDIO_CODEC_TO_INTERNAL,
) as AudioCodecName[]

export const VIDEO_CONTAINER_FORMATS = Object.keys(
  extensions.video,
) as (keyof typeof extensions.video)[]

export const AUDIO_OUTPUT_FORMATS = Object.keys(
  extensions.audio,
) as AudioOutputFormat[]

export const VIDEO_OUTPUT_FORMATS: readonly VideoOutputFormat[] = [
  ...VIDEO_CONTAINER_FORMATS,
  ...AUDIO_OUTPUT_FORMATS,
]

export const IMAGE_OUTPUT_FORMATS: readonly ImageOutputFormat[] = (
  Object.keys(extensions.image) as (keyof typeof extensions.image)[]
).filter((ext): ext is ImageOutputFormat => ext !== 'gif')

export const RESOLUTION_PRESETS = Object.keys(batchResolutions).filter(
  (key): key is ResolutionPreset => key !== 'original',
)

export const CROP_ASPECT_RATIOS = Object.keys(
  cropAspectRatios,
) as (keyof typeof cropAspectRatios)[]

export const AUDIO_BITRATE_VALUES = AUDIO_BITRATES.map((b) => b.value)

export const ROTATION_VALUES = [0, 90, 180, 270] as const
export const MONO_SOURCES = ['mix', 'left', 'right'] as const
export const SAVE_LOCATIONS = ['sameFolder', 'folder', 'ask'] as const

export const METADATA_TAG_KEYS = [
  'title',
  'artist',
  'album',
  'year',
  'comment',
  'description',
  'synopsis',
  'genre',
  'copyright',
  'creationTime',
] as const satisfies readonly (keyof MetadataTags)[]

export const THUMBNAIL_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const
export const SUBTITLE_EXTENSIONS = ['srt'] as const

export const ALLOWED_FILE_NAME_TOKENS = FILE_NAME_TOKENS

export const CONTRACT_LIMITS = {
  presetNameMaxLength: 40,
  quality: { min: 1, max: 100 },
  videoTargetSizeMB: {
    min: MIN_TARGET_SIZE_IN_MB,
    max: MAX_TARGET_SIZE_IN_MB,
    default: DEFAULT_TARGET_SIZE_IN_MB,
  },
  imageTargetSizeMB: {
    min: MIN_IMAGE_TARGET_SIZE_IN_KB / KB_PER_MB,
    max: MAX_IMAGE_TARGET_SIZE_IN_KB / KB_PER_MB,
    default: 0.5,
  },
  audioTargetSizeMB: {
    min: MIN_AUDIO_TARGET_SIZE_IN_MB,
    max: MAX_AUDIO_TARGET_SIZE_IN_MB,
    default: DEFAULT_TARGET_SIZE_IN_MB,
  },
  resolutionMinPx: 2,
  fps: { min: 1, max: 60 },
  speed: { min: 0.25, max: 4 },
  volumePercent: { min: 0, max: 200 },
  hdrIntensity: { min: 1, max: MAX_HDR_BOOST_INTENSITY },
  clipsCount: { min: 2, max: 1440 },
  clipsDurationSeconds: { min: 1, max: 24 * 60 * 60 },
  svgScale: { min: 1, max: 8 },
  svgTracing: {
    filterSpeckle: { min: 0, max: 128, default: 4 },
    colorPrecision: { min: 1, max: 8, default: 6 },
    layerDifference: { min: 0, max: 128, default: 16 },
    cornerThreshold: { min: 0, max: 180, default: 60 },
    lengthThreshold: { min: 0, max: 10, default: 4 },
    spliceThreshold: { min: 0, max: 180, default: 45 },
  },
} as const

export const DEFAULT_VIDEO_CONTRACT: VideoContract = {
  version: CONTRACT_VERSION,
  mediaType: 'video',
  settings: {
    format: null,
    compression: { mode: 'quality', quality: 50 },
    speed: null,
    metadata: { mode: 'strip' },
    video: {
      codec: null,
      resolution: null,
      fps: null,
      transform: null,
      hdr: null,
      thumbnail: null,
    },
    audio: {
      volumePercent: 100,
      codec: null,
      channels: null,
      bitrateKbps: null,
    },
    subtitles: null,
    clips: null,
  },
  output: null,
}

export const DEFAULT_IMAGE_CONTRACT: ImageContract = {
  version: CONTRACT_VERSION,
  mediaType: 'image',
  settings: {
    format: null,
    compression: { mode: 'quality', quality: 50 },
    stripMetadata: true,
    image: {
      resolution: null,
      transform: null,
      hdr: null,
    },
    svg: {
      scale: 1,
      tracing: null,
    },
  },
  output: null,
}

export const DEFAULT_AUDIO_CONTRACT: AudioContract = {
  version: CONTRACT_VERSION,
  mediaType: 'audio',
  settings: {
    format: null,
    compression: { mode: 'quality', quality: 50 },
    speed: null,
    metadata: { mode: 'strip' },
    audio: {
      volumePercent: 100,
      codec: null,
      channels: null,
      bitrateKbps: null,
    },
  },
  output: null,
}

export function getVideoCodecCompatibleContainers(): Record<
  VideoCodecName,
  string[]
> {
  const result = {} as Record<VideoCodecName, string[]>
  for (const name of VIDEO_CODEC_NAMES) {
    const internal = VIDEO_CODEC_TO_INTERNAL[name]
    const option = VIDEO_CODECS.find((c) => c.value === internal)
    result[name] = option ? [...option.compatible_containers] : []
  }
  return result
}

export function getAudioCodecCompatibleContainers(): Record<
  AudioCodecName,
  string[]
> {
  const result = {} as Record<AudioCodecName, string[]>
  for (const name of AUDIO_CODEC_NAMES) {
    const internal = AUDIO_CODEC_TO_INTERNAL[name]
    const option = AUDIO_CODECS.find((c) => c.value === internal)
    result[name] = option ? [...option.compatible_containers] : []
  }
  return result
}

export function getContractCapabilities() {
  return {
    contractVersion: CONTRACT_VERSION,
    formats: {
      video: [...VIDEO_OUTPUT_FORMATS],
      image: [...IMAGE_OUTPUT_FORMATS],
      audio: [...AUDIO_OUTPUT_FORMATS],
    },
    resolutions: { ...batchResolutions },
    cropAspectRatios: [...CROP_ASPECT_RATIOS],
    videoCodecs: getVideoCodecCompatibleContainers(),
    audioCodecs: getAudioCodecCompatibleContainers(),
    audioBitratesKbps: [...AUDIO_BITRATE_VALUES],
    limits: CONTRACT_LIMITS,
    fileNameTokens: [...ALLOWED_FILE_NAME_TOKENS],
    defaults: {
      video: DEFAULT_VIDEO_CONTRACT,
      image: DEFAULT_IMAGE_CONTRACT,
      audio: DEFAULT_AUDIO_CONTRACT,
    },
  }
}

function nullable<T extends Record<string, unknown>>(schema: T) {
  return { anyOf: [schema, { type: 'null' }] }
}

function resolutionSchema() {
  return {
    description:
      'Longer side target: null keeps original size, or use a preset name (480p..4k) or an even pixel integer >= 2.',
    anyOf: [
      { type: 'string', enum: RESOLUTION_PRESETS },
      {
        type: 'integer',
        minimum: CONTRACT_LIMITS.resolutionMinPx,
        multipleOf: 2,
      },
      { type: 'null' },
    ],
  }
}

function transformSchema() {
  return nullable({
    type: 'object',
    additionalProperties: false,
    required: ['rotate', 'flipHorizontal', 'flipVertical', 'crop'],
    properties: {
      rotate: { type: 'integer', enum: [...ROTATION_VALUES] },
      flipHorizontal: { type: 'boolean' },
      flipVertical: { type: 'boolean' },
      crop: nullable({ type: 'string', enum: CROP_ASPECT_RATIOS }),
    },
  })
}

function hdrSchema() {
  return {
    description: 'null keeps original dynamic range.',
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'intensity'],
        properties: {
          mode: { const: 'boost' },
          intensity: {
            type: 'number',
            minimum: CONTRACT_LIMITS.hdrIntensity.min,
            maximum: CONTRACT_LIMITS.hdrIntensity.max,
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['mode'],
        properties: {
          mode: { const: 'remove' },
        },
      },
      { type: 'null' },
    ],
  }
}

function audioSettingsSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      volumePercent: {
        type: 'number',
        minimum: CONTRACT_LIMITS.volumePercent.min,
        maximum: CONTRACT_LIMITS.volumePercent.max,
      },
      codec: nullable({ type: 'string', enum: AUDIO_CODEC_NAMES }),
      channels: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['layout', 'source'],
            properties: {
              layout: { const: 'mono' },
              source: { type: 'string', enum: [...MONO_SOURCES] },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['layout', 'swapChannels'],
            properties: {
              layout: { const: 'stereo' },
              swapChannels: { type: 'boolean' },
            },
          },
          { type: 'null' },
        ],
      },
      bitrateKbps: nullable({
        type: 'integer',
        enum: AUDIO_BITRATE_VALUES,
      }),
    },
  }
}

function metadataTagsSchema() {
  const props: Record<string, unknown> = {}
  for (const key of METADATA_TAG_KEYS) {
    props[key] = nullable({ type: 'string' })
  }
  return {
    type: 'object',
    additionalProperties: false,
    'x-compresso-scope': 'oneShot',
    description:
      'One-shot compression only (single file or batch). Rejected when saving a preset.',
    properties: props,
  }
}

function metadataSchema(mode: ContractValidationMode) {
  const keepProperties: Record<string, unknown> = {
    mode: { const: 'keep' },
  }
  if (mode === 'oneShot') {
    keepProperties.set = {
      ...nullable(metadataTagsSchema()),
      'x-compresso-scope': 'oneShot',
      description:
        'One-shot compression only (single file or batch). Writes metadata tags; rejected when saving a preset.',
    }
  }
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['mode'],
        properties: { mode: { const: 'strip' } },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['mode'],
        properties: keepProperties,
      },
    ],
  }
}

function subtitlesSchema() {
  return {
    ...nullable({
      type: 'object',
      additionalProperties: false,
      required: ['preserveExisting', 'tracks'],
      properties: {
        preserveExisting: { type: 'boolean' },
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path'],
            properties: {
              path: {
                type: 'string',
                minLength: 1,
                description: 'Absolute path to an .srt subtitle file.',
              },
              language: { type: 'string', minLength: 1 },
              title: nullable({ type: 'string' }),
            },
          },
        },
      },
    }),
    'x-compresso-scope': 'oneShot',
    description:
      'One-shot compression only (single file or batch). Rejected when saving a preset.',
  }
}

function outputSchema() {
  return nullable({
    type: 'object',
    additionalProperties: false,
    required: ['saveTo', 'fileNameTemplate'],
    properties: {
      saveTo: { type: 'string', enum: [...SAVE_LOCATIONS] },
      folder: nullable({
        type: 'string',
        description: 'Absolute folder path, required when saveTo is "folder".',
      }),
      fileNameTemplate: {
        type: 'string',
        description:
          'Tokens: {name}, {date}, {time}, {preset}. Empty string keeps original file names.',
      },
    },
  })
}

export function getContractJsonSchema(
  mediaType: ContractMediaType,
  options: { mode?: ContractValidationMode } = {},
) {
  const mode = options.mode ?? 'oneShot'
  const baseProperties = {
    $schema: { type: 'string' },
    version: { const: CONTRACT_VERSION },
    mediaType: { const: mediaType },
    name: {
      type: 'string',
      maxLength: CONTRACT_LIMITS.presetNameMaxLength,
      description:
        'Preset name (required when saving a preset; optional in one-shot compression).',
    },
    output: outputSchema(),
  }

  if (mediaType === 'video') {
    const videoProperties: Record<string, unknown> = {
      codec: nullable({ type: 'string', enum: VIDEO_CODEC_NAMES }),
      resolution: resolutionSchema(),
      fps: nullable({
        type: 'integer',
        minimum: CONTRACT_LIMITS.fps.min,
        maximum: CONTRACT_LIMITS.fps.max,
      }),
      transform: transformSchema(),
      hdr: hdrSchema(),
    }
    if (mode === 'oneShot') {
      videoProperties.thumbnail = {
        ...nullable({
          type: 'string',
          minLength: 1,
          description:
            'Absolute path to a png, jpg, jpeg, or webp cover image.',
        }),
        'x-compresso-scope': 'oneShot',
        description:
          'One-shot compression only (single file or batch). Rejected when saving a preset.',
      }
    }

    const settingsProperties: Record<string, unknown> = {
      format: nullable({ type: 'string', enum: VIDEO_OUTPUT_FORMATS }),
      compression: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'quality'],
            properties: {
              mode: { const: 'quality' },
              quality: {
                type: 'number',
                minimum: CONTRACT_LIMITS.quality.min,
                maximum: CONTRACT_LIMITS.quality.max,
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'targetSizeMB'],
            properties: {
              mode: { const: 'targetSize' },
              targetSizeMB: {
                type: 'number',
                minimum: CONTRACT_LIMITS.videoTargetSizeMB.min,
                maximum: CONTRACT_LIMITS.videoTargetSizeMB.max,
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode'],
            properties: { mode: { const: 'none' } },
          },
        ],
      },
      speed: nullable({
        type: 'number',
        minimum: CONTRACT_LIMITS.speed.min,
        maximum: CONTRACT_LIMITS.speed.max,
      }),
      metadata: metadataSchema(mode),
      video: {
        type: 'object',
        additionalProperties: false,
        properties: videoProperties,
      },
      audio: audioSettingsSchema(),
      clips: {
        anyOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'count'],
            properties: {
              mode: { const: 'count' },
              count: {
                type: 'integer',
                minimum: CONTRACT_LIMITS.clipsCount.min,
                maximum: CONTRACT_LIMITS.clipsCount.max,
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'seconds'],
            properties: {
              mode: { const: 'duration' },
              seconds: {
                type: 'number',
                minimum: CONTRACT_LIMITS.clipsDurationSeconds.min,
                maximum: CONTRACT_LIMITS.clipsDurationSeconds.max,
              },
            },
          },
          { type: 'null' },
        ],
      },
    }
    if (mode === 'oneShot') {
      settingsProperties.subtitles = subtitlesSchema()
    }

    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'CompressO Video Contract (v1)',
      type: 'object',
      additionalProperties: false,
      required: ['version', 'mediaType'],
      properties: {
        ...baseProperties,
        settings: {
          type: 'object',
          additionalProperties: false,
          properties: settingsProperties,
        },
      },
    }
  }

  if (mediaType === 'image') {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'CompressO Image Contract (v1)',
      type: 'object',
      additionalProperties: false,
      required: ['version', 'mediaType'],
      properties: {
        ...baseProperties,
        settings: {
          type: 'object',
          additionalProperties: false,
          properties: {
            format: nullable({ type: 'string', enum: IMAGE_OUTPUT_FORMATS }),
            compression: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['mode', 'quality'],
                  properties: {
                    mode: { const: 'quality' },
                    quality: {
                      type: 'number',
                      minimum: CONTRACT_LIMITS.quality.min,
                      maximum: CONTRACT_LIMITS.quality.max,
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['mode'],
                  properties: { mode: { const: 'lossless' } },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['mode', 'targetSizeMB'],
                  properties: {
                    mode: { const: 'targetSize' },
                    targetSizeMB: {
                      type: 'number',
                      minimum: CONTRACT_LIMITS.imageTargetSizeMB.min,
                      maximum: CONTRACT_LIMITS.imageTargetSizeMB.max,
                    },
                  },
                },
              ],
            },
            stripMetadata: { type: 'boolean' },
            image: {
              type: 'object',
              additionalProperties: false,
              properties: {
                resolution: resolutionSchema(),
                transform: transformSchema(),
                hdr: hdrSchema(),
              },
            },
            svg: {
              type: 'object',
              additionalProperties: false,
              properties: {
                scale: {
                  type: 'integer',
                  minimum: CONTRACT_LIMITS.svgScale.min,
                  maximum: CONTRACT_LIMITS.svgScale.max,
                },
                tracing: nullable({
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    filterSpeckle: {
                      type: 'integer',
                      minimum: CONTRACT_LIMITS.svgTracing.filterSpeckle.min,
                      maximum: CONTRACT_LIMITS.svgTracing.filterSpeckle.max,
                    },
                    colorPrecision: {
                      type: 'integer',
                      minimum: CONTRACT_LIMITS.svgTracing.colorPrecision.min,
                      maximum: CONTRACT_LIMITS.svgTracing.colorPrecision.max,
                    },
                    layerDifference: {
                      type: 'integer',
                      minimum: CONTRACT_LIMITS.svgTracing.layerDifference.min,
                      maximum: CONTRACT_LIMITS.svgTracing.layerDifference.max,
                    },
                    cornerThreshold: {
                      type: 'integer',
                      minimum: CONTRACT_LIMITS.svgTracing.cornerThreshold.min,
                      maximum: CONTRACT_LIMITS.svgTracing.cornerThreshold.max,
                    },
                    lengthThreshold: {
                      type: 'number',
                      minimum: CONTRACT_LIMITS.svgTracing.lengthThreshold.min,
                      maximum: CONTRACT_LIMITS.svgTracing.lengthThreshold.max,
                    },
                    spliceThreshold: {
                      type: 'integer',
                      minimum: CONTRACT_LIMITS.svgTracing.spliceThreshold.min,
                      maximum: CONTRACT_LIMITS.svgTracing.spliceThreshold.max,
                    },
                    blackAndWhite: { type: 'boolean' },
                  },
                }),
              },
            },
          },
        },
      },
    }
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'CompressO Audio Contract (v1)',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'mediaType'],
    properties: {
      ...baseProperties,
      settings: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: nullable({ type: 'string', enum: AUDIO_OUTPUT_FORMATS }),
          compression: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                required: ['mode', 'quality'],
                properties: {
                  mode: { const: 'quality' },
                  quality: {
                    type: 'number',
                    minimum: CONTRACT_LIMITS.quality.min,
                    maximum: CONTRACT_LIMITS.quality.max,
                  },
                },
              },
              {
                type: 'object',
                additionalProperties: false,
                required: ['mode', 'targetSizeMB'],
                properties: {
                  mode: { const: 'targetSize' },
                  targetSizeMB: {
                    type: 'number',
                    minimum: CONTRACT_LIMITS.audioTargetSizeMB.min,
                    maximum: CONTRACT_LIMITS.audioTargetSizeMB.max,
                  },
                },
              },
            ],
          },
          speed: nullable({
            type: 'number',
            minimum: CONTRACT_LIMITS.speed.min,
            maximum: CONTRACT_LIMITS.speed.max,
          }),
          metadata: metadataSchema(mode),
          audio: audioSettingsSchema(),
        },
      },
    },
  }
}
