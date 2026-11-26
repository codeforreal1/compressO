import {
  isAudioCodecCompatible,
  isVideoCodecCompatible,
} from '@/types/compression'
import { isPlainObject } from './patch'
import {
  ALLOWED_FILE_NAME_TOKENS,
  AUDIO_BITRATE_VALUES,
  AUDIO_CODEC_NAMES,
  AUDIO_CODEC_TO_INTERNAL,
  AUDIO_OUTPUT_FORMATS,
  CONTRACT_LIMITS,
  CROP_ASPECT_RATIOS,
  DEFAULT_AUDIO_CONTRACT,
  DEFAULT_IMAGE_CONTRACT,
  DEFAULT_VIDEO_CONTRACT,
  IMAGE_OUTPUT_FORMATS,
  METADATA_TAG_KEYS,
  MONO_SOURCES,
  RESOLUTION_PRESETS,
  ROTATION_VALUES,
  SAVE_LOCATIONS,
  SUBTITLE_EXTENSIONS,
  THUMBNAIL_EXTENSIONS,
  VIDEO_CODEC_NAMES,
  VIDEO_CODEC_TO_INTERNAL,
  VIDEO_OUTPUT_FORMATS,
} from './spec'
import {
  type AudioBitrateKbps,
  type AudioChannelMode,
  type AudioContract,
  type AudioSettings,
  CONTRACT_VERSION,
  type ContractMediaType,
  type ContractValidationIssue,
  type ContractValidationMode,
  type ContractValidationResult,
  type Hdr,
  type ImageContract,
  type MediaContract,
  type MetadataSettings,
  type MetadataTags,
  type OutputSettings,
  type Resolution,
  type SubtitlesSettings,
  type SubtitleTrack,
  type SvgTracingSettings,
  type Transform,
  type VideoClips,
  type VideoCompression,
  type VideoContract,
} from './types'

type ValidateOptions = {
  mode?: ContractValidationMode
  /** Require a non-empty preset name (and reject reserved `"standard"`) */
  requireName?: boolean
}

function addError(
  errors: ContractValidationIssue[],
  path: string,
  code: string,
  message: string,
  allowed?: readonly (string | number)[],
) {
  errors.push(
    allowed ? { path, code, message, allowed } : { path, code, message },
  )
}

function addWarning(
  warnings: ContractValidationIssue[],
  path: string,
  code: string,
  message: string,
) {
  warnings.push({ path, code, message })
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  basePath: string,
  errors: ContractValidationIssue[],
) {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      addError(
        errors,
        `${basePath}/${key}`,
        'unknownField',
        `Unknown field "${key}".`,
        allowedKeys,
      )
    }
  }
}

function isAbsolutePath(path: string): boolean {
  if (path.startsWith('/')) return true
  if (/^[A-Za-z]:[\\/]/.test(path)) return true
  if (path.startsWith('\\\\')) return true
  return false
}

function getExtensionLower(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateNumberRange(
  value: unknown,
  min: number,
  max: number,
  path: string,
  errors: ContractValidationIssue[],
  { integer = false }: { integer?: boolean } = {},
): number | null {
  if (!isFiniteNumber(value)) {
    addError(
      errors,
      path,
      'invalidType',
      `Expected a number between ${min} and ${max}.`,
    )
    return null
  }
  if (integer && !Number.isInteger(value)) {
    addError(
      errors,
      path,
      'invalidType',
      `Expected an integer between ${min} and ${max}.`,
    )
    return null
  }
  if (value < min || value > max) {
    addError(
      errors,
      path,
      'outOfRange',
      `Value ${value} must be between ${min} and ${max}.`,
    )
    return null
  }
  return value
}

function validateEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: ContractValidationIssue[],
): T | null {
  if ((allowed as readonly unknown[]).includes(value)) {
    return value as T
  }
  addError(
    errors,
    path,
    'invalidValue',
    `Invalid value ${JSON.stringify(value)}.`,
    allowed,
  )
  return null
}

function validateResolution(
  value: unknown,
  fallback: Resolution,
  path: string,
  errors: ContractValidationIssue[],
): Resolution {
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value === 'string') {
    return validateEnum(value, RESOLUTION_PRESETS, path, errors) ?? fallback
  }
  if (isFiniteNumber(value)) {
    if (!Number.isInteger(value) || value < CONTRACT_LIMITS.resolutionMinPx) {
      addError(
        errors,
        path,
        'outOfRange',
        `Pixel resolution must be an integer >= ${CONTRACT_LIMITS.resolutionMinPx}.`,
      )
      return fallback
    }
    if (value % 2 !== 0) {
      addError(
        errors,
        path,
        'invalidResolution',
        'Pixel resolution must be an even integer.',
      )
      return fallback
    }
    return value
  }
  addError(
    errors,
    path,
    'invalidType',
    'Resolution must be null, a preset ("480p".."4k"), or an even integer.',
    RESOLUTION_PRESETS,
  )
  return fallback
}

function validateTransform(
  value: unknown,
  fallback: Transform,
  path: string,
  errors: ContractValidationIssue[],
): Transform {
  if (value === undefined) return fallback
  if (value === null) return null
  if (!isPlainObject(value)) {
    addError(
      errors,
      path,
      'invalidType',
      'transform must be an object or null.',
    )
    return fallback
  }
  rejectUnknownKeys(
    value,
    ['rotate', 'flipHorizontal', 'flipVertical', 'crop'],
    path,
    errors,
  )
  const rotate =
    value.rotate === undefined
      ? 0
      : (validateEnum(
          value.rotate,
          ROTATION_VALUES,
          `${path}/rotate`,
          errors,
        ) ?? 0)

  let flipHorizontal = false
  if (value.flipHorizontal !== undefined) {
    if (typeof value.flipHorizontal !== 'boolean') {
      addError(
        errors,
        `${path}/flipHorizontal`,
        'invalidType',
        'Expected a boolean.',
      )
    } else {
      flipHorizontal = value.flipHorizontal
    }
  }

  let flipVertical = false
  if (value.flipVertical !== undefined) {
    if (typeof value.flipVertical !== 'boolean') {
      addError(
        errors,
        `${path}/flipVertical`,
        'invalidType',
        'Expected a boolean.',
      )
    } else {
      flipVertical = value.flipVertical
    }
  }

  let crop: Transform extends infer T
    ? T extends { crop: infer C }
      ? C
      : never
    : never = null
  if (value.crop !== undefined && value.crop !== null) {
    crop = validateEnum(value.crop, CROP_ASPECT_RATIOS, `${path}/crop`, errors)
  }

  if (rotate === 0 && !flipHorizontal && !flipVertical && crop === null) {
    return null
  }
  return { rotate, flipHorizontal, flipVertical, crop }
}

