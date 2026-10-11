import { proxy, subscribe } from 'valtio'

import * as constants from '@/constants'

export const DEFAULT_OUTPUT_FILE_PREFIX = 'compressO-'

export const saveLocations = {
  /** Choose where to save after every compression */
  ask: 'ask',
  /** Save automatically to `saveFolder` */
  fixedFolder: 'fixedFolder',
  /** Save automatically next to the original (or next to the dropped folder) */
  sameFolder: 'sameFolder',
} as const

export type SaveLocation = keyof typeof saveLocations

export type SettingsState = {
  /** Added to the start of saved file (and top folder) names. Empty keeps the original names. */
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
}

const storedSaveLocation = localStorage.getItem(constants.saveLocation)

// Replaced by `saveLargerOutputs`, which defaults to on
localStorage.removeItem('skipLargerOutputs')

export const settingsStore = proxy<SettingsState>({
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
