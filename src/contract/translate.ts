import type {
  AudioConfig,
  ImageConfig,
  MediaMetadataConfig,
  VideoConfig,
} from '@/types/app'
import {
  type AudioChannelConfig,
  type BatchResolution,
  getBatchResolutionLongerSide,
  type PortableTransform,
} from '@/types/compression'
import type {
  AudioPresetKey,
  AudioPresetSettings,
  ImagePresetKey,
  ImagePresetSettings,
  Preset,
  PresetOutput,
  VideoPresetKey,
  VideoPresetSettings,
} from '@/types/preset'
import {
  getLegacyPrefixFromTemplate,
  migratePrefixToTemplate,
} from '@/utils/fileNameTemplate'
import { KB_PER_MB } from '@/utils/imageTargetSize'
import {
  AUDIO_CODEC_TO_INTERNAL,
  CONTRACT_LIMITS,
  INTERNAL_TO_AUDIO_CODEC,
  INTERNAL_TO_VIDEO_CODEC,
  METADATA_TAG_KEYS,
  VIDEO_CODEC_TO_INTERNAL,
} from './spec'
import {
  type AudioBitrateKbps,
  type AudioChannelMode,
  type AudioContract,
  type AudioOutputFormat,
  type AudioPresetContract,
  type AudioSettings,
  CONTRACT_VERSION,
  type Hdr,
  type ImageContract,
  type ImageOutputFormat,
  type MediaContract,
  type MetadataSettings,
  type MetadataTags,
  type OutputSettings,
  type PresetContract,
  type Resolution,
  type ResolutionPreset,
  type SubtitlesSettings,
  type Transform,
  type VideoContract,
  type VideoOutputFormat,
  type VideoPresetContract,
} from './types'

/**
 * Compile-time exhaustiveness guard: if a field is added to `src/types/preset.ts`, `tsc` fails
 * here until the contract translator handles it.
 */
const _VIDEO_PRESET_KEY_COVERAGE = {
  convertToExtension: true,
  shouldDisableCompression: true,
  quality: true,
  shouldUseTargetSize: true,
  targetSizeInMB: true,
  shouldEnableCustomVideoCodec: true,
  customVideoCodec: true,
  shouldEnableCustomFPS: true,
  customFPS: true,
  shouldEnableCustomSpeed: true,
  customSpeed: true,
  shouldStripMetadata: true,
  shouldEnableCustomAudioCodec: true,
  shouldEnableCustomChannel: true,
  shouldEnableCustomBitrate: true,
  audioConfig: true,
  dynamicRange: true,
  shouldEnableClips: true,
  clipsMode: true,
  clipLengthInSeconds: true,
  clipCount: true,
  resolution: true,
  transform: true,
} as const satisfies Record<VideoPresetKey, true>

const _IMAGE_PRESET_KEY_COVERAGE = {
  dynamicRange: true,
  convertToExtension: true,
  isLossless: true,
  quality: true,
  shouldUseTargetSize: true,
  targetSizeInKB: true,
  shouldStripMetadata: true,
  svgScaleFactor: true,
  shouldEnableAdvancedSvgSetting: true,
  svgConfig: true,
  resolution: true,
  transform: true,
} as const satisfies Record<ImagePresetKey, true>

const _AUDIO_PRESET_KEY_COVERAGE = {
  shouldUseTargetSize: true,
  targetSizeInMB: true,
  convertToExtension: true,
  quality: true,
  shouldEnableCustomSpeed: true,
  customSpeed: true,
  shouldStripMetadata: true,
  shouldEnableCustomAudioCodec: true,
  shouldEnableCustomChannel: true,
  shouldEnableCustomBitrate: true,
  audioConfig: true,
} as const satisfies Record<AudioPresetKey, true>

void _VIDEO_PRESET_KEY_COVERAGE
void _IMAGE_PRESET_KEY_COVERAGE
void _AUDIO_PRESET_KEY_COVERAGE

const LONGER_SIDE_TO_PRESET: Record<number, ResolutionPreset> = {
  854: '480p',
  1280: '720p',
  1920: '1080p',
  2560: '2k',
  3840: '4k',
}

export function resolutionToContract(
  longerSide: number | null | undefined,
): Resolution {
  if (!longerSide || longerSide <= 0) return null
  return LONGER_SIDE_TO_PRESET[longerSide] ?? longerSide
}

