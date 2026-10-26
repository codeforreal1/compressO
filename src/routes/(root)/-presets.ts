import { core } from '@tauri-apps/api'
import cloneDeep from 'lodash/cloneDeep'
import isEqual from 'lodash/isEqual'

import { t } from '@/i18n'
import {
  deletePreset,
  getStoredPreset,
  presetsStore,
} from '@/stores/presetsStore'
import { getAudioStreams } from '@/tauri/commands/ffprobe'
import { ImageConfig, VideoConfig } from '@/types/app'
import {
  type BatchResolution,
  extensions,
  getAudioFileOutputExtension,
  getBatchResolutionForLongerSide,
  getBatchResolutionLongerSide,
  inputOnlyExtensions,
  isAudioExtension,
  type PortableTransform,
  VIDEO_CODECS,
} from '@/types/compression'
import {
  type AudioPreset,
  type AudioPresetKey,
  type AudioPresetSettings,
  audioFilePresetFields,
  type ImagePreset,
  type ImagePresetField,
  type ImagePresetKey,
  type ImagePresetSettings,
  imagePresetFields,
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
  type VideoPreset,
  type VideoPresetField,
  type VideoPresetKey,
  type VideoPresetSettings,
  videoPresetFields,
} from '@/types/preset'
import {
  formatImageTargetSize,
  supportsImageTargetSize,
} from '@/utils/imageTargetSize'
import { formatSizeInMB } from '@/utils/targetSize'
import {
  applyPortableTransform,
  getPortableTransform,
  normalizeRotation,
} from '@/utils/transform'
import {
  getLongerSideDimensions,
  getOutputVideoContainer,
  getTransformedDimensions,
} from '@/utils/video'
import {
  appProxy,
  audioFileConfigInitialState,
  imageConfigInitialState,
  normalizeBatchMediaConfig,
  videoConfigInitialState,
} from './-state'
import { AUDIO_CODECS } from './ui/output-settings/video-settings/audio/AudioCodec'

/** Video preset settings that only apply to a video with audio */
const audioPresetFields: VideoPresetField[] = [
  'audioConfig',
  'shouldEnableCustomAudioCodec',
  'shouldEnableCustomChannel',
  'shouldEnableCustomBitrate',
]

/** Rounded to an even number, as video encoders require */
function toEven(value: number) {
  return Math.max(2, Math.round(value / 2) * 2)
}

/**
 * Size of the longer side a video (or all videos of a batch) is resized to, `null` for the original
 * size: the batch resolution for the batch settings, otherwise the video's custom dimensions (or the
 * batch resolution, which a video of a batch without custom dimensions follows).
 */
export function getVideoConfigResolution(
  config: VideoConfig,
  {
    isBatchConfig,
    batchResolution = appProxy.state.commonConfigForBatchCompression.videoConfig
      .batchResolution,
  }: {
    isBatchConfig: boolean
    /** Resolution of the batch (pass it from a snapshot to re-render when it changes) */
    batchResolution?: BatchResolution
  },
): number | null {
  if (isBatchConfig) {
    return getBatchResolutionLongerSide(config.batchResolution)
  }
  if (config.shouldEnableCustomDimensions && config.customDimensions) {
    return toEven(Math.max(...config.customDimensions))
  }
  return appProxy.state.media.length > 1
    ? getBatchResolutionLongerSide(batchResolution)
    : null
}

/**
 * Portable transform of a config: the batch's (set on the batch config only), or the media's own
 * (a free crop is not portable)
 */
function getConfigTransform(
  batchTransform: PortableTransform | null | undefined,
  shouldTransform: boolean | undefined,
  transformConfig: Parameters<typeof getPortableTransform>[0],
) {
  if (batchTransform !== undefined) return batchTransform
  return shouldTransform ? getPortableTransform(transformConfig) : null
}

export function pickVideoPresetSettings(
  config: VideoConfig,
  resolution: number | null,
): VideoPresetSettings {
  const settings = {} as Record<VideoPresetKey, unknown>
  for (const field of videoPresetFields) {
    settings[field] = cloneDeep(config[field])
  }
  const { volume, audioCodec, audioChannelConfig, bitrate } =
    config.audioConfig ?? videoConfigInitialState.audioConfig
  settings.audioConfig = cloneDeep({
    volume,
    audioCodec,
    audioChannelConfig,
    bitrate,
  })
  settings.resolution = resolution
  settings.transform = getConfigTransform(
    config.batchTransform,
    config.shouldTransformVideo,
    config.transformVideoConfig,
  )
  return settings as VideoPresetSettings
}

/**
 * Size of the longer side an image (or all images of a batch) is resized to, `null` for the original
 * size: the batch's for the batch settings, otherwise the image's custom dimensions (or the batch's,
 * which an image of a batch without custom dimensions follows).
 */
export function getImageConfigResolution(
  config: ImageConfig,
  {
    isBatchConfig,
    batchLongerSide = appProxy.state.commonConfigForBatchCompression.imageConfig
      .batchLongerSide,
  }: {
    isBatchConfig: boolean
    /** Size of the batch (pass it from a snapshot to re-render when it changes) */
    batchLongerSide?: number | null
  },
): number | null {
  if (isBatchConfig) return config.batchLongerSide ?? null
  if (config.shouldEnableCustomDimensions && config.customDimensions) {
    return toEven(Math.max(...config.customDimensions))
  }
  return appProxy.state.media.length > 1 ? (batchLongerSide ?? null) : null
}

export function pickImagePresetSettings(
  config: ImageConfig,
  resolution: number | null,
): ImagePresetSettings {
  const settings = {} as Record<ImagePresetKey, unknown>
  for (const field of imagePresetFields) {
    settings[field] = cloneDeep(config[field])
  }
  settings.resolution = resolution
  settings.transform = getConfigTransform(
    config.batchTransform,
    config.shouldTransformImage,
    config.transformImageConfig,
  )
  return settings as ImagePresetSettings
}

