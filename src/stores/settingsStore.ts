import { proxy, subscribe } from 'valtio'

import * as constants from '@/constants'
import { STANDARD_PRESET_ID } from '@/types/preset'

export const DEFAULT_OUTPUT_FILE_PREFIX = 'compressO-'

export const saveLocations = {
  /** Choose where to save after every compression */
  ask: 'ask',
  /** Save automatically to `saveFolder` */
  fixedFolder: 'fixedFolder',
  /** Save automatically next to the original (or next to the dropped folder) */
  sameFolder: 'sameFolder',
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

export type SettingsState = {
  /** Added to the start of saved file names (not folders). Empty keeps the original names. */
  outputFilePrefix: string
  saveLocation: SaveLocation
  /** Folder used when `saveLocation` is `fixedFolder` */
  saveFolder: string | null
  /**
   * Auto-save outputs even when they are larger than their original (on by default). When off,
   * such outputs are left for the Save button.
   */
  saveLargerOutputs: boolean
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
  /** Translucent, tinted window background (macOS & Windows 11 only, off by default) */
  tintedWindow: boolean
  /** Opacity (%) of the app background over the tinted window's material (both themes) */
  tintOpacity: number
  /**
   * Compress the media dropped on the menu bar (or copied, with `watchClipboard`) right away, one
   * by one, instead of keeping it for the main window (off by default). Needs a save location.
   */
  autoCompress: boolean
  /** Presets of the media compressed by the drop zone (the Standard presets by default) */
  dropZoneVideoPresetId: string
  dropZoneImagePresetId: string
  /**
   * Compress videos with hardware acceleration (the graphics card) when it can (off by default):
   * faster, with slightly larger files. Falls back to the CPU when it does not work (see
   * `hardware_encoder.rs`).
   */
  useHardwareAcceleration: boolean
  /**
   * Play videos in the app (Linux only, off by default: they are played through a local server,
   * which does not work well on every system). Applied when the app starts (see
   * `isVideoPreviewAvailable`).
   */
  enableVideoPreviews: boolean
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
        : saveLocations.ask,
    saveFolder: localStorage.getItem(constants.saveFolder),
    // Only an explicit opt-out turns it off
    saveLargerOutputs:
      localStorage.getItem(constants.saveLargerOutputs) !== 'false',
    copyOutputToClipboard:
      localStorage.getItem(constants.copyOutputToClipboard) === 'true',
    copyBatchOutputToClipboard:
      localStorage.getItem(constants.copyBatchOutputToClipboard) !== 'false',
    showMenuBarIcon:
      localStorage.getItem(constants.showMenuBarIcon) !== 'false',
    watchClipboard: localStorage.getItem(constants.watchClipboard) === 'true',
    playCompletionSound:
      localStorage.getItem(constants.playCompletionSound) === 'true',
    tintedWindow: localStorage.getItem(constants.tintedWindow) === 'true',
    tintOpacity: readTintOpacity(constants.tintOpacity, DEFAULT_TINT_OPACITY),
    autoCompress: localStorage.getItem(constants.autoCompress) === 'true',
    dropZoneVideoPresetId:
      localStorage.getItem(constants.dropZoneVideoPresetId) ??
      STANDARD_PRESET_ID,
    dropZoneImagePresetId:
      localStorage.getItem(constants.dropZoneImagePresetId) ??
      STANDARD_PRESET_ID,
    useHardwareAcceleration:
      localStorage.getItem(constants.useHardwareAcceleration) === 'true',
    enableVideoPreviews:
      localStorage.getItem(constants.enableVideoPreviews) === 'true',
  }
}

export const settingsStore = proxy<SettingsState>(readSettings())

// Changed in another window (e.g. the main window's settings, read by the menu bar's)
window.addEventListener('storage', (evt) => {
  if (evt.storageArea !== localStorage) return
  const settings = readSettings()
  for (const key of Object.keys(settings) as (keyof SettingsState)[]) {
    if (settingsStore[key] !== settings[key]) {
      ;(settingsStore as Record<string, unknown>)[key] = settings[key]
    }
  }
})

subscribe(settingsStore, () => {
  localStorage.setItem(
    constants.outputFilePrefix,
    settingsStore.outputFilePrefix,
  )
  localStorage.setItem(constants.saveLocation, settingsStore.saveLocation)
  localStorage.setItem(
    constants.saveLargerOutputs,
    String(settingsStore.saveLargerOutputs),
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
    constants.useHardwareAcceleration,
    String(settingsStore.useHardwareAcceleration),
  )
  localStorage.setItem(
    constants.enableVideoPreviews,
    String(settingsStore.enableVideoPreviews),
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
