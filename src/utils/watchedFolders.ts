import type { WatchedFolder } from '@/stores/settingsStore'
import type { WatchedFolderChoice } from '@/tauri/commands/watchedFolders'
import {
  DEFAULT_PRESET_CHOICE,
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import { getPresetChoice } from '@/utils/presetOutput'

export const WATCHED_FOLDER_MEDIA_TYPES: PresetMediaType[] = [
  'video',
  'image',
  'audio',
]

/** A folder path without trailing separators, for comparing folders added with or without one */
export function normalizeWatchedFolderPath(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  return trimmed || path
}

/** A filesystem root, which is not watched (it would scan the whole computer) */
export function isWatchedFolderRoot(path: string) {
  const normalized = normalizeWatchedFolderPath(path)
  return normalized === '/' || /^[A-Za-z]:[\\/]?$/.test(normalized)
}

/** A new watched folder's id, like the ones the Settings page makes */
export function generateWatchedFolderId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The watched folders as the command line sees them (`default` for a media type without a preset) */
export function getWatchedFolderChoices(
  folders: readonly WatchedFolder[],
  presets: readonly Preset[],
): WatchedFolderChoice[] {
  return folders.map((folder) => ({
    id: folder.id,
    path: folder.path,
    isEnabled: folder.isEnabled,
    presetIds: {
      video: getPresetChoice(folder.presetIds?.video, 'video', presets),
      image: getPresetChoice(folder.presetIds?.image, 'image', presets),
      audio: getPresetChoice(folder.presetIds?.audio, 'audio', presets),
    },
  }))
}

/** A folder by id (preferred) or exact path */
export function findWatchedFolder(
  folders: readonly WatchedFolder[],
  { id, path }: { id?: string; path?: string },
) {
  if (id) {
    return folders.find((folder) => folder.id === id)
  }
  if (!path) {
    return undefined
  }
  const wanted = normalizeWatchedFolderPath(path)
  return folders.find(
    (folder) => normalizeWatchedFolderPath(folder.path) === wanted,
  )
}

/**
 * A watched folder's preset choice, normalized to `default`, Standard's id or one of the presets
 * of its media type. `null` when there is no such preset.
 */
export function resolveWatchedFolderPresetId(
  value: string,
  mediaType: PresetMediaType,
  presets: readonly Preset[],
) {
  const wanted = value.trim()
  if (!wanted || wanted.toLowerCase() === DEFAULT_PRESET_CHOICE) {
    return DEFAULT_PRESET_CHOICE
  }
  if (wanted === STANDARD_PRESET_ID || wanted.toLowerCase() === 'standard') {
    return STANDARD_PRESET_ID
  }
  return (
    presets.find(
      (preset) =>
        preset.mediaType === mediaType &&
        (preset.id === wanted ||
          preset.name.toLowerCase() === wanted.toLowerCase()),
    )?.id ?? null
  )
}

/** The presets a watched folder can choose for a media type, for error messages */
export function getWatchedFolderPresetNames(
  mediaType: PresetMediaType,
  presets: readonly Preset[],
) {
  return [
    'Standard',
    ...presets
      .filter((preset) => preset.mediaType === mediaType)
      .map((preset) => preset.name),
  ]
}