const defaultVideoPreset: VideoPreset = {
  id: STANDARD_PRESET_ID,
  get name() {
    return t('presets.standard')
  },
  mediaType: 'video',
  settings: pickVideoPresetSettings(videoConfigInitialState, null),
}

const defaultImagePreset: ImagePreset = {
  id: STANDARD_PRESET_ID,
  get name() {
    return t('presets.standard')
  },
  mediaType: 'image',
  settings: pickImagePresetSettings(imageConfigInitialState, null),
}

export function pickAudioPresetSettings(
  config: VideoConfig,
): AudioPresetSettings {
  const settings = {} as Record<AudioPresetKey, unknown>
  for (const field of audioFilePresetFields) {
    settings[field] = cloneDeep(config[field])
  }
  const { volume, audioCodec, audioChannelConfig, bitrate } =
    config.audioConfig ?? audioFileConfigInitialState.audioConfig
  settings.audioConfig = cloneDeep({
    volume,
    audioCodec,
    audioChannelConfig,
    bitrate,
  })
  return settings as AudioPresetSettings
}

const defaultAudioPreset: AudioPreset = {
  id: STANDARD_PRESET_ID,
  get name() {
    return t('presets.standard')
  },
  mediaType: 'audio',
  settings: pickAudioPresetSettings(audioFileConfigInitialState),
}

/**
 * A video preset, or the Standard preset when not found (e.g. deleted). `presets` can be a snapshot,
 * so components re-render when the preset changes.
 */
export function getVideoPreset(
  id: string | null | undefined,
  presets: readonly Preset[] = presetsStore.presets,
): VideoPreset {
  const preset = presets.find((p) => p.id === id)
  return preset?.mediaType === 'video' ? preset : defaultVideoPreset
}

export function getImagePreset(
  id: string | null | undefined,
  presets: readonly Preset[] = presetsStore.presets,
): ImagePreset {
  const preset = presets.find((p) => p.id === id)
  return preset?.mediaType === 'image' ? preset : defaultImagePreset
}

export function getAudioPreset(
  id: string | null | undefined,
  presets: readonly Preset[] = presetsStore.presets,
): AudioPreset {
  const preset = presets.find((p) => p.id === id)
  return preset?.mediaType === 'audio' ? preset : defaultAudioPreset
}

export function getPreset(
  mediaType: PresetMediaType,
  id: string | null | undefined,
  presets: readonly Preset[] = presetsStore.presets,
): Preset {
  switch (mediaType) {
    case 'video':
      return getVideoPreset(id, presets)
    case 'audio':
      return getAudioPreset(id, presets)
    default:
      return getImagePreset(id, presets)
  }
}

/** Standard preset of a media type */
function getDefaultPreset(mediaType: PresetMediaType): Preset {
  switch (mediaType) {
    case 'video':
      return defaultVideoPreset
    case 'audio':
      return defaultAudioPreset
    default:
      return defaultImagePreset
  }
}

/**
 * Whether a media uses the presets of a type: audio files (videos without a picture, see
 * `Video.isAudioFile`) use audio presets, not video presets
 */
export function isMediaOfPresetType(
  mediaFile: { type: 'video' | 'image'; isAudioFile?: boolean } | undefined,
  mediaType: PresetMediaType,
) {
  if (!mediaFile) return false
  if (mediaType === 'audio') {
    return mediaFile.type === 'video' && !!mediaFile.isAudioFile
  }
  if (mediaType === 'video') {
    return mediaFile.type === 'video' && !mediaFile.isAudioFile
  }
  return mediaFile.type === 'image'
}

/** The batch settings a preset type is applied to */
export function getBatchConfigKey(mediaType: PresetMediaType) {
  switch (mediaType) {
    case 'video':
      return 'videoConfig' as const
    case 'audio':
      return 'audioFileConfig' as const
    default:
      return 'imageConfig' as const
  }
}

/** The presets of a media type, with the Standard preset first */
export function getPresets(
  mediaType: PresetMediaType,
  presets: readonly Preset[] = presetsStore.presets,
): Preset[] {
  return [
    getDefaultPreset(mediaType),
    ...presets.filter((preset) => preset.mediaType === mediaType),
  ]
}

/** File the preset is applied to; unknown for the settings of a whole batch */
type PresetTarget = {
  sourceExtension: string | null | undefined
  /** `null` when not known (then the audio settings are applied) */
  hasAudio?: boolean | null
  /** Size of the video (before its transforms); unset for the settings of a whole batch */
  dimensions?: { width: number; height: number } | null
}

function getValidResolution(resolution: unknown) {
  return typeof resolution === 'number' && resolution > 0 ? resolution : null
}

/**
 * Custom dimensions for a preset's resolution (the size of the longer side), from the size of the
 * media as it is output (after its rotations & crop): the width of a landscape media, the height of
 * a portrait one, upscaling smaller media. Skipped when the size of the media is not known.
 */
function getPresetCustomDimensions(
  outputDimensions: { width: number; height: number } | null,
  resolution: number | null,
) {
  if (!resolution) return { customDimensions: null, isSkipped: false }
  const customDimensions = outputDimensions
    ? getLongerSideDimensions(outputDimensions, resolution)
    : null
  return { customDimensions, isSkipped: !customDimensions }
}

/**
 * Applies a video preset to a video's config (or to the batch settings when `dimensions` is unset),
 * keeping the settings that are not part of presets (trim, crop, subtitles, ...). The resolution is
 * applied as the video's custom dimensions, or as the batch resolution. Settings that cannot be
 * applied to the video are left at their default value and listed in `presetSkippedFields`, so they
 * are neither shown as changes nor written back when the preset is updated:
 * - audio settings of a video without audio (and audio formats, which extract the audio)
 * - a video or audio codec the output format does not support
 * - a resolution for a video whose size is not known
 */
