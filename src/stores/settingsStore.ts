import isEqual from 'lodash/isEqual'
import { proxy, subscribe } from 'valtio'

import * as constants from '@/constants'
import { isLanguageCode, type LanguageCode } from '@/i18n/languages'
import { type PresetMediaType, STANDARD_PRESET_ID } from '@/types/preset'

export const DEFAULT_OUTPUT_FILE_PREFIX = 'compressO-'

export const saveLocations = {
  /** Save automatically next to the original (or next to the dropped folder) */
  sameFolder: 'sameFolder',
  /** Choose where to save after every compression */
  ask: 'ask',
  /** Save automatically to `saveFolder` */
  fixedFolder: 'fixedFolder',
} as const

/** Range (%) of the tinted window's background opacity */
export const TINT_OPACITY_RANGE = { min: 5, max: 95 } as const
const DEFAULT_TINT_OPACITY = 75

function readTintOpacity(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key))
  return localStorage.getItem(key) != null && Number.isFinite(value)
    ? Math.min(TINT_OPACITY_RANGE.max, Math.max(TINT_OPACITY_RANGE.min, value))
    : fallback
}

export type SaveLocation = keyof typeof saveLocations

/**
 * A folder whose new media is compressed through the drop zone's queue (see `watch_folders.rs`),
 * with the Standard presets unless it has its own
 */
export type WatchedFolder = {
  id: string
  path: string
  isEnabled: boolean
  /** Its preset of each media type, or none for the Standard preset */
  presetIds?: Partial<Record<PresetMediaType, string>>
}

export type SettingsState = {
  /** Added to the start of saved file names (not folders). Empty keeps the original names. */
  outputFilePrefix: string
  saveLocation: SaveLocation
  /** Folder used when `saveLocation` is `fixedFolder` */
  saveFolder: string | null
  /**
   * Save the files of a dropped folder in the same folders inside the save location (on by
   * default). When off, every file goes straight into it, clashing names being numbered. Not used
   * with `sameFolder`, where each file is saved next to its original.
   */
  preserveFolderStructure: boolean
  /**
   * Auto-save outputs even when they are larger than their original (on by default). When off,
   * such outputs are left for the Save button.
   */
  saveLargerOutputs: boolean
  /**
   * When an output is saved under its original's exact path (same folder, no prefix, same format),
   * move the original to the Trash & keep only the output (off by default). When off, a numbered
   * name is used instead, as for any existing file.
   */
  replaceOriginalFiles: boolean
  /** Copy the output to the clipboard after compression */
  copyOutputToClipboard: boolean
  /** With `copyOutputToClipboard`, also copy all outputs of a batch (on by default) */
  copyBatchOutputToClipboard: boolean
  /** Show the CompressO icon in the macOS menu bar (on by default) */
  showMenuBarIcon: boolean
  /**
   * Add files copied to the clipboard to the media dropped on the menu bar (macOS, with the menu
   * bar icon; off by default)
   */
  watchClipboard: boolean
  /** Play a sound when a compression completes (off by default) */
  playCompletionSound: boolean
  /** Audio preview and timeline waveforms, including background analysis (on by default). */
  enableAudioWaveforms: boolean
  /** Translucent, tinted window background (macOS & Windows 11 only, off by default) */
  tintedWindow: boolean
  /** Opacity (%) of the app background over the tinted window's material (both themes) */
  tintOpacity: number
  /**
   * Compress the media dropped on the menu bar (or copied, with `watchClipboard`) right away, one
   * by one, instead of keeping it for the main window (on by default). Needs a save location.
   */
  autoCompress: boolean
  /** Presets of the media compressed by the drop zone (the Standard presets by default) */
  dropZoneVideoPresetId: string
  dropZoneImagePresetId: string
  dropZoneAudioPresetId: string
  /** Folders whose new media the drop zone compresses (none by default) */
  watchedFolders: WatchedFolder[]
  /**
   * Compress videos with hardware acceleration (the graphics card) when it can (off by default):
   * faster, with slightly larger files. Falls back to the CPU when it does not work (see
   * `hardware_encoder.rs`).
   */
  useHardwareAcceleration: boolean
  /**
   * With hardware acceleration, a video that missed its target size is compressed again on the CPU
   * (on by default), which keeps to the size more closely (see `ffmpeg.rs`)
   */
  retryTargetSizeOnCpu: boolean
  /**
   * Play videos in the app (Linux only, off by default: they are played through a local server,
   * which does not work well on every system). Applied when the app starts (see
   * `isVideoPreviewAvailable`).
   */
  enableVideoPreviews: boolean
  /** Keep the computer awake while compressing (on by default); the screen can still turn off */
  preventSleepWhileCompressing: boolean
  /** With `preventSleepWhileCompressing`, also keep the screen on (off by default) */
  keepScreenOnWhileCompressing: boolean
  /**
   * Opened at login, only show the menu bar icon, not the main window (macOS, with the menu bar
   * icon; on by default). Whether the app opens at login is the system's setting, not kept here.
   */
  openInMenuBarOnly: boolean
  /** Language of the interface (Settings -> General), English by default */
  language: LanguageCode
}

