import isEqual from 'lodash/isEqual'
import { proxy, snapshot, subscribe } from 'valtio'

import * as constants from '@/constants'
import {
  type Preset,
  type PresetMediaType,
  type PresetOutput,
  STANDARD_PRESET_ID,
} from '@/types/preset'

const PRESETS_SCHEMA_VERSION = 1

export type PresetsState = {
  /** Presets created by the user, in the order they are listed (the Standard preset is not stored) */
  presets: Preset[]
  /** Preset of each media type applied to newly added media (the Standard preset unless set) */
  defaultPresetIds: Record<PresetMediaType, string>
}

type StoredPresets = PresetsState & { schemaVersion: number }

function isValidPreset(preset: unknown): preset is Preset {
  const value = preset as Partial<Preset> | null
  return (
    !!value &&
    typeof value.id === 'string' &&
    value.id !== STANDARD_PRESET_ID &&
    typeof value.name === 'string' &&
    (value.mediaType === 'video' ||
      value.mediaType === 'image' ||
      value.mediaType === 'audio') &&
    typeof value.settings === 'object' &&
    value.settings != null
  )
}

function isValidOutput(output: unknown): output is PresetOutput {
  const value = output as Partial<PresetOutput> | null
  return (
    !!value &&
    (value.saveLocation === 'ask' ||
      value.saveLocation === 'fixedFolder' ||
      value.saveLocation === 'sameFolder') &&
    (value.saveFolder === null || typeof value.saveFolder === 'string') &&
    typeof value.filePrefix === 'string'
  )
}

/** Reads the stored presets, dropping anything that is not a valid preset */
function readPresets(): PresetsState {
  const fallback: PresetsState = {
    presets: [],
    defaultPresetIds: {
      video: STANDARD_PRESET_ID,
      image: STANDARD_PRESET_ID,
      audio: STANDARD_PRESET_ID,
    },
  }
  try {
    const stored = JSON.parse(
      localStorage.getItem(constants.presets) ?? 'null',
    ) as Partial<StoredPresets> | null
    if (!stored || stored.schemaVersion !== PRESETS_SCHEMA_VERSION) {
      return fallback
    }
    const presets = (Array.isArray(stored.presets) ? stored.presets : [])
      .filter(isValidPreset)
      // An output that is not valid is dropped (the preset follows the Standard preset's)
      .map((preset) =>
        preset.output && !isValidOutput(preset.output)
          ? { ...preset, output: null }
          : preset,
      )
    const getDefaultPresetId = (mediaType: PresetMediaType) => {
      const id = stored.defaultPresetIds?.[mediaType]
      return presets.some(
        (preset) => preset.id === id && preset.mediaType === mediaType,
      )
        ? id!
        : STANDARD_PRESET_ID
    }
    return {
      presets,
      defaultPresetIds: {
        video: getDefaultPresetId('video'),
        image: getDefaultPresetId('image'),
        audio: getDefaultPresetId('audio'),
      },
    }
  } catch {
    return fallback
  }
}

export const presetsStore = proxy<PresetsState>(readPresets())

// Changed in another window (e.g. saved in the main window, used by the menu bar's)
window.addEventListener('storage', (evt) => {
  if (evt.storageArea !== localStorage || evt.key !== constants.presets) return
  const { presets, defaultPresetIds } = readPresets()
  if (!isEqual(presets, snapshot(presetsStore).presets)) {
    presetsStore.presets = presets
  }
  if (!isEqual(defaultPresetIds, snapshot(presetsStore).defaultPresetIds)) {
    presetsStore.defaultPresetIds = defaultPresetIds
  }
})

subscribe(presetsStore, () => {
  const stored: StoredPresets = {
    schemaVersion: PRESETS_SCHEMA_VERSION,
    presets: presetsStore.presets,
    defaultPresetIds: presetsStore.defaultPresetIds,
  }
  localStorage.setItem(constants.presets, JSON.stringify(stored))
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
  const names = new Set(
    presetsStore.presets
      .filter((preset) => preset.mediaType === mediaType)
      .map((preset) => preset.name.toLowerCase()),
  )
  names.add('standard')
  if (!names.has(name.toLowerCase())) return name
  let count = 2
  while (names.has(`${name} (${count})`.toLowerCase())) count++
  return `${name} (${count})`
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