function validateHdr(
  value: unknown,
  fallback: Hdr,
  path: string,
  errors: ContractValidationIssue[],
): Hdr {
  if (value === undefined) return fallback
  if (value === null) return null
  if (!isPlainObject(value)) {
    addError(errors, path, 'invalidType', 'hdr must be an object or null.')
    return fallback
  }
  const mode = value.mode
  if (mode === 'remove') {
    rejectUnknownKeys(value, ['mode'], path, errors)
    return { mode: 'remove' }
  }
  if (mode === 'boost') {
    rejectUnknownKeys(value, ['mode', 'intensity'], path, errors)
    const intensity =
      value.intensity === undefined
        ? 2
        : (validateNumberRange(
            value.intensity,
            CONTRACT_LIMITS.hdrIntensity.min,
            CONTRACT_LIMITS.hdrIntensity.max,
            `${path}/intensity`,
            errors,
          ) ?? 2)
    return { mode: 'boost', intensity }
  }
  addError(
    errors,
    `${path}/mode`,
    'invalidValue',
    'hdr.mode must be "boost" or "remove".',
    ['boost', 'remove'],
  )
  return fallback
}

function validateAudioSettings(
  value: unknown,
  fallback: AudioSettings,
  path: string,
  errors: ContractValidationIssue[],
): AudioSettings {
  if (value === undefined) return { ...fallback }
  if (!isPlainObject(value)) {
    addError(errors, path, 'invalidType', 'audio must be an object.')
    return { ...fallback }
  }
  rejectUnknownKeys(
    value,
    ['volumePercent', 'codec', 'channels', 'bitrateKbps'],
    path,
    errors,
  )

  const volumePercent =
    value.volumePercent === undefined
      ? fallback.volumePercent
      : (validateNumberRange(
          value.volumePercent,
          CONTRACT_LIMITS.volumePercent.min,
          CONTRACT_LIMITS.volumePercent.max,
          `${path}/volumePercent`,
          errors,
        ) ?? fallback.volumePercent)

  let codec = fallback.codec
  if (value.codec !== undefined) {
    codec =
      value.codec === null
        ? null
        : validateEnum(value.codec, AUDIO_CODEC_NAMES, `${path}/codec`, errors)
  }

  let channels: AudioChannelMode = fallback.channels
  if (value.channels !== undefined) {
    if (value.channels === null) {
      channels = null
    } else if (!isPlainObject(value.channels)) {
      addError(
        errors,
        `${path}/channels`,
        'invalidType',
        'channels must be an object or null.',
      )
    } else if (value.channels.layout === 'mono') {
      rejectUnknownKeys(
        value.channels,
        ['layout', 'source'],
        `${path}/channels`,
        errors,
      )
      const source =
        value.channels.source === undefined
          ? 'mix'
          : (validateEnum(
              value.channels.source,
              MONO_SOURCES,
              `${path}/channels/source`,
              errors,
            ) ?? 'mix')
      channels = { layout: 'mono', source }
    } else if (value.channels.layout === 'stereo') {
      rejectUnknownKeys(
        value.channels,
        ['layout', 'swapChannels'],
        `${path}/channels`,
        errors,
      )
      let swapChannels = false
      if (value.channels.swapChannels !== undefined) {
        if (typeof value.channels.swapChannels !== 'boolean') {
          addError(
            errors,
            `${path}/channels/swapChannels`,
            'invalidType',
            'Expected a boolean.',
          )
        } else {
          swapChannels = value.channels.swapChannels
        }
      }
      channels = { layout: 'stereo', swapChannels }
    } else {
      addError(
        errors,
        `${path}/channels/layout`,
        'invalidValue',
        'channels.layout must be "mono" or "stereo".',
        ['mono', 'stereo'],
      )
    }
  }

  let bitrateKbps: AudioBitrateKbps | null = fallback.bitrateKbps
  if (value.bitrateKbps !== undefined) {
    bitrateKbps =
      value.bitrateKbps === null
        ? null
        : validateEnum(
            value.bitrateKbps,
            AUDIO_BITRATE_VALUES,
            `${path}/bitrateKbps`,
            errors,
          )
  }

  return { volumePercent, codec, channels, bitrateKbps }
}

