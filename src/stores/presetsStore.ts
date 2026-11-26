import isEqual from 'lodash/isEqual'
import { proxy, snapshot, subscribe } from 'valtio'

import * as constants from '@/constants'
import { logError, logInfo } from '@/tauri/commands/app'
import { type PresetMediaType, STANDARD_PRESET_ID } from '@/types/preset'
import {
  loadPresetsWithMigration,
  type PresetsStateData,
  serializePresetContracts,
} from './presetMigration'
import {
  createPresetInState,
  deletePresetInState,
  getAvailablePresetNameInList,
  resolvePresetRef,
  setDefaultPresetInState,
  updatePresetInState,
  type WatchedFolderLike,
} from './presetOperations'

export type PresetsState = PresetsStateData

function persistContracts(state: PresetsStateData) {
  try {
    localStorage.setItem(
      constants.presetContracts,
      JSON.stringify(serializePresetContracts(state)),
    )
  } catch (error) {
    logError('[presets] Could not persist preset contracts to storage', error)
  }
}

/** Reads v2 contract-backed presets, or migrates v1 presets without deleting the old key */
function readPresets(): PresetsState {
  const { state, migratedFromLegacy } = loadPresetsWithMigration(
    localStorage.getItem(constants.presetContracts),
    localStorage.getItem(constants.presets),
  )
  if (migratedFromLegacy) {
    logInfo(
      `[presets] Migrated ${state.presets.length} legacy preset(s) to v2 contracts`,
    )
    persistContracts(state)
  }
  return state
}

export const presetsStore = proxy<PresetsState>(readPresets())

// Changed in another window (e.g. saved in the main window, used by the menu bar's)
window.addEventListener('storage', (evt) => {
  if (
    evt.storageArea !== localStorage ||
    evt.key !== constants.presetContracts
  ) {
    return
  }
  const { presets, defaultPresetIds } = readPresets()
  if (!isEqual(presets, snapshot(presetsStore).presets)) {
    presetsStore.presets = presets
  }
  if (!isEqual(defaultPresetIds, snapshot(presetsStore).defaultPresetIds)) {
    presetsStore.defaultPresetIds = defaultPresetIds
  }
})

subscribe(presetsStore, () => {
  persistContracts(presetsStore)
})

/** A preset created by the user (`undefined` for the Standard preset or a deleted one) */
export function getStoredPreset(id: string | null | undefined) {
  return presetsStore.presets.find((preset) => preset.id === id)
}

export function generatePresetId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A name that is not used by another preset of the media type, e.g. `Web (2)` */
export function getAvailablePresetName(
  name: string,
  mediaType: PresetMediaType,
) {
  return getAvailablePresetNameInList(presetsStore.presets, name, mediaType)
}

export function deletePreset(id: string) {
  const preset = getStoredPreset(id)
  if (!preset) return
  presetsStore.presets = presetsStore.presets.filter((p) => p.id !== id)
  if (presetsStore.defaultPresetIds[preset.mediaType] === id) {
    presetsStore.defaultPresetIds[preset.mediaType] = STANDARD_PRESET_ID
  }
}

/** Moves a preset up (-1) or down (1) among the presets of its media type */
export function movePreset(id: string, direction: -1 | 1) {
  const preset = getStoredPreset(id)
  if (!preset) return
  const sameTypeIndexes = presetsStore.presets
    .map((p, index) => (p.mediaType === preset.mediaType ? index : -1))
    .filter((index) => index >= 0)
  const position = sameTypeIndexes.indexOf(presetsStore.presets.indexOf(preset))
  const targetIndex = sameTypeIndexes[position + direction]
  if (targetIndex == null) return
  const presets = [...presetsStore.presets]
  const currentIndex = sameTypeIndexes[position]
  ;[presets[currentIndex], presets[targetIndex]] = [
    presets[targetIndex],
    presets[currentIndex],
  ]
  presetsStore.presets = presets
}

/** Makes a preset the one applied to newly added media of its type */
export function setDefaultPreset(mediaType: PresetMediaType, id: string) {
  presetsStore.defaultPresetIds[mediaType] = id
}

export function createPresetFromContract(
  rawContract: unknown,
  options?: Parameters<typeof createPresetInState>[2],
) {
  return createPresetInState(presetsStore, rawContract, options)
}

export function updatePresetFromContract(
  ref: string,
  patchOrContract: unknown,
  options?: Parameters<typeof updatePresetInState>[3],
) {
  return updatePresetInState(presetsStore, ref, patchOrContract, options)
}

export function deletePresetByRef(
  ref: string,
  options?: {
    mediaType?: PresetMediaType
    watchedFolders?: readonly WatchedFolderLike[]
  },
) {
  return deletePresetInState(presetsStore, ref, options)
}

export function setDefaultPresetByRef(ref: string, mediaType: PresetMediaType) {
  return setDefaultPresetInState(presetsStore, ref, mediaType)
}

export function findPresetByRef(ref: string, mediaType?: PresetMediaType) {
  return resolvePresetRef(presetsStore.presets, ref, mediaType)
}
