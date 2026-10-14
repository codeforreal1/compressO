import type { AudioConfig, ImageConfig, VideoConfig } from './app'
import type { PortableTransform } from './compression'

/**
 * Settings of a video that a preset holds: only those that apply to any video. Settings tied to a
 * single file (trim, crop, subtitles, custom thumbnail, audio tracks, metadata values) are never
 * part of a preset. The resolution is held as `resolution` (see `VideoPresetSettings`).
 */
export const videoPresetFields = [
  'convertToExtension',
  'shouldDisableCompression',
  'quality',
  'shouldEnableCustomVideoCodec',
  'customVideoCodec',
  'shouldEnableCustomFPS',
  'customFPS',
  'shouldEnableCustomSpeed',
  'customSpeed',
  'shouldStripMetadata',
  'shouldEnableCustomAudioCodec',
  'shouldEnableCustomChannel',
  'shouldEnableCustomBitrate',
  'audioConfig',
] as const satisfies readonly (keyof VideoConfig)[]

export type VideoPresetField = (typeof videoPresetFields)[number]

export type VideoPresetSettings = Omit<
  Pick<VideoConfig, VideoPresetField>,
  'audioConfig'
> & {
  audioConfig: Pick<
    AudioConfig,
    'volume' | 'audioCodec' | 'audioChannelConfig' | 'bitrate'
  >
  /**
   * Size of the longer side videos are resized to, keeping their aspect ratio: the width of a
   * landscape video, the height of a portrait one (e.g. 1920 gives 1920x1080 or 1080x1920);
   * `null` keeps the original size. Smaller videos are upscaled. Taken from the custom dimensions of
   * a video, or from the resolution of a batch.
   */
  resolution: number | null
  /** Rotation, flips & crop shape; a free crop is not part of presets */
  transform: PortableTransform | null
}

/** Any setting of a video preset, including the resolution */
export type VideoPresetKey = keyof VideoPresetSettings

/**
 * Settings of an image that a preset holds (transforms are per file). The resolution is held as
 * `resolution` (see `ImagePresetSettings`).
 */
export const imagePresetFields = [
  'convertToExtension',
  'isLossless',
  'quality',
  'shouldStripMetadata',
  'svgScaleFactor',
  'shouldEnableAdvancedSvgSetting',
  'svgConfig',
] as const satisfies readonly (keyof ImageConfig)[]

export type ImagePresetField = (typeof imagePresetFields)[number]

export type ImagePresetSettings = Pick<ImageConfig, ImagePresetField> & {
  /** Size of the longer side images are resized to (see `VideoPresetSettings['resolution']`) */
  resolution: number | null
  /** See `VideoPresetSettings['transform']` */
  transform: PortableTransform | null
}

/** Any setting of an image preset, including the resolution */
export type ImagePresetKey = keyof ImagePresetSettings

export type VideoPreset = {
  id: string
  name: string
  mediaType: 'video'
  settings: VideoPresetSettings
}

export type ImagePreset = {
  id: string
  name: string
  mediaType: 'image'
  settings: ImagePresetSettings
}

export type Preset = VideoPreset | ImagePreset

export type PresetMediaType = Preset['mediaType']

/** The built-in preset of each media type: the default settings, which cannot be changed */
export const STANDARD_PRESET_ID = 'standard'