export function contractToResolution(resolution: Resolution): number | null {
  if (resolution === null) return null
  if (typeof resolution === 'number') return resolution
  return getBatchResolutionLongerSide(resolution as BatchResolution)
}

export function transformToContract(
  transform: PortableTransform | null | undefined,
): Transform {
  if (!transform) return null
  const rotate = (((transform.rotate % 360) + 360) % 360) as 0 | 90 | 180 | 270
  const flipHorizontal = !!transform.flip?.horizontal
  const flipVertical = !!transform.flip?.vertical
  const crop = transform.aspectRatio ?? null
  if (rotate === 0 && !flipHorizontal && !flipVertical && crop === null) {
    return null
  }
  return { rotate, flipHorizontal, flipVertical, crop }
}

export function contractToTransform(
  transform: Transform,
): PortableTransform | null {
  if (!transform) return null
  if (
    transform.rotate === 0 &&
    !transform.flipHorizontal &&
    !transform.flipVertical &&
    transform.crop === null
  ) {
    return null
  }
  return {
    rotate: transform.rotate,
    flip: {
      horizontal: transform.flipHorizontal,
      vertical: transform.flipVertical,
    },
    aspectRatio: transform.crop,
  }
}

export function hdrToContract(
  dynamicRange:
    | { mode: 'original' | 'boost' | 'sdr'; intensity: number }
    | undefined,
): Hdr {
  if (!dynamicRange || dynamicRange.mode === 'original') return null
  if (dynamicRange.mode === 'sdr') return { mode: 'remove' }
  return { mode: 'boost', intensity: dynamicRange.intensity }
}

export function contractToHdr(hdr: Hdr): {
  mode: 'original' | 'boost' | 'sdr'
  intensity: number
} {
  if (!hdr) return { mode: 'original', intensity: 2 }
  if (hdr.mode === 'remove') return { mode: 'sdr', intensity: 2 }
  return { mode: 'boost', intensity: hdr.intensity }
}

function channelsToContract(
  enabled: boolean | undefined,
  channelConfig: AudioChannelConfig | null | undefined,
): AudioChannelMode {
  if (!enabled || !channelConfig?.channelLayout) return null
  if (channelConfig.channelLayout === 'mono') {
    const left = channelConfig.monoSource?.left ?? true
    const right = channelConfig.monoSource?.right ?? true
    const source = left && !right ? 'left' : !left && right ? 'right' : 'mix'
    return { layout: 'mono', source }
  }
  return {
    layout: 'stereo',
    swapChannels: !!channelConfig.stereoSwapChannels,
  }
}

function contractToChannels(channels: AudioChannelMode): {
  shouldEnableCustomChannel: boolean
  audioChannelConfig: AudioChannelConfig | null
} {
  if (!channels) {
    return { shouldEnableCustomChannel: false, audioChannelConfig: null }
  }
  if (channels.layout === 'mono') {
    const monoSource =
      channels.source === 'left'
        ? { left: true, right: false }
        : channels.source === 'right'
          ? { left: false, right: true }
          : { left: true, right: true }
    return {
      shouldEnableCustomChannel: true,
      audioChannelConfig: { channelLayout: 'mono', monoSource },
    }
  }
  return {
    shouldEnableCustomChannel: true,
    audioChannelConfig: {
      channelLayout: 'stereo',
      stereoSwapChannels: channels.swapChannels,
    },
  }
}

function audioSettingsToContract(
  audioConfig:
    | Pick<
        AudioConfig,
        'volume' | 'audioCodec' | 'audioChannelConfig' | 'bitrate'
      >
    | undefined,
  flags: {
    shouldEnableCustomAudioCodec?: boolean
    shouldEnableCustomChannel?: boolean
    shouldEnableCustomBitrate?: boolean
  },
): AudioSettings {
  const internalCodec = flags.shouldEnableCustomAudioCodec
    ? audioConfig?.audioCodec
    : null
  const codec =
    internalCodec && internalCodec !== '-'
      ? (INTERNAL_TO_AUDIO_CODEC[internalCodec] ?? null)
      : null

  const rawBitrate = flags.shouldEnableCustomBitrate
    ? audioConfig?.bitrate
    : null
  const bitrateKbps =
    rawBitrate && [64, 96, 128, 160, 192, 256, 320].includes(rawBitrate)
      ? (rawBitrate as AudioBitrateKbps)
      : null

  return {
    volumePercent: audioConfig?.volume ?? 100,
    codec,
    channels: channelsToContract(
      flags.shouldEnableCustomChannel,
      audioConfig?.audioChannelConfig,
    ),
    bitrateKbps,
  }
}