// Replaced by `saveLargerOutputs`, which defaults to on
localStorage.removeItem('skipLargerOutputs')

/** Reads the settings from the storage, shared by all windows */
function readSettings(): SettingsState {
  const storedSaveLocation = localStorage.getItem(constants.saveLocation)
  return {
    outputFilePrefix:
      localStorage.getItem(constants.outputFilePrefix) ??
      DEFAULT_OUTPUT_FILE_PREFIX,
    saveLocation:
      storedSaveLocation && storedSaveLocation in saveLocations
        ? (storedSaveLocation as SaveLocation)
        : saveLocations.sameFolder,
    saveFolder: localStorage.getItem(constants.saveFolder),
    // Only an explicit opt-out turns it off
    preserveFolderStructure:
      localStorage.getItem(constants.preserveFolderStructure) !== 'false',
    // Only an explicit opt-out turns it off
    saveLargerOutputs:
      localStorage.getItem(constants.saveLargerOutputs) !== 'false',
    replaceOriginalFiles:
      localStorage.getItem(constants.replaceOriginalFiles) === 'true',
    copyOutputToClipboard:
      localStorage.getItem(constants.copyOutputToClipboard) === 'true',
    copyBatchOutputToClipboard:
      localStorage.getItem(constants.copyBatchOutputToClipboard) !== 'false',
    showMenuBarIcon:
      localStorage.getItem(constants.showMenuBarIcon) !== 'false',
    watchClipboard: localStorage.getItem(constants.watchClipboard) === 'true',
    enableAudioWaveforms:
      localStorage.getItem(constants.enableAudioWaveforms) !== 'false',
    playCompletionSound:
      localStorage.getItem(constants.playCompletionSound) === 'true',
    tintedWindow: localStorage.getItem(constants.tintedWindow) === 'true',
    tintOpacity: readTintOpacity(constants.tintOpacity, DEFAULT_TINT_OPACITY),
    autoCompress: localStorage.getItem(constants.autoCompress) !== 'false',
    dropZoneVideoPresetId:
      localStorage.getItem(constants.dropZoneVideoPresetId) ??
      STANDARD_PRESET_ID,
    dropZoneImagePresetId:
      localStorage.getItem(constants.dropZoneImagePresetId) ??
      STANDARD_PRESET_ID,
    dropZoneAudioPresetId:
      localStorage.getItem(constants.dropZoneAudioPresetId) ??
      STANDARD_PRESET_ID,
    watchedFolders: readWatchedFolders(),
    useHardwareAcceleration:
      localStorage.getItem(constants.useHardwareAcceleration) === 'true',
    // Only an explicit opt-out turns it off
    retryTargetSizeOnCpu:
      localStorage.getItem(constants.retryTargetSizeOnCpu) !== 'false',
    enableVideoPreviews:
      localStorage.getItem(constants.enableVideoPreviews) === 'true',
    // Only an explicit opt-out turns it off
    preventSleepWhileCompressing:
      localStorage.getItem(constants.preventSleepWhileCompressing) !== 'false',
    keepScreenOnWhileCompressing:
      localStorage.getItem(constants.keepScreenOnWhileCompressing) === 'true',
    openInMenuBarOnly:
      localStorage.getItem(constants.openInMenuBarOnly) !== 'false',
    language: readLanguage(),
  }
}

/** The stored watched folders, dropping any that are not valid */
function readWatchedFolders(): WatchedFolder[] {
  try {
    const stored = JSON.parse(
      localStorage.getItem(constants.watchedFolders) ?? '[]',
    )
    return Array.isArray(stored)
      ? stored.filter(
          (folder): folder is WatchedFolder =>
            typeof folder?.id === 'string' &&
            typeof folder?.path === 'string' &&
            typeof folder?.isEnabled === 'boolean',
        )
      : []
  } catch {
    return []
  }
}