function validateMetadata(
  value: unknown,
  mode: ContractValidationMode,
  path: string,
  errors: ContractValidationIssue[],
): MetadataSettings {
  if (value === undefined) return { mode: 'strip' }
  if (!isPlainObject(value)) {
    addError(errors, path, 'invalidType', 'metadata must be an object.')
    return { mode: 'strip' }
  }
  if (value.mode === 'strip') {
    rejectUnknownKeys(value, ['mode', 'set'], path, errors)
    if (value.set !== undefined && value.set !== null) {
      addError(
        errors,
        `${path}/set`,
        'metadataSetRequiresKeep',
        'metadata.set cannot be used when metadata.mode is "strip".',
      )
    }
    return { mode: 'strip' }
  }
  if (value.mode === 'keep') {
    rejectUnknownKeys(value, ['mode', 'set'], path, errors)
    if (value.set === undefined || value.set === null) {
      return { mode: 'keep' }
    }
    if (!isPlainObject(value.set)) {
      addError(
        errors,
        `${path}/set`,
        'invalidType',
        'metadata.set must be an object or null.',
      )
      return { mode: 'keep' }
    }
    rejectUnknownKeys(value.set, METADATA_TAG_KEYS, `${path}/set`, errors)
    const tags: MetadataTags = {}
    let hasAnyTag = false
    for (const key of METADATA_TAG_KEYS) {
      const raw = value.set[key]
      if (raw === undefined) continue
      if (raw === null) {
        tags[key] = null
        continue
      }
      if (typeof raw !== 'string') {
        addError(
          errors,
          `${path}/set/${key}`,
          'invalidType',
          'Expected a string or null.',
        )
        continue
      }
      const trimmed = raw.trim()
      if (trimmed.length > 0) {
        tags[key] = trimmed
        hasAnyTag = true
      } else {
        tags[key] = null
      }
    }
    if (hasAnyTag && mode === 'preset') {
      addError(
        errors,
        `${path}/set`,
        'presetDisallowedField',
        'Metadata tag values (metadata.set) are one-shot only (single file or batch) and cannot be saved in presets. Use --contract for one-shot compression or omit metadata.set.',
      )
    }
    return hasAnyTag ? { mode: 'keep', set: tags } : { mode: 'keep' }
  }
  addError(
    errors,
    `${path}/mode`,
    'invalidValue',
    'metadata.mode must be "strip" or "keep".',
    ['strip', 'keep'],
  )
  return { mode: 'strip' }
}

function validateSubtitles(
  value: unknown,
  mode: ContractValidationMode,
  path: string,
  errors: ContractValidationIssue[],
): SubtitlesSettings | null {
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)) {
    addError(
      errors,
      path,
      'invalidType',
      'subtitles must be an object or null.',
    )
    return null
  }
  rejectUnknownKeys(value, ['preserveExisting', 'tracks'], path, errors)
  let preserveExisting = false
  if (value.preserveExisting !== undefined) {
    if (typeof value.preserveExisting !== 'boolean') {
      addError(
        errors,
        `${path}/preserveExisting`,
        'invalidType',
        'Expected a boolean.',
      )
    } else {
      preserveExisting = value.preserveExisting
    }
  }
  const tracks: SubtitleTrack[] = []
  if (value.tracks !== undefined) {
    if (!Array.isArray(value.tracks)) {
      addError(
        errors,
        `${path}/tracks`,
        'invalidType',
        'tracks must be an array.',
      )
    } else {
      value.tracks.forEach((entry, index) => {
        const trackPath = `${path}/tracks/${index}`
        if (!isPlainObject(entry)) {
          addError(
            errors,
            trackPath,
            'invalidType',
            'Subtitle track must be an object.',
          )
          return
        }
        rejectUnknownKeys(
          entry,
          ['path', 'language', 'title'],
          trackPath,
          errors,
        )
        if (typeof entry.path !== 'string' || entry.path.trim().length === 0) {
          addError(
            errors,
            `${trackPath}/path`,
            'required',
            'Subtitle track path is required.',
          )
          return
        }
        const trimmedPath = entry.path.trim()
        if (!isAbsolutePath(trimmedPath)) {
          addError(
            errors,
            `${trackPath}/path`,
            'relativePath',
            'Subtitle track path must be an absolute path.',
          )
        } else {
          const ext = getExtensionLower(trimmedPath)
          if (!(SUBTITLE_EXTENSIONS as readonly string[]).includes(ext)) {
            addError(
              errors,
              `${trackPath}/path`,
              'unsupportedExtension',
              `Unsupported subtitle extension ".${ext}".`,
              SUBTITLE_EXTENSIONS,
            )
          }
        }
        let language = 'und'
        if (entry.language !== undefined) {
          if (typeof entry.language !== 'string' || !entry.language.trim()) {
            addError(
              errors,
              `${trackPath}/language`,
              'invalidType',
              'language must be a non-empty string.',
            )
          } else {
            language = entry.language.trim()
          }
        }
        let title: string | null = null
        if (entry.title !== undefined && entry.title !== null) {
          if (typeof entry.title !== 'string') {
            addError(
              errors,
              `${trackPath}/title`,
              'invalidType',
              'title must be a string or null.',
            )
          } else {
            title = entry.title.trim() || null
          }
        }
        tracks.push({ path: trimmedPath, language, title })
      })
    }
  }
  if (!preserveExisting && tracks.length === 0) {
    return null
  }
  if (mode === 'preset') {
    addError(
      errors,
      path,
      'presetDisallowedField',
      'Subtitles are one-shot only (single file or batch) and cannot be saved in presets. Use --contract for one-shot compression or omit settings.subtitles.',
    )
  }
  return { preserveExisting, tracks }
}