function contractToAudioFields(audio: AudioSettings) {
  const { shouldEnableCustomChannel, audioChannelConfig } = contractToChannels(
    audio.channels,
  )
  return {
    shouldEnableCustomAudioCodec: audio.codec !== null,
    shouldEnableCustomChannel,
    shouldEnableCustomBitrate: audio.bitrateKbps !== null,
    audioConfig: {
      volume: audio.volumePercent,
      audioCodec: audio.codec ? AUDIO_CODEC_TO_INTERNAL[audio.codec] : '-',
      audioChannelConfig,
      bitrate: audio.bitrateKbps,
    },
  }
}

export function presetOutputToContractOutput(
  output: PresetOutput | null | undefined,
): OutputSettings | null {
  if (!output) return null
  const saveTo =
    output.saveLocation === 'fixedFolder' ? 'folder' : output.saveLocation
  const fileNameTemplate =
    typeof output.fileNameTemplate === 'string'
      ? output.fileNameTemplate
      : migratePrefixToTemplate(output.filePrefix)
  return {
    saveTo,
    folder: saveTo === 'folder' ? (output.saveFolder ?? null) : null,
    fileNameTemplate,
  }
}

export function contractOutputToPresetOutput(
  output: OutputSettings | null | undefined,
): PresetOutput | null {
  if (!output) return null
  const saveLocation =
    output.saveTo === 'folder' ? 'fixedFolder' : output.saveTo
  const fileNameTemplate = output.fileNameTemplate ?? ''
  return {
    saveLocation,
    saveFolder: saveLocation === 'fixedFolder' ? (output.folder ?? null) : null,
    fileNameTemplate,
    filePrefix: getLegacyPrefixFromTemplate(fileNameTemplate),
  }
}

export function contractToVideoPresetSettings(
  contract: VideoPresetContract | VideoContract,
): VideoPresetSettings {
  const { settings } = contract
  const audio = contractToAudioFields(settings.audio)
  return {
    convertToExtension:
      (settings.format as VideoPresetSettings['convertToExtension']) ?? '-',
    shouldDisableCompression: settings.compression.mode === 'none',
    quality:
      settings.compression.mode === 'quality'
        ? settings.compression.quality
        : 50,
    shouldUseTargetSize: settings.compression.mode === 'targetSize',
    targetSizeInMB:
      settings.compression.mode === 'targetSize'
        ? settings.compression.targetSizeMB
        : CONTRACT_LIMITS.videoTargetSizeMB.default,
    shouldEnableCustomVideoCodec: settings.video.codec !== null,
    customVideoCodec: settings.video.codec
      ? VIDEO_CODEC_TO_INTERNAL[settings.video.codec]
      : undefined,
    shouldEnableCustomFPS: settings.video.fps !== null,
    customFPS: settings.video.fps ?? undefined,
    shouldEnableCustomSpeed: settings.speed !== null,
    customSpeed: settings.speed ?? undefined,
    shouldStripMetadata: settings.metadata.mode === 'strip',
    ...audio,
    dynamicRange: contractToHdr(settings.video.hdr),
    shouldEnableClips: settings.clips !== null,
    clipsMode: settings.clips?.mode === 'duration' ? 'time' : 'count',
    clipLengthInSeconds:
      settings.clips?.mode === 'duration' ? settings.clips.seconds : 60,
    clipCount: settings.clips?.mode === 'count' ? settings.clips.count : 2,
    resolution: contractToResolution(settings.video.resolution),
    transform: contractToTransform(settings.video.transform),
  }
}