export function applyVideoPresetToConfig(
  config: VideoConfig,
  preset: VideoPreset,
  { sourceExtension, hasAudio, dimensions }: PresetTarget,
  { isBatchConfig }: { isBatchConfig: boolean },
): VideoConfig {
  const { settings } = preset
  const defaults = defaultVideoPreset.settings
  const skippedFields = new Set<VideoPresetKey>()

  if (hasAudio === false) {
    for (const field of audioPresetFields) skippedFields.add(field)
    if (isAudioExtension(settings.convertToExtension)) {
      skippedFields.add('convertToExtension')
    }
  }

  const convertToExtension = skippedFields.has('convertToExtension')
    ? defaults.convertToExtension
    : settings.convertToExtension
  // Unknown for "Same as input" on a batch, then every codec is kept
  const container = getOutputVideoContainer(convertToExtension, sourceExtension)
  if (container && settings.shouldEnableCustomVideoCodec) {
    const codec = VIDEO_CODECS.find(
      (c) => c.value === settings.customVideoCodec,
    )
    if (
      codec &&
      !(codec.compatible_containers as string[]).includes(container)
    ) {
      skippedFields.add('shouldEnableCustomVideoCodec')
      skippedFields.add('customVideoCodec')
    }
  }
  if (
    container &&
    settings.shouldEnableCustomAudioCodec &&
    !skippedFields.has('audioConfig')
  ) {
    const codec = AUDIO_CODECS.find(
      (c) => c.value === settings.audioConfig?.audioCodec,
    )
    if (
      codec &&
      !(codec.compatible_containers as string[]).includes(container)
    ) {
      skippedFields.add('shouldEnableCustomAudioCodec')
    }
  }

  const nextConfig = cloneDeep(config)
  const nextFields = nextConfig as Record<VideoPresetField, unknown>
  for (const field of videoPresetFields) {
    if (field === 'audioConfig') continue
    nextFields[field] = cloneDeep(
      skippedFields.has(field) ? defaults[field] : settings[field],
    )
  }
  // Audio tracks are chosen per video, so they are kept
  nextConfig.audioConfig = {
    ...nextConfig.audioConfig,
    ...cloneDeep(
      skippedFields.has('audioConfig')
        ? defaults.audioConfig
        : settings.audioConfig,
    ),
  }
  if (skippedFields.has('shouldEnableCustomAudioCodec')) {
    nextConfig.audioConfig.audioCodec = defaults.audioConfig.audioCodec
  }
  // The transform first: the resolution is for the size after the crop
  const transform = settings.transform ?? null
  if (isBatchConfig) {
    nextConfig.batchTransform = transform
  } else if (isAudioExtension(nextConfig.convertToExtension)) {
    // Extracting audio: nothing to transform
    if (transform) skippedFields.add('transform')
  } else if (
    applyPortableTransform(nextConfig, 'video', transform, dimensions) !==
      'applied' &&
    transform
  ) {
    skippedFields.add('transform')
  }

  const resolution = getValidResolution(settings.resolution)
  if (isBatchConfig) {
    nextConfig.batchResolution = getBatchResolutionForLongerSide(resolution)
  } else {
    // The size of the video as it is output (after its rotations & crop)
    const outputDimensions = dimensions
      ? getTransformedDimensions(
          dimensions,
          nextConfig.shouldTransformVideo
            ? nextConfig.transformVideoConfig?.transformHistory
            : null,
        )
      : null
    const { customDimensions, isSkipped } = getPresetCustomDimensions(
      outputDimensions,
      resolution,
    )
    if (isSkipped) skippedFields.add('resolution')
    nextConfig.shouldEnableCustomDimensions = !!customDimensions
    // No custom dimensions means the output keeps its original size
    nextConfig.customDimensions = customDimensions ?? undefined
  }
  // "Same as input" is shown as the video's own format when it can be selected (see `addMedia`)
  if (
    nextConfig.convertToExtension === '-' &&
    sourceExtension &&
    sourceExtension in extensions.video
  ) {
    nextConfig.convertToExtension =
      sourceExtension as keyof typeof extensions.video
  }

  nextConfig.presetId = preset.id
  nextConfig.presetSkippedFields = [...skippedFields]
  return nextConfig
}

/**
 * Applies an image preset to an image's config (or to the batch settings when `isBatchConfig`),
 * keeping the transforms. The resolution is applied as the image's custom dimensions (as for videos,
 * see `applyVideoPresetToConfig`), or as the batch's size; SVGs (as source or output) keep their
 * size. A GIF keeps its format (it cannot be converted), and formats that can only be opened are
 * converted to PNG unless the preset converts them to another format.
 */
export function applyImagePresetToConfig(
  config: ImageConfig,
  preset: ImagePreset,
  { sourceExtension, dimensions }: PresetTarget,
  { isBatchConfig }: { isBatchConfig: boolean },
): ImageConfig {
  const { settings } = preset
  const skippedFields = new Set<ImagePresetKey>()

  const nextConfig = cloneDeep(config)
  const nextFields = nextConfig as Record<ImagePresetField, unknown>
  for (const field of imagePresetFields) {
    nextFields[field] = cloneDeep(settings[field])
  }

  if (sourceExtension === 'gif') {
    skippedFields.add('convertToExtension')
    nextConfig.convertToExtension = '-'
  } else if (
    (inputOnlyExtensions.image as readonly string[]).includes(
      sourceExtension ?? '',
    ) &&
    settings.convertToExtension === '-'
  ) {
    skippedFields.add('convertToExtension')
    nextConfig.convertToExtension = 'png'
  }

  // The transform first: the resolution is for the size after the crop
  const transform = settings.transform ?? null
  if (isBatchConfig) {
    nextConfig.batchTransform = transform
  } else if (
    sourceExtension === 'svg' ||
    nextConfig.convertToExtension === 'svg'
  ) {
    // SVGs cannot be transformed
    if (transform) skippedFields.add('transform')
  } else if (
    applyPortableTransform(nextConfig, 'image', transform, dimensions) !==
      'applied' &&
    transform
  ) {
    skippedFields.add('transform')
  }

  const resolution = getValidResolution(settings.resolution)
  if (isBatchConfig) {
    nextConfig.batchLongerSide = resolution
  } else if (
    sourceExtension === 'svg' ||
    nextConfig.convertToExtension === 'svg'
  ) {
    // SVGs are resized with the SVG scale factor instead
    if (resolution) skippedFields.add('resolution')
  } else {
    const outputDimensions = dimensions?.width
      ? getTransformedDimensions(
          dimensions,
          nextConfig.shouldTransformImage
            ? nextConfig.transformImageConfig?.transformHistory
            : null,
        )
      : null
    const { customDimensions, isSkipped } = getPresetCustomDimensions(
      outputDimensions,
      resolution,
    )
    if (isSkipped) skippedFields.add('resolution')
    nextConfig.shouldEnableCustomDimensions = !!customDimensions
    nextConfig.customDimensions = customDimensions ?? undefined
  }

  nextConfig.presetId = preset.id
  nextConfig.presetSkippedFields = [...skippedFields]
  return nextConfig
}