function validateOutput(
  value: unknown,
  path: string,
  errors: ContractValidationIssue[],
  warnings: ContractValidationIssue[],
): OutputSettings | null {
  if (value === undefined || value === null) return null
  if (!isPlainObject(value)) {
    addError(errors, path, 'invalidType', 'output must be an object or null.')
    return null
  }
  rejectUnknownKeys(
    value,
    ['saveTo', 'folder', 'fileNameTemplate'],
    path,
    errors,
  )
  const saveTo =
    validateEnum(value.saveTo, SAVE_LOCATIONS, `${path}/saveTo`, errors) ??
    'sameFolder'

  let folder: string | null = null
  if (value.folder !== undefined && value.folder !== null) {
    if (typeof value.folder !== 'string') {
      addError(
        errors,
        `${path}/folder`,
        'invalidType',
        'folder must be a string or null.',
      )
    } else {
      const trimmed = value.folder.trim()
      folder = trimmed.length > 0 ? trimmed : null
    }
  }
  if (saveTo === 'folder') {
    if (!folder) {
      addError(
        errors,
        `${path}/folder`,
        'required',
        'output.folder is required when saveTo is "folder".',
      )
    } else if (!isAbsolutePath(folder)) {
      addError(
        errors,
        `${path}/folder`,
        'relativePath',
        'output.folder must be an absolute path.',
      )
    }
  }
  if (saveTo === 'ask') {
    addWarning(
      warnings,
      `${path}/saveTo`,
      'requiresOutputOption',
      'saveTo "ask" cannot auto-save in watched folders or CLI without --output.',
    )
  }

  let fileNameTemplate = 'compressO-{name}'
  if (value.fileNameTemplate !== undefined) {
    if (typeof value.fileNameTemplate !== 'string') {
      addError(
        errors,
        `${path}/fileNameTemplate`,
        'invalidType',
        'fileNameTemplate must be a string.',
      )
    } else {
      if (/[/\\:*?"<>|\u0000-\u001f]/.test(value.fileNameTemplate)) {
        addError(
          errors,
          `${path}/fileNameTemplate`,
          'invalidCharacters',
          'fileNameTemplate contains characters not allowed in file names.',
        )
      }
      const tokens = value.fileNameTemplate.match(/\{[^}]*\}/g) ?? []
      for (const token of tokens) {
        if (
          !(ALLOWED_FILE_NAME_TOKENS as readonly string[]).includes(
            token.toLowerCase(),
          )
        ) {
          addError(
            errors,
            `${path}/fileNameTemplate`,
            'invalidTemplateToken',
            `Unknown file name template token "${token}".`,
            ALLOWED_FILE_NAME_TOKENS,
          )
        }
      }
      fileNameTemplate = value.fileNameTemplate
    }
  }

  return {
    saveTo,
    folder: saveTo === 'folder' ? folder : null,
    fileNameTemplate,
  }
}