export function videoPresetSettingsToContract(
  settings: VideoPresetSettings,
  meta: { name?: string; output?: PresetOutput | null } = {},
): VideoPresetContract {
  const compression: VideoPresetContract['settings']['compression'] =
    settings.shouldUseTargetSize
      ? {
          mode: 'targetSize',
          targetSizeMB:
            settings.targetSizeInMB ??
            CONTRACT_LIMITS.videoTargetSizeMB.default,
        }
      : settings.shouldDisableCompression
        ? { mode: 'none' }
        : { mode: 'quality', quality: settings.quality ?? 50 }

  const clips: VideoPresetContract['settings']['clips'] =
    !settings.shouldEnableClips
      ? null
      : settings.clipsMode === 'time'
        ? { mode: 'duration', seconds: settings.clipLengthInSeconds ?? 60 }
        : { mode: 'count', count: settings.clipCount ?? 2 }

  const codec =
    settings.shouldEnableCustomVideoCodec && settings.customVideoCodec
      ? (INTERNAL_TO_VIDEO_CODEC[settings.customVideoCodec] ?? null)
      : null

  return {
    version: CONTRACT_VERSION,
    mediaType: 'video',
    ...(meta.name ? { name: meta.name } : {}),
    settings: {
      format:
        settings.convertToExtension === '-'
          ? null
          : (settings.convertToExtension as VideoOutputFormat),
      compression,
      speed:
        settings.shouldEnableCustomSpeed && settings.customSpeed != null
          ? settings.customSpeed
          : null,
      metadata: {
        mode: settings.shouldStripMetadata === false ? 'keep' : 'strip',
      },
      video: {
        codec,
        resolution: resolutionToContract(settings.resolution),
        fps:
          settings.shouldEnableCustomFPS && settings.customFPS != null
            ? settings.customFPS
            : null,
        transform: transformToContract(settings.transform),
        hdr: hdrToContract(settings.dynamicRange),
      },
      audio: audioSettingsToContract(settings.audioConfig, settings),
      clips,
    },
    output: presetOutputToContractOutput(meta.output),
  }
}

export function contractToImagePresetSettings(
  contract: ImageContract,
): ImagePresetSettings {
  const { settings } = contract
  const tDefaults = CONTRACT_LIMITS.svgTracing
  const tracing = settings.svg.tracing
  return {
    dynamicRange: contractToHdr(settings.image.hdr),
    convertToExtension:
      (settings.format as ImagePresetSettings['convertToExtension']) ?? '-',
    isLossless: settings.compression.mode === 'lossless',
    quality:
      settings.compression.mode === 'quality'
        ? settings.compression.quality
        : 50,
    shouldUseTargetSize: settings.compression.mode === 'targetSize',
    targetSizeInKB:
      settings.compression.mode === 'targetSize'
        ? Math.round(settings.compression.targetSizeMB * KB_PER_MB)
        : 500,
    shouldStripMetadata: settings.stripMetadata,
    svgScaleFactor: settings.svg.scale,
    shouldEnableAdvancedSvgSetting: tracing !== null,
    svgConfig: tracing
      ? {
          filterSpeckle: tracing.filterSpeckle,
          colorPrecision: tracing.colorPrecision,
          layerDifference: tracing.layerDifference,
          cornerThreshold: tracing.cornerThreshold,
          lengthThreshold: tracing.lengthThreshold,
          spliceThreshold: tracing.spliceThreshold,
          isBw: tracing.blackAndWhite,
        }
      : {
          filterSpeckle: tDefaults.filterSpeckle.default,
          colorPrecision: tDefaults.colorPrecision.default,
          layerDifference: tDefaults.layerDifference.default,
          cornerThreshold: tDefaults.cornerThreshold.default,
          lengthThreshold: tDefaults.lengthThreshold.default,
          spliceThreshold: tDefaults.spliceThreshold.default,
          isBw: false,
        },
    resolution: contractToResolution(settings.image.resolution),
    transform: contractToTransform(settings.image.transform),
  }
}