/**
 * Applies an audio preset to an audio file's config (or to the batch's audio settings when
 * `isBatchConfig`), keeping its trim & metadata values. "Same as input" is shown as the file's own
 * format (the closest one that can be written for formats that can only be read); an audio codec
 * the format cannot hold is left at its default and listed in `presetSkippedFields`.
 */
export function applyAudioPresetToConfig(
  config: VideoConfig,
  preset: AudioPreset,
  { sourceExtension }: { sourceExtension: string | null | undefined },
  { isBatchConfig }: { isBatchConfig: boolean },
): VideoConfig {
  const { settings } = preset
  const defaults = defaultAudioPreset.settings
  const skippedFields = new Set<AudioPresetKey>()
  const nextConfig = cloneDeep(config)
  const nextFields = nextConfig as Record<AudioPresetKey, unknown>
  for (const field of audioFilePresetFields) {
    if (field === 'audioConfig') continue
    nextFields[field] = cloneDeep(settings[field])
  }
  if (nextConfig.convertToExtension === '-' && !isBatchConfig) {
    nextConfig.convertToExtension = getAudioFileOutputExtension(sourceExtension)
  }
  // Unknown for "Same as input" on a batch, then every codec is kept
  const format = isAudioExtension(nextConfig.convertToExtension)
    ? nextConfig.convertToExtension
    : null
  if (format && settings.shouldEnableCustomAudioCodec) {
    const codec = AUDIO_CODECS.find(
      (c) => c.value === settings.audioConfig?.audioCodec,
    )
    if (codec && !(codec.compatible_containers as string[]).includes(format)) {
      skippedFields.add('shouldEnableCustomAudioCodec')
      nextConfig.shouldEnableCustomAudioCodec =
        defaults.shouldEnableCustomAudioCodec
    }
  }
  // Audio tracks are chosen per file, so they are kept
  nextConfig.audioConfig = {
    ...nextConfig.audioConfig,
    ...cloneDeep(settings.audioConfig),
  }
  if (skippedFields.has('shouldEnableCustomAudioCodec')) {
    nextConfig.audioConfig.audioCodec = defaults.audioConfig.audioCodec
  }
  nextConfig.presetId = preset.id
  nextConfig.presetSkippedFields = [...skippedFields]
  return nextConfig
}

/** Removes empty values, so a missing, `undefined` or `null` setting compares as the same */
function withoutEmptyValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEmptyValues)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, withoutEmptyValues(v)]),
    )
  }
  return value
}

/** "Same as input" & the input's own format are the same output */
function resolveExtension(
  extension: string | undefined,
  sourceExtension: string | null | undefined,
) {
  return extension === '-' && sourceExtension ? sourceExtension : extension
}

/**
 * Settings that change the output: values of a switch that is off (e.g. the FPS of a disabled
 * custom FPS) and skipped settings are removed, and "Same as input" is the input's own format.
 */
function getEffectiveVideoSettings(
  settings: VideoPresetSettings,
  skippedFields: readonly string[] | undefined,
  sourceExtension: string | null | undefined,
) {
  const effective: Record<string, unknown> = cloneDeep(settings)
  const audioConfig = effective.audioConfig as Record<string, unknown>
  // Compressed to a size: the quality & lossless do not apply (presets saved before target sizes
  // have neither field, which is compressing by quality)
  if (settings.shouldUseTargetSize) {
    delete effective.quality
    delete effective.shouldDisableCompression
  } else {
    delete effective.shouldUseTargetSize
    delete effective.targetSizeInMB
    if (settings.shouldDisableCompression) delete effective.quality
  }
  if (!settings.shouldEnableCustomVideoCodec) delete effective.customVideoCodec
  if (!settings.shouldEnableCustomFPS) delete effective.customFPS
  if (!settings.shouldEnableCustomSpeed) delete effective.customSpeed
  if (audioConfig) {
    if (
      !settings.shouldEnableCustomAudioCodec ||
      skippedFields?.includes('shouldEnableCustomAudioCodec')
    ) {
      delete audioConfig.audioCodec
    }
    if (!settings.shouldEnableCustomChannel) {
      delete audioConfig.audioChannelConfig
    }
    if (!settings.shouldEnableCustomBitrate) delete audioConfig.bitrate
  }
  for (const field of skippedFields ?? []) delete effective[field]
  if ('convertToExtension' in effective) {
    effective.convertToExtension = resolveExtension(
      settings.convertToExtension,
      sourceExtension,
    )
  }
  return withoutEmptyValues(effective)
}

function getEffectiveImageSettings(
  settings: ImagePresetSettings,
  skippedFields: readonly string[] | undefined,
  sourceExtension: string | null | undefined,
) {
  const effective: Record<string, unknown> = cloneDeep(settings)
  // Compressed to a size: the quality & lossless do not apply (presets saved before image target
  // sizes have neither field, which is compressing by quality)
  if (settings.shouldUseTargetSize) {
    delete effective.quality
    delete effective.isLossless
  } else {
    delete effective.shouldUseTargetSize
    delete effective.targetSizeInKB
    if (settings.isLossless) delete effective.quality
  }
  if (!settings.shouldEnableAdvancedSvgSetting) delete effective.svgConfig
  for (const field of skippedFields ?? []) delete effective[field]
  if ('convertToExtension' in effective) {
    effective.convertToExtension = resolveExtension(
      settings.convertToExtension,
      sourceExtension,
    )
  }
  return withoutEmptyValues(effective)
}