function validateVideoSettings(
  rawSettings: unknown,
  mode: ContractValidationMode,
  errors: ContractValidationIssue[],
  warnings: ContractValidationIssue[],
): VideoContract['settings'] {
  const defaults = DEFAULT_VIDEO_CONTRACT.settings
  if (rawSettings === undefined) {
    return structuredClone(defaults)
  }
  if (!isPlainObject(rawSettings)) {
    addError(errors, '/settings', 'invalidType', 'settings must be an object.')
    return structuredClone(defaults)
  }
  rejectUnknownKeys(
    rawSettings,
    [
      'format',
      'compression',
      'speed',
      'metadata',
      'video',
      'audio',
      'subtitles',
      'clips',
    ],
    '/settings',
    errors,
  )

  let format = defaults.format
  if (rawSettings.format !== undefined) {
    format =
      rawSettings.format === null
        ? null
        : validateEnum(
            rawSettings.format,
            VIDEO_OUTPUT_FORMATS,
            '/settings/format',
            errors,
          )
  }

  let compression: VideoCompression = { ...defaults.compression }
  if (rawSettings.compression !== undefined) {
    const rawComp = rawSettings.compression
    if (!isPlainObject(rawComp)) {
      addError(
        errors,
        '/settings/compression',
        'invalidType',
        'compression must be an object.',
      )
    } else if (rawComp.mode === 'quality') {
      rejectUnknownKeys(
        rawComp,
        ['mode', 'quality'],
        '/settings/compression',
        errors,
      )
      const quality =
        rawComp.quality === undefined
          ? 50
          : (validateNumberRange(
              rawComp.quality,
              CONTRACT_LIMITS.quality.min,
              CONTRACT_LIMITS.quality.max,
              '/settings/compression/quality',
              errors,
            ) ?? 50)
      compression = { mode: 'quality', quality }
    } else if (rawComp.mode === 'targetSize') {
      rejectUnknownKeys(
        rawComp,
        ['mode', 'targetSizeMB'],
        '/settings/compression',
        errors,
      )
      const targetSizeMB =
        rawComp.targetSizeMB === undefined
          ? CONTRACT_LIMITS.videoTargetSizeMB.default
          : (validateNumberRange(
              rawComp.targetSizeMB,
              CONTRACT_LIMITS.videoTargetSizeMB.min,
              CONTRACT_LIMITS.videoTargetSizeMB.max,
              '/settings/compression/targetSizeMB',
              errors,
            ) ?? CONTRACT_LIMITS.videoTargetSizeMB.default)
      compression = { mode: 'targetSize', targetSizeMB }
    } else if (rawComp.mode === 'none') {
      rejectUnknownKeys(rawComp, ['mode'], '/settings/compression', errors)
      compression = { mode: 'none' }
    } else {
      addError(
        errors,
        '/settings/compression/mode',
        'invalidValue',
        'compression.mode must be "quality", "targetSize", or "none".',
        ['quality', 'targetSize', 'none'],
      )
    }
  }

  let speed = defaults.speed
  if (rawSettings.speed !== undefined) {
    speed =
      rawSettings.speed === null
        ? null
        : validateNumberRange(
            rawSettings.speed,
            CONTRACT_LIMITS.speed.min,
            CONTRACT_LIMITS.speed.max,
            '/settings/speed',
            errors,
          )
  }

  const metadata = validateMetadata(
    rawSettings.metadata,
    mode,
    '/settings/metadata',
    errors,
  )

  const videoDefaults = defaults.video
  let video: VideoContract['settings']['video'] = {
    codec: videoDefaults.codec,
    resolution: videoDefaults.resolution,
    fps: videoDefaults.fps,
    transform: videoDefaults.transform,
    hdr: videoDefaults.hdr,
    ...(mode === 'oneShot' ? { thumbnail: null } : {}),
  }
  if (rawSettings.video !== undefined) {
    if (!isPlainObject(rawSettings.video)) {
      addError(
        errors,
        '/settings/video',
        'invalidType',
        'settings.video must be an object.',
      )
    } else {
      rejectUnknownKeys(
        rawSettings.video,
        ['codec', 'resolution', 'fps', 'transform', 'hdr', 'thumbnail'],
        '/settings/video',
        errors,
      )
      const codec =
        rawSettings.video.codec === undefined ||
        rawSettings.video.codec === null
          ? null
          : validateEnum(
              rawSettings.video.codec,
              VIDEO_CODEC_NAMES,
              '/settings/video/codec',
              errors,
            )
      const resolution = validateResolution(
        rawSettings.video.resolution,
        videoDefaults.resolution,
        '/settings/video/resolution',
        errors,
      )
      const fps =
        rawSettings.video.fps === undefined || rawSettings.video.fps === null
          ? null
          : validateNumberRange(
              rawSettings.video.fps,
              CONTRACT_LIMITS.fps.min,
              CONTRACT_LIMITS.fps.max,
              '/settings/video/fps',
              errors,
              { integer: true },
            )
      const transform = validateTransform(
        rawSettings.video.transform,
        videoDefaults.transform,
        '/settings/video/transform',
        errors,
      )
      const hdr = validateHdr(
        rawSettings.video.hdr,
        videoDefaults.hdr,
        '/settings/video/hdr',
        errors,
      )
      let thumbnail: string | null = null
      if (
        rawSettings.video.thumbnail !== undefined &&
        rawSettings.video.thumbnail !== null
      ) {
        if (typeof rawSettings.video.thumbnail !== 'string') {
          addError(
            errors,
            '/settings/video/thumbnail',
            'invalidType',
            'thumbnail must be a string or null.',
          )
        } else {
          const trimmed = rawSettings.video.thumbnail.trim()
          if (!trimmed) {
            addError(
              errors,
              '/settings/video/thumbnail',
              'invalidValue',
              'thumbnail path cannot be empty (use null for none).',
            )
          } else {
            if (mode === 'preset') {
              addError(
                errors,
                '/settings/video/thumbnail',
                'presetDisallowedField',
                'Custom thumbnail is one-shot only (single file or batch) and cannot be saved in presets. Use --contract for one-shot compression or set settings.video.thumbnail to null.',
              )
            }
            if (!isAbsolutePath(trimmed)) {
              addError(
                errors,
                '/settings/video/thumbnail',
                'relativePath',
                'thumbnail must be an absolute file path.',
              )
            } else {
              const ext = getExtensionLower(trimmed)
              if (!(THUMBNAIL_EXTENSIONS as readonly string[]).includes(ext)) {
                addError(
                  errors,
                  '/settings/video/thumbnail',
                  'unsupportedExtension',
                  `Unsupported thumbnail extension ".${ext}".`,
                  THUMBNAIL_EXTENSIONS,
                )
              }
            }
            thumbnail = trimmed
          }
        }
      }
      video = {
        codec,
        resolution,
        fps,
        transform,
        hdr,
        ...(mode === 'oneShot' ? { thumbnail } : {}),
      }
    }
  }

  const audio = validateAudioSettings(
    rawSettings.audio,
    defaults.audio,
    '/settings/audio',
    errors,
  )

  const subtitles = validateSubtitles(
    rawSettings.subtitles,
    mode,
    '/settings/subtitles',
    errors,
  )

  let clips: VideoClips = null
  if (rawSettings.clips !== undefined && rawSettings.clips !== null) {
    if (!isPlainObject(rawSettings.clips)) {
      addError(
        errors,
        '/settings/clips',
        'invalidType',
        'clips must be an object or null.',
      )
    } else if (rawSettings.clips.mode === 'count') {
      rejectUnknownKeys(
        rawSettings.clips,
        ['mode', 'count'],
        '/settings/clips',
        errors,
      )
      const count =
        rawSettings.clips.count === undefined
          ? 2
          : (validateNumberRange(
              rawSettings.clips.count,
              CONTRACT_LIMITS.clipsCount.min,
              CONTRACT_LIMITS.clipsCount.max,
              '/settings/clips/count',
              errors,
              { integer: true },
            ) ?? 2)
      clips = { mode: 'count', count }
    } else if (rawSettings.clips.mode === 'duration') {
      rejectUnknownKeys(
        rawSettings.clips,
        ['mode', 'seconds'],
        '/settings/clips',
        errors,
      )
      const seconds =
        rawSettings.clips.seconds === undefined
          ? 60
          : (validateNumberRange(
              rawSettings.clips.seconds,
              CONTRACT_LIMITS.clipsDurationSeconds.min,
              CONTRACT_LIMITS.clipsDurationSeconds.max,
              '/settings/clips/seconds',
              errors,
            ) ?? 60)
      clips = { mode: 'duration', seconds }
    } else {
      addError(
        errors,
        '/settings/clips/mode',
        'invalidValue',
        'clips.mode must be "count" or "duration".',
        ['count', 'duration'],
      )
    }
  }

  // Cross-field rules
  const isAudioFmt =
    format !== null &&
    (AUDIO_OUTPUT_FORMATS as readonly string[]).includes(format)
  const isGifFmt = format === 'gif'

  if (isGifFmt) {
    if (compression.mode === 'targetSize') {
      addError(
        errors,
        '/settings/compression',
        'targetSizeNotSupportedForGif',
        'Target size compression is not supported for GIF output.',
      )
    }
    if (clips !== null) {
      addError(
        errors,
        '/settings/clips',
        'clipsNotSupportedForGif',
        'Splitting into clips is not supported for GIF output.',
      )
    }
    if (
      audio.volumePercent !== 100 ||
      audio.codec !== null ||
      audio.channels !== null ||
      audio.bitrateKbps !== null
    ) {
      addError(
        errors,
        '/settings/audio',
        'audioNotSupportedForGif',
        'Audio settings are not supported for GIF output.',
      )
    }
    if (video.thumbnail) {
      addError(
        errors,
        '/settings/video/thumbnail',
        'thumbnailNotSupportedForFormat',
        'Custom thumbnail is not supported for GIF output.',
      )
    }
    if (subtitles) {
      addError(
        errors,
        '/settings/subtitles',
        'subtitlesNotSupportedForFormat',
        'Subtitles are not supported for GIF output.',
      )
    }
  } else if (isAudioFmt && format) {
    if (compression.mode === 'none') {
      addError(
        errors,
        '/settings/compression',
        'noneCompressionNotSupportedForAudioFormat',
        'compression.mode "none" is not supported when extracting audio.',
      )
    }
    if (
      audio.codec &&
      !isAudioCodecCompatible(AUDIO_CODEC_TO_INTERNAL[audio.codec], format)
    ) {
      addError(
        errors,
        '/settings/audio/codec',
        'incompatibleCodec',
        `Audio codec "${audio.codec}" is not compatible with "${format}".`,
      )
    }
    if (
      video.codec ||
      video.resolution !== null ||
      video.fps !== null ||
      video.transform !== null ||
      video.hdr !== null ||
      video.thumbnail ||
      subtitles !== null ||
      clips !== null
    ) {
      addWarning(
        warnings,
        '/settings/video',
        'ignoredForAudioFormat',
        `Video-only settings (video.*, subtitles, clips) are ignored when format is "${format}".`,
      )
    }
  } else if (format) {
    if (
      video.codec &&
      !isVideoCodecCompatible(VIDEO_CODEC_TO_INTERNAL[video.codec], format)
    ) {
      addError(
        errors,
        '/settings/video/codec',
        'incompatibleCodec',
        `Video codec "${video.codec}" is not compatible with "${format}".`,
      )
    }
    if (
      audio.codec &&
      !isAudioCodecCompatible(AUDIO_CODEC_TO_INTERNAL[audio.codec], format)
    ) {
      addError(
        errors,
        '/settings/audio/codec',
        'incompatibleCodec',
        `Audio codec "${audio.codec}" is not compatible with "${format}".`,
      )
    }
    if (video.thumbnail && (format === 'webm' || format === 'ts')) {
      addError(
        errors,
        '/settings/video/thumbnail',
        'thumbnailNotSupportedForFormat',
        `Custom thumbnail is not supported for "${format}" output.`,
      )
    }
  } else {
    if (video.codec || audio.codec) {
      addWarning(
        warnings,
        '/settings/format',
        'codecMayBeSkipped',
        'When format is null (same as input), a chosen codec is skipped for incompatible input containers.',
      )
    }
  }

  return {
    format,
    compression,
    speed,
    metadata,
    video,
    audio,
    ...(mode === 'oneShot' ? { subtitles } : {}),
    clips,
  }
}