export function imagePresetSettingsToContract(
  settings: ImagePresetSettings,
  meta: { name?: string; output?: PresetOutput | null } = {},
): ImageContract {
  const compression: ImageContract['settings']['compression'] =
    settings.shouldUseTargetSize
      ? {
          mode: 'targetSize',
          targetSizeMB: (settings.targetSizeInKB ?? 500) / KB_PER_MB,
        }
      : settings.isLossless
        ? { mode: 'lossless' }
        : { mode: 'quality', quality: settings.quality ?? 50 }

  const tDefaults = CONTRACT_LIMITS.svgTracing
  const svgConfig = settings.svgConfig
  const tracing =
    settings.shouldEnableAdvancedSvgSetting && svgConfig
      ? {
          filterSpeckle:
            svgConfig.filterSpeckle ?? tDefaults.filterSpeckle.default,
          colorPrecision:
            svgConfig.colorPrecision ?? tDefaults.colorPrecision.default,
          layerDifference:
            svgConfig.layerDifference ?? tDefaults.layerDifference.default,
          cornerThreshold:
            svgConfig.cornerThreshold ?? tDefaults.cornerThreshold.default,
          lengthThreshold:
            svgConfig.lengthThreshold ?? tDefaults.lengthThreshold.default,
          spliceThreshold:
            svgConfig.spliceThreshold ?? tDefaults.spliceThreshold.default,
          blackAndWhite: !!svgConfig.isBw,
        }
      : null

  return {
    version: CONTRACT_VERSION,
    mediaType: 'image',
    ...(meta.name ? { name: meta.name } : {}),
    settings: {
      format:
        settings.convertToExtension === '-'
          ? null
          : (settings.convertToExtension as ImageOutputFormat),
      compression,
      stripMetadata: settings.shouldStripMetadata,
      image: {
        resolution: resolutionToContract(settings.resolution),
        transform: transformToContract(settings.transform),
        hdr: hdrToContract(settings.dynamicRange),
      },
      svg: {
        scale: settings.svgScaleFactor ?? 1,
        tracing,
      },
    },
    output: presetOutputToContractOutput(meta.output),
  }
}

export function contractToAudioPresetSettings(
  contract: AudioPresetContract | AudioContract,
): AudioPresetSettings {
  const { settings } = contract
  const audio = contractToAudioFields(settings.audio)
  return {
    shouldUseTargetSize: settings.compression.mode === 'targetSize',
    targetSizeInMB:
      settings.compression.mode === 'targetSize'
        ? settings.compression.targetSizeMB
        : CONTRACT_LIMITS.audioTargetSizeMB.default,
    convertToExtension:
      (settings.format as AudioPresetSettings['convertToExtension']) ?? '-',
    quality:
      settings.compression.mode === 'quality'
        ? settings.compression.quality
        : 50,
    shouldEnableCustomSpeed: settings.speed !== null,
    customSpeed: settings.speed ?? undefined,
    shouldStripMetadata: settings.metadata.mode === 'strip',
    ...audio,
  }
}

export function audioPresetSettingsToContract(
  settings: AudioPresetSettings,
  meta: { name?: string; output?: PresetOutput | null } = {},
): AudioPresetContract {
  const compression: AudioPresetContract['settings']['compression'] =
    settings.shouldUseTargetSize
      ? {
          mode: 'targetSize',
          targetSizeMB:
            settings.targetSizeInMB ??
            CONTRACT_LIMITS.audioTargetSizeMB.default,
        }
      : { mode: 'quality', quality: settings.quality ?? 50 }

  return {
    version: CONTRACT_VERSION,
    mediaType: 'audio',
    ...(meta.name ? { name: meta.name } : {}),
    settings: {
      format:
        settings.convertToExtension === '-'
          ? null
          : (settings.convertToExtension as AudioOutputFormat),
      compression,
      speed:
        settings.shouldEnableCustomSpeed && settings.customSpeed != null
          ? settings.customSpeed
          : null,
      metadata: {
        mode: settings.shouldStripMetadata === false ? 'keep' : 'strip',
      },
      audio: audioSettingsToContract(settings.audioConfig, settings),
    },
    output: presetOutputToContractOutput(meta.output),
  }
}

export function presetToContract(preset: Preset): PresetContract {
  const meta = { name: preset.name, output: preset.output ?? null }
  switch (preset.mediaType) {
    case 'video':
      return videoPresetSettingsToContract(preset.settings, meta)
    case 'image':
      return imagePresetSettingsToContract(preset.settings, meta)
    case 'audio':
      return audioPresetSettingsToContract(preset.settings, meta)
  }
}