/**
 * Settings of an audio file that change the output (see `getEffectiveVideoSettings`): the quality
 * does not with a bitrate chosen, and "Same as input" is the format the file is written in
 */
function getEffectiveAudioSettings(
  settings: AudioPresetSettings,
  skippedFields: readonly string[] | undefined,
  sourceExtension: string | null | undefined,
) {
  const effective: Record<string, unknown> = cloneDeep(settings)
  const audioConfig = effective.audioConfig as Record<string, unknown>
  if (!settings.shouldEnableCustomSpeed) delete effective.customSpeed
  if (settings.shouldEnableCustomBitrate) delete effective.quality
  if (audioConfig) {
    if (
      !settings.shouldEnableCustomAudioCodec ||
      skippedFields?.includes('shouldEnableCustomAudioCodec')
    ) {
      delete audioConfig.audioCodec
    }
    if (!settings.shouldEnableCustomChannel) {
      delete audioConfig.audioChannelConfig
    }
    if (!settings.shouldEnableCustomBitrate) delete audioConfig.bitrate
  }
  for (const field of skippedFields ?? []) delete effective[field]
  if (effective.convertToExtension === '-' && sourceExtension) {
    effective.convertToExtension = getAudioFileOutputExtension(sourceExtension)
  }
  return withoutEmptyValues(effective)
}

/** Whether an audio file's settings were changed after its preset was applied */
export function isAudioPresetModified(
  config: VideoConfig,
  preset: AudioPreset,
  sourceExtension: string | null | undefined,
) {
  const skippedFields =
    config.presetId === preset.id ? config.presetSkippedFields : undefined
  return !isEqual(
    getEffectiveAudioSettings(
      pickAudioPresetSettings(config),
      skippedFields,
      sourceExtension,
    ),
    getEffectiveAudioSettings(preset.settings, skippedFields, sourceExtension),
  )
}

/** Settings to save to an audio preset (see `getVideoPresetSettingsToSave`) */
export function getAudioPresetSettingsToSave(
  config: VideoConfig,
  preset: AudioPreset,
): AudioPresetSettings {
  const settings = pickAudioPresetSettings(config) as Record<
    AudioPresetKey,
    unknown
  >
  for (const field of config.presetId === preset.id
    ? (config.presetSkippedFields ?? [])
    : []) {
    const key = field as AudioPresetKey
    settings[key] = cloneDeep(preset.settings[key])
    if (key === 'shouldEnableCustomAudioCodec') {
      ;(settings.audioConfig as AudioPresetSettings['audioConfig']).audioCodec =
        preset.settings.audioConfig?.audioCodec
    }
  }
  return settings as AudioPresetSettings
}

/** Whether a video's settings were changed after its preset was applied */
export function isVideoPresetModified(
  config: VideoConfig,
  preset: VideoPreset,
  sourceExtension: string | null | undefined,
  resolution: number | null,
) {
  const skippedFields =
    config.presetId === preset.id ? config.presetSkippedFields : undefined
  return !isEqual(
    getEffectiveVideoSettings(
      pickVideoPresetSettings(config, resolution),
      skippedFields,
      sourceExtension,
    ),
    getEffectiveVideoSettings(preset.settings, skippedFields, sourceExtension),
  )
}

/** Whether an image's settings were changed after its preset was applied */
export function isImagePresetModified(
  config: ImageConfig,
  preset: ImagePreset,
  sourceExtension: string | null | undefined,
  resolution: number | null,
) {
  const skippedFields =
    config.presetId === preset.id ? config.presetSkippedFields : undefined
  return !isEqual(
    getEffectiveImageSettings(
      pickImagePresetSettings(config, resolution),
      skippedFields,
      sourceExtension,
    ),
    getEffectiveImageSettings(preset.settings, skippedFields, sourceExtension),
  )
}

/**
 * Settings to save to a preset from a config. Settings skipped for the media (e.g. the audio of a
 * video without audio) keep the preset's values, since they could not be seen or changed.
 */
export function getVideoPresetSettingsToSave(
  config: VideoConfig,
  preset: VideoPreset,
  resolution: number | null,
): VideoPresetSettings {
  const settings = pickVideoPresetSettings(config, resolution) as Record<
    VideoPresetKey,
    unknown
  >
  for (const field of config.presetId === preset.id
    ? (config.presetSkippedFields ?? [])
    : []) {
    const key = field as VideoPresetKey
    settings[key] = cloneDeep(preset.settings[key])
    // The audio codec is skipped with its switch
    if (key === 'shouldEnableCustomAudioCodec') {
      ;(settings.audioConfig as VideoPresetSettings['audioConfig']).audioCodec =
        preset.settings.audioConfig?.audioCodec
    }
  }
  return settings as VideoPresetSettings
}

export function getImagePresetSettingsToSave(
  config: ImageConfig,
  preset: ImagePreset,
  resolution: number | null,
): ImagePresetSettings {
  const settings = pickImagePresetSettings(config, resolution) as Record<
    ImagePresetKey,
    unknown
  >
  for (const field of config.presetId === preset.id
    ? (config.presetSkippedFields ?? [])
    : []) {
    const key = field as ImagePresetKey
    settings[key] = cloneDeep(preset.settings[key])
  }
  return settings as ImagePresetSettings
}

/** Whether a video has audio, read once & cached like the Audio tab does */
async function getHasAudio(mediaIndex: number) {
  const video = appProxy.state.media[mediaIndex]
  if (video?.type !== 'video' || !video.pathRaw) return null
  if (video.videoInfoRaw?.audioStreams) {
    return video.videoInfoRaw.audioStreams.length > 0
  }
  const streams = await getAudioStreams(video.pathRaw).catch(() => null)
  if (!streams) return null
  const targetVideo = appProxy.state.media[mediaIndex]
  if (targetVideo?.type === 'video') {
    targetVideo.videoInfoRaw = {
      ...(targetVideo.videoInfoRaw ?? {}),
      audioStreams: streams,
    }
  }
  return streams.length > 0
}