function validateImageSettings(
  rawSettings: unknown,
  errors: ContractValidationIssue[],
  warnings: ContractValidationIssue[],
): ImageContract['settings'] {
  const defaults = DEFAULT_IMAGE_CONTRACT.settings
  if (rawSettings === undefined) {
    return structuredClone(defaults)
  }
  if (!isPlainObject(rawSettings)) {
    addError(errors, '/settings', 'invalidType', 'settings must be an object.')
    return structuredClone(defaults)
  }
  rejectUnknownKeys(
    rawSettings,
    ['format', 'compression', 'stripMetadata', 'image', 'svg'],
    '/settings',
    errors,
  )

  let format = defaults.format
  if (rawSettings.format !== undefined) {
    format =
      rawSettings.format === null
        ? null
        : validateEnum(
            rawSettings.format,
            IMAGE_OUTPUT_FORMATS,
            '/settings/format',
            errors,
          )
  }

  let compression: ImageContract['settings']['compression'] = {
    ...defaults.compression,
  }
  if (rawSettings.compression !== undefined) {
    const rawComp = rawSettings.compression
    if (!isPlainObject(rawComp)) {
      addError(
        errors,
        '/settings/compression',
        'invalidType',
        'compression must be an object.',
      )
    } else if (rawComp.mode === 'quality') {
      rejectUnknownKeys(
        rawComp,
        ['mode', 'quality'],
        '/settings/compression',
        errors,
      )
      const quality =
        rawComp.quality === undefined
          ? 50
          : (validateNumberRange(
              rawComp.quality,
              CONTRACT_LIMITS.quality.min,
              CONTRACT_LIMITS.quality.max,
              '/settings/compression/quality',
              errors,
            ) ?? 50)
      compression = { mode: 'quality', quality }
    } else if (rawComp.mode === 'lossless') {
      rejectUnknownKeys(rawComp, ['mode'], '/settings/compression', errors)
      compression = { mode: 'lossless' }
    } else if (rawComp.mode === 'targetSize') {
      rejectUnknownKeys(
        rawComp,
        ['mode', 'targetSizeMB'],
        '/settings/compression',
        errors,
      )
      const targetSizeMB =
        rawComp.targetSizeMB === undefined
          ? CONTRACT_LIMITS.imageTargetSizeMB.default
          : (validateNumberRange(
              rawComp.targetSizeMB,
              CONTRACT_LIMITS.imageTargetSizeMB.min,
              CONTRACT_LIMITS.imageTargetSizeMB.max,
              '/settings/compression/targetSizeMB',
              errors,
            ) ?? CONTRACT_LIMITS.imageTargetSizeMB.default)
      compression = { mode: 'targetSize', targetSizeMB }
    } else {
      addError(
        errors,
        '/settings/compression/mode',
        'invalidValue',
        'compression.mode must be "quality", "lossless", or "targetSize".',
        ['quality', 'lossless', 'targetSize'],
      )
    }
  }

  let stripMetadata = defaults.stripMetadata
  if (rawSettings.stripMetadata !== undefined) {
    if (typeof rawSettings.stripMetadata !== 'boolean') {
      addError(
        errors,
        '/settings/stripMetadata',
        'invalidType',
        'stripMetadata must be a boolean.',
      )
    } else {
      stripMetadata = rawSettings.stripMetadata
    }
  }

  let image = { ...defaults.image }
  if (rawSettings.image !== undefined) {
    if (!isPlainObject(rawSettings.image)) {
      addError(
        errors,
        '/settings/image',
        'invalidType',
        'settings.image must be an object.',
      )
    } else {
      rejectUnknownKeys(
        rawSettings.image,
        ['resolution', 'transform', 'hdr'],
        '/settings/image',
        errors,
      )
      image = {
        resolution: validateResolution(
          rawSettings.image.resolution,
          defaults.image.resolution,
          '/settings/image/resolution',
          errors,
        ),
        transform: validateTransform(
          rawSettings.image.transform,
          defaults.image.transform,
          '/settings/image/transform',
          errors,
        ),
        hdr: validateHdr(
          rawSettings.image.hdr,
          defaults.image.hdr,
          '/settings/image/hdr',
          errors,
        ),
      }
    }
  }

  let svg: ImageContract['settings']['svg'] = { ...defaults.svg }
  if (rawSettings.svg !== undefined) {
    if (!isPlainObject(rawSettings.svg)) {
      addError(
        errors,
        '/settings/svg',
        'invalidType',
        'settings.svg must be an object.',
      )
    } else {
      rejectUnknownKeys(
        rawSettings.svg,
        ['scale', 'tracing'],
        '/settings/svg',
        errors,
      )
      const scale =
        rawSettings.svg.scale === undefined
          ? defaults.svg.scale
          : (validateNumberRange(
              rawSettings.svg.scale,
              CONTRACT_LIMITS.svgScale.min,
              CONTRACT_LIMITS.svgScale.max,
              '/settings/svg/scale',
              errors,
              { integer: true },
            ) ?? defaults.svg.scale)

      let tracing: SvgTracingSettings | null = null
      if (
        rawSettings.svg.tracing !== undefined &&
        rawSettings.svg.tracing !== null
      ) {
        const rawTracing = rawSettings.svg.tracing
        if (!isPlainObject(rawTracing)) {
          addError(
            errors,
            '/settings/svg/tracing',
            'invalidType',
            'svg.tracing must be an object or null.',
          )
        } else {
          rejectUnknownKeys(
            rawTracing,
            [
              'filterSpeckle',
              'colorPrecision',
              'layerDifference',
              'cornerThreshold',
              'lengthThreshold',
              'spliceThreshold',
              'blackAndWhite',
            ],
            '/settings/svg/tracing',
            errors,
          )
          const tLimits = CONTRACT_LIMITS.svgTracing
          const intField = (
            key: Exclude<
              keyof SvgTracingSettings,
              'blackAndWhite' | 'lengthThreshold'
            >,
          ) =>
            rawTracing[key] === undefined
              ? tLimits[key].default
              : (validateNumberRange(
                  rawTracing[key],
                  tLimits[key].min,
                  tLimits[key].max,
                  `/settings/svg/tracing/${key}`,
                  errors,
                  { integer: true },
                ) ?? tLimits[key].default)

          const lengthThreshold =
            rawTracing.lengthThreshold === undefined
              ? tLimits.lengthThreshold.default
              : (validateNumberRange(
                  rawTracing.lengthThreshold,
                  tLimits.lengthThreshold.min,
                  tLimits.lengthThreshold.max,
                  '/settings/svg/tracing/lengthThreshold',
                  errors,
                ) ?? tLimits.lengthThreshold.default)

          let blackAndWhite = false
          if (rawTracing.blackAndWhite !== undefined) {
            if (typeof rawTracing.blackAndWhite !== 'boolean') {
              addError(
                errors,
                '/settings/svg/tracing/blackAndWhite',
                'invalidType',
                'Expected a boolean.',
              )
            } else {
              blackAndWhite = rawTracing.blackAndWhite
            }
          }

          tracing = {
            filterSpeckle: intField('filterSpeckle'),
            colorPrecision: intField('colorPrecision'),
            layerDifference: intField('layerDifference'),
            cornerThreshold: intField('cornerThreshold'),
            lengthThreshold,
            spliceThreshold: intField('spliceThreshold'),
            blackAndWhite,
          }
        }
      }
      svg = { scale, tracing }
    }
  }

  if (format === 'svg') {
    if (compression.mode === 'targetSize') {
      addError(
        errors,
        '/settings/compression',
        'targetSizeNotSupportedForSvg',
        'Target size compression is not supported for SVG output.',
      )
    }
    if (image.resolution !== null || image.transform !== null) {
      addWarning(
        warnings,
        '/settings/image',
        'ignoredForSvg',
        'Resolution and transform are ignored for SVG output (use svg.scale instead).',
      )
    }
  }

  return { format, compression, stripMetadata, image, svg }
}