export function contractToPreset(
  id: string,
  contract: PresetContract | MediaContract,
): Preset {
  const name = contract.name?.trim() || 'Preset'
  const output = contractOutputToPresetOutput(contract.output)
  switch (contract.mediaType) {
    case 'video':
      return {
        id,
        name,
        mediaType: 'video',
        settings: contractToVideoPresetSettings(contract),
        output,
      }
    case 'image':
      return {
        id,
        name,
        mediaType: 'image',
        settings: contractToImagePresetSettings(contract),
        output,
      }
    case 'audio':
      return {
        id,
        name,
        mediaType: 'audio',
        settings: contractToAudioPresetSettings(contract),
        output,
      }
  }
}

function metadataConfigToTags(
  metadataConfig: MediaMetadataConfig | null | undefined,
): MetadataTags | null {
  if (!metadataConfig) return null
  const tags: MetadataTags = {}
  let hasAny = false
  for (const key of METADATA_TAG_KEYS) {
    const raw =
      key === 'creationTime' &&
      metadataConfig.shouldEnableCreationTime === false
        ? null
        : metadataConfig[key]
    if (typeof raw === 'string' && raw.trim().length > 0) {
      tags[key] = raw.trim()
      hasAny = true
    }
  }
  return hasAny ? tags : null
}

/**
 * Converts a live UI `VideoConfig` (single file or batch) into a `VideoContract` or `AudioContract`.
 * When `includeOneShot` is true, non-preset fields (`metadata.set`, `subtitles`, `thumbnail`) are
 * included if enabled.
 */
export function videoConfigToContract(
  config: VideoConfig,
  options: {
    mediaType: 'video' | 'audio'
    resolution: number | null
    transform?: PortableTransform | null
    name?: string
    output?: PresetOutput | null
    includeOneShot?: boolean
  },
): VideoContract | AudioContract {
  const meta = { name: options.name, output: options.output ?? null }
  const includeOneShot = options.includeOneShot ?? true
  const metadataTags =
    includeOneShot && !config.shouldStripMetadata
      ? metadataConfigToTags(config.metadataConfig)
      : null

  if (options.mediaType === 'audio') {
    const base = audioPresetSettingsToContract(
      {
        shouldUseTargetSize: config.shouldUseTargetSize,
        targetSizeInMB: config.targetSizeInMB,
        convertToExtension: config.convertToExtension,
        quality: config.quality,
        shouldEnableCustomSpeed: config.shouldEnableCustomSpeed,
        customSpeed: config.customSpeed,
        shouldStripMetadata: config.shouldStripMetadata,
        shouldEnableCustomAudioCodec: config.shouldEnableCustomAudioCodec,
        shouldEnableCustomChannel: config.shouldEnableCustomChannel,
        shouldEnableCustomBitrate: config.shouldEnableCustomBitrate,
        audioConfig: {
          volume: config.audioConfig?.volume ?? 100,
          audioCodec: config.audioConfig?.audioCodec,
          audioChannelConfig: config.audioConfig?.audioChannelConfig,
          bitrate: config.audioConfig?.bitrate,
        },
      },
      meta,
    )
    const metadata: MetadataSettings =
      base.settings.metadata.mode === 'keep' && metadataTags
        ? { mode: 'keep', set: metadataTags }
        : base.settings.metadata
    return {
      ...base,
      settings: {
        ...base.settings,
        metadata,
      },
    }
  }

  const base = videoPresetSettingsToContract(
    {
      convertToExtension: config.convertToExtension,
      shouldDisableCompression: config.shouldDisableCompression,
      quality: config.quality,
      shouldUseTargetSize: config.shouldUseTargetSize,
      targetSizeInMB: config.targetSizeInMB,
      shouldEnableCustomVideoCodec: config.shouldEnableCustomVideoCodec,
      customVideoCodec: config.customVideoCodec,
      shouldEnableCustomFPS: config.shouldEnableCustomFPS,
      customFPS: config.customFPS,
      shouldEnableCustomSpeed: config.shouldEnableCustomSpeed,
      customSpeed: config.customSpeed,
      shouldStripMetadata: config.shouldStripMetadata,
      shouldEnableCustomAudioCodec: config.shouldEnableCustomAudioCodec,
      shouldEnableCustomChannel: config.shouldEnableCustomChannel,
      shouldEnableCustomBitrate: config.shouldEnableCustomBitrate,
      audioConfig: {
        volume: config.audioConfig?.volume ?? 100,
        audioCodec: config.audioConfig?.audioCodec,
        audioChannelConfig: config.audioConfig?.audioChannelConfig,
        bitrate: config.audioConfig?.bitrate,
      },
      dynamicRange: config.dynamicRange,
      shouldEnableClips: config.shouldEnableClips,
      clipsMode: config.clipsMode,
      clipLengthInSeconds: config.clipLengthInSeconds,
      clipCount: config.clipCount,
      resolution: options.resolution,
      transform: options.transform ?? null,
    },
    meta,
  )

  const metadata: MetadataSettings =
    base.settings.metadata.mode === 'keep' && metadataTags
      ? { mode: 'keep', set: metadataTags }
      : base.settings.metadata

  const thumbnail =
    includeOneShot &&
    config.shouldEnableCustomThumbnail &&
    config.customThumbnailPath?.trim()
      ? config.customThumbnailPath.trim()
      : null

  let subtitles: SubtitlesSettings | null = null
  if (includeOneShot && config.subtitlesConfig) {
    const preserveExisting = !!config.subtitlesConfig.preserveExistingSubtitles
    const tracks = config.subtitlesConfig.shouldEnableSubtitles
      ? config.subtitlesConfig.subtitles
          .filter((s) => !!s.subtitlePath?.trim())
          .map((s) => ({
            path: s.subtitlePath!.trim(),
            language: s.language || 'und',
            title: s.title?.trim() || null,
          }))
      : []
    if (preserveExisting || tracks.length > 0) {
      subtitles = { preserveExisting, tracks }
    }
  }

  return {
    ...base,
    settings: {
      ...base.settings,
      metadata,
      video: {
        ...base.settings.video,
        ...(includeOneShot ? { thumbnail } : {}),
      },
      ...(includeOneShot ? { subtitles } : {}),
    },
  }
}