/** Whether any metadata value (title, artist, ...) was entered */
function hasMetadataValues(config: VideoConfig | ImageConfig) {
  if (config.shouldStripMetadata || !config.metadataConfig) return false
  return Object.entries(config.metadataConfig).some(
    ([key, value]) =>
      (typeof value === 'string' && value.length > 0) ||
      (key === 'shouldEnableCreationTime' && value === true),
  )
}

/**
 * Whether a media has changes that are not part of presets (crop, rotation, trim, subtitles, custom
 * thumbnail, audio tracks, metadata values), which reverting to its preset also undoes
 */
export function hasChangesOutsidePreset(config: VideoConfig | ImageConfig) {
  if (
    'shouldTransformImage' in config ||
    'isImageTransformEditMode' in config
  ) {
    const imageConfig = config as ImageConfig
    return !!(
      // Transforms set by the preset are part of it
      (
        (imageConfig.shouldTransformImage &&
          !imageConfig.transformImageConfig?.isFromPreset) ||
        imageConfig.isImageTransformEditMode ||
        hasMetadataValues(imageConfig)
      )
    )
  }
  const videoConfig = config as VideoConfig
  return !!(
    (videoConfig.shouldTransformVideo &&
      !videoConfig.transformVideoConfig?.isFromPreset) ||
    videoConfig.isVideoTransformEditMode ||
    videoConfig.shouldTrimVideo ||
    videoConfig.isVideoTrimEditMode ||
    videoConfig.shouldEnableCustomThumbnail ||
    videoConfig.shouldEnableAudioTrackSelection ||
    videoConfig.subtitlesConfig?.shouldEnableSubtitles ||
    videoConfig.subtitlesConfig?.preserveExistingSubtitles ||
    hasMetadataValues(videoConfig)
  )
}

/**
 * Deletes a preset. Media using it (and the batch settings) get the Standard preset's settings,
 * keeping their changes that are not part of presets (crop, trim, ...), as when choosing a preset.
 */
export async function deletePresetAndUnlinkMedia(id: string) {
  const preset = getStoredPreset(id)
  if (!preset) return
  const { mediaType } = preset
  deletePreset(id)

  const { media, commonConfigForBatchCompression, isCompressing } =
    appProxy.state
  // The settings of a compression in progress were already sent
  if (isCompressing) return
  const isBatch = media.length > 1
  const batchConfig =
    commonConfigForBatchCompression[getBatchConfigKey(mediaType)]
  if (isBatch && batchConfig.presetId === id) {
    // Media following the batch settings get them too
    await applyPreset(mediaType, STANDARD_PRESET_ID, -1)
  }
  for (let index = 0; index < appProxy.state.media.length; index++) {
    const mediaFile = appProxy.state.media[index]
    if (
      isMediaOfPresetType(mediaFile, mediaType) &&
      mediaFile.config.presetId === id &&
      (!isBatch || mediaFile.isConfigDirty)
    ) {
      await applyPreset(mediaType, STANDARD_PRESET_ID, index)
    }
  }
}

/**
 * Reverts a single media (`mediaIndex` >= 0), or the settings of all media of its type in a batch
 * (`mediaIndex` < 0), to its preset: the default settings with only the preset's settings applied.
 * Changes that are not part of presets (crop, rotation, trim, subtitles, ...) are undone too.
 */
export async function revertToPreset(
  mediaType: PresetMediaType,
  mediaIndex: number,
) {
  const isBatch = appProxy.state.media.length > 1
  if (mediaIndex >= 0) {
    const mediaFile = appProxy.state.media[mediaIndex]
    if (!isMediaOfPresetType(mediaFile, mediaType)) return
    const presetId = mediaFile.config.presetId
    if (mediaFile.type === 'video' && mediaType === 'audio') {
      mediaFile.config = applyAudioPresetToConfig(
        cloneDeep(audioFileConfigInitialState),
        getAudioPreset(presetId),
        { sourceExtension: mediaFile.extension },
        { isBatchConfig: false },
      )
    } else if (mediaFile.type === 'video') {
      const preset = getVideoPreset(presetId)
      const hasAudio =
        preset.id === STANDARD_PRESET_ID ? null : await getHasAudio(mediaIndex)
      const targetVideo = appProxy.state.media[mediaIndex]
      if (targetVideo?.type !== 'video') return
      targetVideo.config = applyVideoPresetToConfig(
        cloneDeep(videoConfigInitialState),
        preset,
        {
          sourceExtension: targetVideo.extension,
          hasAudio,
          dimensions: targetVideo.dimensions,
        },
        { isBatchConfig: false },
      )
    } else {
      mediaFile.config = applyImagePresetToConfig(
        cloneDeep(imageConfigInitialState),
        getImagePreset(presetId),
        {
          sourceExtension: mediaFile.extension,
          dimensions: mediaFile.dimensions,
        },
        { isBatchConfig: false },
      )
    }
    // The thumbnail shows the transformed media until then
    const targetMedia = appProxy.state.media[mediaIndex]
    if (targetMedia.thumbnailPathRaw) {
      targetMedia.thumbnailPath = core.convertFileSrc(
        targetMedia.thumbnailPathRaw,
      )
    }
    if (isBatch) {
      targetMedia.isConfigDirty = true
    }
  } else if (isBatch) {
    const batchConfig = appProxy.state.commonConfigForBatchCompression
    if (mediaType === 'audio') {
      batchConfig.audioFileConfig = applyAudioPresetToConfig(
        cloneDeep(audioFileConfigInitialState),
        getAudioPreset(batchConfig.audioFileConfig.presetId),
        { sourceExtension: null },
        { isBatchConfig: true },
      )
    } else if (mediaType === 'video') {
      batchConfig.videoConfig = applyVideoPresetToConfig(
        cloneDeep(videoConfigInitialState),
        getVideoPreset(batchConfig.videoConfig.presetId),
        { sourceExtension: null },
        { isBatchConfig: true },
      )
    } else {
      batchConfig.imageConfig = applyImagePresetToConfig(
        cloneDeep(imageConfigInitialState),
        getImagePreset(batchConfig.imageConfig.presetId),
        { sourceExtension: null },
        { isBatchConfig: true },
      )
    }
    normalizeBatchMediaConfig()
  }
}