function validateAudioOnlySettings(
  rawSettings: unknown,
  mode: ContractValidationMode,
  errors: ContractValidationIssue[],
  warnings: ContractValidationIssue[],
): AudioContract['settings'] {
  const defaults = DEFAULT_AUDIO_CONTRACT.settings
  if (rawSettings === undefined) {
    return structuredClone(defaults)
  }
  if (!isPlainObject(rawSettings)) {
    addError(errors, '/settings', 'invalidType', 'settings must be an object.')
    return structuredClone(defaults)
  }
  rejectUnknownKeys(
    rawSettings,
    ['format', 'compression', 'speed', 'metadata', 'audio'],
    '/settings',
    errors,
  )

  let format = defaults.format
  if (rawSettings.format !== undefined) {
    format =
      rawSettings.format === null
        ? null
        : validateEnum(
            rawSettings.format,
            AUDIO_OUTPUT_FORMATS,
            '/settings/format',
            errors,
          )
  }

  let compression: AudioContract['settings']['compression'] = {
    ...defaults.compression,
  }
  if (rawSettings.compression !== undefined) {
    const rawComp = rawSettings.compression
    if (!isPlainObject(rawComp)) {
      addError(
        errors,
        '/settings/compression',
        'invalidType',
        'compression must be an object.',
      )
    } else if (rawComp.mode === 'quality') {
      rejectUnknownKeys(
        rawComp,
        ['mode', 'quality'],
        '/settings/compression',
        errors,
      )
      const quality =
        rawComp.quality === undefined
          ? 50
          : (validateNumberRange(
              rawComp.quality,
              CONTRACT_LIMITS.quality.min,
              CONTRACT_LIMITS.quality.max,
              '/settings/compression/quality',
              errors,
            ) ?? 50)
      compression = { mode: 'quality', quality }
    } else if (rawComp.mode === 'targetSize') {
      rejectUnknownKeys(
        rawComp,
        ['mode', 'targetSizeMB'],
        '/settings/compression',
        errors,
      )
      const targetSizeMB =
        rawComp.targetSizeMB === undefined
          ? CONTRACT_LIMITS.audioTargetSizeMB.default
          : (validateNumberRange(
              rawComp.targetSizeMB,
              CONTRACT_LIMITS.audioTargetSizeMB.min,
              CONTRACT_LIMITS.audioTargetSizeMB.max,
              '/settings/compression/targetSizeMB',
              errors,
            ) ?? CONTRACT_LIMITS.audioTargetSizeMB.default)
      compression = { mode: 'targetSize', targetSizeMB }
    } else {
      addError(
        errors,
        '/settings/compression/mode',
        'invalidValue',
        'compression.mode must be "quality" or "targetSize".',
        ['quality', 'targetSize'],
      )
    }
  }

  let speed = defaults.speed
  if (rawSettings.speed !== undefined) {
    speed =
      rawSettings.speed === null
        ? null
        : validateNumberRange(
            rawSettings.speed,
            CONTRACT_LIMITS.speed.min,
            CONTRACT_LIMITS.speed.max,
            '/settings/speed',
            errors,
          )
  }

  const metadata = validateMetadata(
    rawSettings.metadata,
    mode,
    '/settings/metadata',
    errors,
  )
  const audio = validateAudioSettings(
    rawSettings.audio,
    defaults.audio,
    '/settings/audio',
    errors,
  )

  if (format && audio.codec) {
    if (!isAudioCodecCompatible(AUDIO_CODEC_TO_INTERNAL[audio.codec], format)) {
      addError(
        errors,
        '/settings/audio/codec',
        'incompatibleCodec',
        `Audio codec "${audio.codec}" is not compatible with "${format}".`,
      )
    }
  } else if (!format && audio.codec) {
    addWarning(
      warnings,
      '/settings/format',
      'codecMayBeSkipped',
      'When format is null (same as input), a chosen audio codec is skipped for incompatible input formats.',
    )
  }

  return { format, compression, speed, metadata, audio }
}