/** The stored language, or English when none (or an unknown one) is stored */
function readLanguage(): LanguageCode {
  const stored = localStorage.getItem(constants.language)
  return isLanguageCode(stored) ? stored : 'en'
}

export const settingsStore = proxy<SettingsState>(readSettings())

// Changed in another window (e.g. the main window's settings, read by the menu bar's)
window.addEventListener('storage', (evt) => {
  if (evt.storageArea !== localStorage) return
  const settings = readSettings()
  for (const key of Object.keys(settings) as (keyof SettingsState)[]) {
    // Compared by value, as lists (e.g. the watched folders) are read anew
    if (!isEqual(settingsStore[key], settings[key])) {
      ;(settingsStore as Record<string, unknown>)[key] = settings[key]
    }
  }
})

subscribe(settingsStore, () => {
  localStorage.setItem(constants.language, settingsStore.language)
  localStorage.setItem(
    constants.outputFilePrefix,
    settingsStore.outputFilePrefix,
  )
  localStorage.setItem(constants.saveLocation, settingsStore.saveLocation)
  localStorage.setItem(
    constants.preserveFolderStructure,
    String(settingsStore.preserveFolderStructure),
  )
  localStorage.setItem(
    constants.saveLargerOutputs,
    String(settingsStore.saveLargerOutputs),
  )
  localStorage.setItem(
    constants.replaceOriginalFiles,
    String(settingsStore.replaceOriginalFiles),
  )
  localStorage.setItem(
    constants.copyOutputToClipboard,
    String(settingsStore.copyOutputToClipboard),
  )
  localStorage.setItem(
    constants.copyBatchOutputToClipboard,
    String(settingsStore.copyBatchOutputToClipboard),
  )
  localStorage.setItem(
    constants.showMenuBarIcon,
    String(settingsStore.showMenuBarIcon),
  )
  localStorage.setItem(
    constants.watchClipboard,
    String(settingsStore.watchClipboard),
  )
  localStorage.setItem(
    constants.enableAudioWaveforms,
    String(settingsStore.enableAudioWaveforms),
  )
  localStorage.setItem(
    constants.playCompletionSound,
    String(settingsStore.playCompletionSound),
  )
  localStorage.setItem(
    constants.tintedWindow,
    String(settingsStore.tintedWindow),
  )
  localStorage.setItem(constants.tintOpacity, String(settingsStore.tintOpacity))
  localStorage.setItem(
    constants.autoCompress,
    String(settingsStore.autoCompress),
  )
  localStorage.setItem(
    constants.dropZoneVideoPresetId,
    settingsStore.dropZoneVideoPresetId,
  )
  localStorage.setItem(
    constants.dropZoneImagePresetId,
    settingsStore.dropZoneImagePresetId,
  )
  localStorage.setItem(
    constants.dropZoneAudioPresetId,
    settingsStore.dropZoneAudioPresetId,
  )
  localStorage.setItem(
    constants.watchedFolders,
    JSON.stringify(settingsStore.watchedFolders),
  )
  localStorage.setItem(
    constants.useHardwareAcceleration,
    String(settingsStore.useHardwareAcceleration),
  )
  localStorage.setItem(
    constants.retryTargetSizeOnCpu,
    String(settingsStore.retryTargetSizeOnCpu),
  )
  localStorage.setItem(
    constants.enableVideoPreviews,
    String(settingsStore.enableVideoPreviews),
  )
  localStorage.setItem(
    constants.preventSleepWhileCompressing,
    String(settingsStore.preventSleepWhileCompressing),
  )
  localStorage.setItem(
    constants.keepScreenOnWhileCompressing,
    String(settingsStore.keepScreenOnWhileCompressing),
  )
  localStorage.setItem(
    constants.openInMenuBarOnly,
    String(settingsStore.openInMenuBarOnly),
  )
  if (settingsStore.saveFolder) {
    localStorage.setItem(constants.saveFolder, settingsStore.saveFolder)
  } else {
    localStorage.removeItem(constants.saveFolder)
  }
})

/** Removes characters that aren't allowed in file names */
export function sanitizeFileNamePart(value: string) {
  return value.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '')
}