/**
 * Applies a preset to a single media (`mediaIndex` >= 0) or to the settings of all media of its
 * type in a batch (`mediaIndex` < 0; media with customized settings keep them).
 */
export async function applyPreset(
  mediaType: PresetMediaType,
  presetId: string,
  mediaIndex: number,
) {
  const isBatch = appProxy.state.media.length > 1
  if (mediaIndex >= 0) {
    const mediaFile = appProxy.state.media[mediaIndex]
    if (!isMediaOfPresetType(mediaFile, mediaType)) return
    if (mediaFile.type === 'video' && mediaType === 'audio') {
      mediaFile.config = applyAudioPresetToConfig(
        mediaFile.config,
        getAudioPreset(presetId),
        { sourceExtension: mediaFile.extension },
        { isBatchConfig: false },
      )
    } else if (mediaFile.type === 'video') {
      const hasAudio =
        presetId === STANDARD_PRESET_ID ? null : await getHasAudio(mediaIndex)
      const targetVideo = appProxy.state.media[mediaIndex]
      if (targetVideo?.type !== 'video') return
      targetVideo.config = applyVideoPresetToConfig(
        targetVideo.config,
        getVideoPreset(presetId),
        {
          sourceExtension: targetVideo.extension,
          hasAudio,
          dimensions: targetVideo.dimensions,
        },
        { isBatchConfig: false },
      )
    } else {
      mediaFile.config = applyImagePresetToConfig(
        mediaFile.config,
        getImagePreset(presetId),
        {
          sourceExtension: mediaFile.extension,
          dimensions: mediaFile.dimensions,
        },
        { isBatchConfig: false },
      )
    }
    if (isBatch) {
      appProxy.state.media[mediaIndex].isConfigDirty = true
    }
  } else if (isBatch) {
    const batchConfig = appProxy.state.commonConfigForBatchCompression
    if (mediaType === 'audio') {
      batchConfig.audioFileConfig = applyAudioPresetToConfig(
        batchConfig.audioFileConfig,
        getAudioPreset(presetId),
        { sourceExtension: null },
        { isBatchConfig: true },
      )
    } else if (mediaType === 'video') {
      batchConfig.videoConfig = applyVideoPresetToConfig(
        batchConfig.videoConfig,
        getVideoPreset(presetId),
        { sourceExtension: null },
        { isBatchConfig: true },
      )
    } else {
      batchConfig.imageConfig = applyImagePresetToConfig(
        batchConfig.imageConfig,
        getImagePreset(presetId),
        { sourceExtension: null },
        { isBatchConfig: true },
      )
    }
    normalizeBatchMediaConfig()
  }
}

/**
 * Config for newly added media, from the default preset of its type. Whether a video has audio
 * is only checked for a preset other than Default (which has the default audio settings).
 */
export async function getInitialVideoConfig(
  config: VideoConfig,
  {
    sourceExtension,
    path,
    dimensions,
  }: {
    sourceExtension: string | null | undefined
    path: string
    dimensions: PresetTarget['dimensions']
  },
) {
  const preset = getVideoPreset(presetsStore.defaultPresetIds.video)
  let hasAudio: boolean | null = null
  let audioStreams: Awaited<ReturnType<typeof getAudioStreams>> | null = null
  if (preset.id !== STANDARD_PRESET_ID) {
    audioStreams = await getAudioStreams(path).catch(() => null)
    hasAudio = audioStreams ? audioStreams.length > 0 : null
  }
  return {
    config: applyVideoPresetToConfig(
      config,
      preset,
      { sourceExtension, hasAudio, dimensions },
      { isBatchConfig: false },
    ),
    audioStreams,
  }
}

export function getInitialImageConfig(
  config: ImageConfig,
  {
    sourceExtension,
    dimensions,
  }: {
    sourceExtension: string | null | undefined
    dimensions: PresetTarget['dimensions']
  },
) {
  return applyImagePresetToConfig(
    config,
    getImagePreset(presetsStore.defaultPresetIds.image),
    { sourceExtension, dimensions },
    { isBatchConfig: false },
  )
}

/** Applies the default presets to the batch settings, before the first media is added */
export function applyDefaultPresetsToBatchConfig() {
  const batchConfig = appProxy.state.commonConfigForBatchCompression
  batchConfig.videoConfig = applyVideoPresetToConfig(
    batchConfig.videoConfig,
    getVideoPreset(presetsStore.defaultPresetIds.video),
    { sourceExtension: null },
    { isBatchConfig: true },
  )
  batchConfig.imageConfig = applyImagePresetToConfig(
    batchConfig.imageConfig,
    getImagePreset(presetsStore.defaultPresetIds.image),
    { sourceExtension: null },
    { isBatchConfig: true },
  )
  batchConfig.audioFileConfig = applyAudioPresetToConfig(
    batchConfig.audioFileConfig,
    getAudioPreset(presetsStore.defaultPresetIds.audio),
    { sourceExtension: null },
    { isBatchConfig: true },
  )
}

/** Config for a newly added audio file, from the default audio preset */
export function getInitialAudioFileConfig(
  config: VideoConfig,
  { sourceExtension }: { sourceExtension: string | null | undefined },
) {
  return applyAudioPresetToConfig(
    config,
    getAudioPreset(presetsStore.defaultPresetIds.audio),
    { sourceExtension },
    { isBatchConfig: false },
  )
}