export function validateAndNormalizeContract(
  input: unknown,
  options: ValidateOptions = {},
): ContractValidationResult<MediaContract> {
  const mode: ContractValidationMode = options.mode ?? 'oneShot'
  const requireName = options.requireName ?? false
  const errors: ContractValidationIssue[] = []
  const warnings: ContractValidationIssue[] = []

  if (!isPlainObject(input)) {
    addError(errors, '', 'invalidType', 'Contract must be a JSON object.')
    return { ok: false, errors, warnings }
  }

  rejectUnknownKeys(
    input,
    ['$schema', 'version', 'mediaType', 'name', 'settings', 'output'],
    '',
    errors,
  )

  if (input.$schema !== undefined && typeof input.$schema !== 'string') {
    addError(errors, '/$schema', 'invalidType', '$schema must be a string.')
  }

  if (input.version !== CONTRACT_VERSION) {
    addError(
      errors,
      '/version',
      'unsupportedVersion',
      `Unsupported contract version ${JSON.stringify(input.version)}. Expected ${CONTRACT_VERSION}.`,
      [CONTRACT_VERSION],
    )
  }

  const mediaType = validateEnum<ContractMediaType>(
    input.mediaType,
    ['video', 'image', 'audio'],
    '/mediaType',
    errors,
  )

  let name: string | undefined
  if (input.name !== undefined && input.name !== null) {
    if (typeof input.name !== 'string') {
      addError(errors, '/name', 'invalidType', 'name must be a string.')
    } else {
      const trimmed = input.name.trim()
      if (trimmed.length > CONTRACT_LIMITS.presetNameMaxLength) {
        addError(
          errors,
          '/name',
          'tooLong',
          `Preset name must be at most ${CONTRACT_LIMITS.presetNameMaxLength} characters.`,
        )
      } else if (trimmed.length > 0) {
        name = trimmed
      }
    }
  }

  if (requireName) {
    if (!name) {
      addError(errors, '/name', 'required', 'Preset name is required.')
    } else if (name.toLowerCase() === 'standard') {
      addError(
        errors,
        '/name',
        'reservedName',
        '"Standard" is a built-in preset name and cannot be used.',
      )
    }
  }

  const output = validateOutput(input.output, '/output', errors, warnings)

  let contract: MediaContract
  if (mediaType === 'image') {
    contract = {
      ...(typeof input.$schema === 'string' ? { $schema: input.$schema } : {}),
      version: CONTRACT_VERSION,
      mediaType: 'image',
      ...(name ? { name } : {}),
      settings: validateImageSettings(input.settings, errors, warnings),
      output,
    }
  } else if (mediaType === 'audio') {
    contract = {
      ...(typeof input.$schema === 'string' ? { $schema: input.$schema } : {}),
      version: CONTRACT_VERSION,
      mediaType: 'audio',
      ...(name ? { name } : {}),
      settings: validateAudioOnlySettings(
        input.settings,
        mode,
        errors,
        warnings,
      ),
      output,
    }
  } else {
    contract = {
      ...(typeof input.$schema === 'string' ? { $schema: input.$schema } : {}),
      version: CONTRACT_VERSION,
      mediaType: 'video',
      ...(name ? { name } : {}),
      settings: validateVideoSettings(input.settings, mode, errors, warnings),
      output,
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings }
  }
  return { ok: true, contract, warnings }
}