export function imageConfigToContract(
  config: ImageConfig,
  options: {
    resolution: number | null
    transform?: PortableTransform | null
    name?: string
    output?: PresetOutput | null
  },
): ImageContract {
  return imagePresetSettingsToContract(
    {
      dynamicRange: config.dynamicRange,
      convertToExtension: config.convertToExtension,
      isLossless: config.isLossless,
      quality: config.quality,
      shouldUseTargetSize: config.shouldUseTargetSize,
      targetSizeInKB: config.targetSizeInKB,
      shouldStripMetadata: config.shouldStripMetadata,
      svgScaleFactor: config.svgScaleFactor,
      shouldEnableAdvancedSvgSetting: config.shouldEnableAdvancedSvgSetting,
      svgConfig: config.svgConfig,
      resolution: options.resolution,
      transform: options.transform ?? null,
    },
    { name: options.name, output: options.output ?? null },
  )
}

/**
 * Applies one-shot-only fields (`metadata.set`, `subtitles`, `video.thumbnail`) onto a
 * `VideoConfig` after its preset settings were applied.
 */
export function applyOneShotContractOverrides(
  config: VideoConfig,
  contract: VideoContract | AudioContract,
): VideoConfig {
  const next = { ...config }
  if (
    contract.settings.metadata.mode === 'keep' &&
    contract.settings.metadata.set
  ) {
    const set = contract.settings.metadata.set
    next.shouldStripMetadata = false
    next.metadataConfig = {
      title: set.title ?? null,
      artist: set.artist ?? null,
      album: set.album ?? null,
      year: set.year ?? null,
      comment: set.comment ?? null,
      description: set.description ?? null,
      synopsis: set.synopsis ?? null,
      genre: set.genre ?? null,
      copyright: set.copyright ?? null,
      creationTime: set.creationTime ?? null,
      shouldEnableCreationTime: !!set.creationTime,
    }
  }

  if (contract.mediaType === 'video') {
    if (contract.settings.video.thumbnail) {
      next.shouldEnableCustomThumbnail = true
      next.customThumbnailPath = contract.settings.video.thumbnail
    }
    if (contract.settings.subtitles) {
      const { preserveExisting, tracks } = contract.settings.subtitles
      next.subtitlesConfig = {
        shouldEnableSubtitles: tracks.length > 0,
        preserveExistingSubtitles: preserveExisting,
        subtitles: tracks.map((track) => ({
          subtitlePath: track.path,
          language: track.language ?? 'und',
          title: track.title ?? undefined,
          fileName: track.path.split(/[/\\]/).pop() ?? null,
        })),
      }
    }
  }
  return next
}