function formatExtension(extension: string | undefined) {
  return !extension || extension === '-'
    ? t('common.sameFormatAsInput')
    : extension.toUpperCase()
}

function describeTransform(transform: PortableTransform | null | undefined) {
  if (!transform) return []
  const lines: string[] = []
  const rotate = normalizeRotation(transform.rotate)
  if (rotate) lines.push(t('presets.summary.rotated', { degrees: rotate }))
  if (transform.flip?.horizontal || transform.flip?.vertical) {
    lines.push(t('presets.summary.flipped'))
  }
  if (transform.aspectRatio)
    lines.push(
      t('presets.summary.cropped', { aspectRatio: transform.aspectRatio }),
    )
  return lines
}

/** Short summary of what a video preset changes, e.g. `["MP4", "Quality 70%", ...]` */
export function describeVideoPresetSettings(settings: VideoPresetSettings) {
  const lines = [formatExtension(settings.convertToExtension)]
  const isAudioOutput = isAudioExtension(settings.convertToExtension)
  if (!isAudioOutput) {
    lines.push(
      settings.shouldUseTargetSize && settings.targetSizeInMB
        ? t('presets.summary.targetSize', {
            size: formatSizeInMB(settings.targetSizeInMB),
          })
        : settings.shouldDisableCompression
          ? t('common.lossless')
          : t('presets.summary.quality', { value: settings.quality ?? 0 }),
    )
    if (settings.shouldEnableCustomVideoCodec && settings.customVideoCodec) {
      lines.push(
        VIDEO_CODECS.find((c) => c.value === settings.customVideoCodec)?.name ??
          settings.customVideoCodec,
      )
    }
    if (settings.resolution) {
      lines.push(t('presets.summary.resolution', { size: settings.resolution }))
    }
    lines.push(...describeTransform(settings.transform))
    if (settings.shouldEnableCustomFPS && settings.customFPS) {
      lines.push(t('presets.summary.fps', { fps: settings.customFPS }))
    }
  }
  if (settings.shouldEnableCustomSpeed && settings.customSpeed) {
    lines.push(t('presets.summary.speed', { speed: settings.customSpeed }))
  }
  const { volume, audioCodec, audioChannelConfig, bitrate } =
    settings.audioConfig ?? {}
  if (volume === 0) {
    lines.push(t('presets.summary.audioRemoved'))
  } else {
    if (volume != null && volume !== 100)
      lines.push(t('presets.summary.volume', { value: volume }))
    if (
      settings.shouldEnableCustomAudioCodec &&
      audioCodec &&
      audioCodec !== '-'
    ) {
      lines.push(
        t('presets.summary.audioCodec', {
          codec:
            AUDIO_CODECS.find((c) => c.value === audioCodec)?.name ??
            audioCodec,
        }),
      )
    }
    if (
      settings.shouldEnableCustomChannel &&
      audioChannelConfig?.channelLayout
    ) {
      lines.push(
        audioChannelConfig.channelLayout === 'mono'
          ? t('common.mono')
          : t('common.stereo'),
      )
    }
    if (settings.shouldEnableCustomBitrate && bitrate) {
      lines.push(t('common.kbps', { value: bitrate }))
    }
  }
  lines.push(
    settings.shouldStripMetadata
      ? t('presets.summary.metadataRemoved')
      : t('presets.summary.metadataKept'),
  )
  return lines
}

/** Short summary of what an image preset changes */
export function describeImagePresetSettings(settings: ImagePresetSettings) {
  const lines = [formatExtension(settings.convertToExtension)]
  lines.push(
    settings.shouldUseTargetSize &&
      settings.targetSizeInKB &&
      supportsImageTargetSize(null, settings.convertToExtension)
      ? t('presets.summary.targetSizeImage', {
          size: formatImageTargetSize(settings.targetSizeInKB),
        })
      : settings.isLossless
        ? t('common.lossless')
        : t('presets.summary.quality', { value: settings.quality }),
  )
  if (settings.resolution) {
    lines.push(t('presets.summary.resolution', { size: settings.resolution }))
  }
  lines.push(...describeTransform(settings.transform))
  if (settings.svgScaleFactor && settings.svgScaleFactor !== 1) {
    lines.push(
      t('presets.summary.svgScale', { scale: settings.svgScaleFactor }),
    )
  }
  if (settings.shouldEnableAdvancedSvgSetting) {
    lines.push(t('presets.summary.customSvg'))
  }
  lines.push(
    settings.shouldStripMetadata
      ? t('presets.summary.metadataRemoved')
      : t('presets.summary.metadataKept'),
  )
  return lines
}

/** Short summary of what an audio preset changes */
export function describeAudioPresetSettings(settings: AudioPresetSettings) {
  const lines = [formatExtension(settings.convertToExtension)]
  const { volume, audioCodec, audioChannelConfig, bitrate } =
    settings.audioConfig ?? {}
  lines.push(
    settings.shouldEnableCustomBitrate && bitrate
      ? t('common.kbps', { value: bitrate })
      : t('presets.summary.quality', { value: settings.quality ?? 0 }),
  )
  if (settings.shouldEnableCustomSpeed && settings.customSpeed) {
    lines.push(t('presets.summary.speed', { speed: settings.customSpeed }))
  }
  if (volume != null && volume !== 100)
    lines.push(t('presets.summary.volume', { value: volume }))
  if (
    settings.shouldEnableCustomAudioCodec &&
    audioCodec &&
    audioCodec !== '-'
  ) {
    lines.push(
      AUDIO_CODECS.find((c) => c.value === audioCodec)?.name ?? audioCodec,
    )
  }
  if (settings.shouldEnableCustomChannel && audioChannelConfig?.channelLayout) {
    lines.push(
      audioChannelConfig.channelLayout === 'mono'
        ? t('common.mono')
        : t('common.stereo'),
    )
  }
  lines.push(
    settings.shouldStripMetadata
      ? t('presets.summary.metadataRemoved')
      : t('presets.summary.metadataKept'),
  )
  return lines
}
