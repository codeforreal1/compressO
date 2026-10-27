import { useEffect } from 'react'
import { subscribe, useSnapshot } from 'valtio'

import { presetsStore } from '@/stores/presetsStore'
import { settingsStore, type WatchedFolder } from '@/stores/settingsStore'
import {
  setAutoCompressEnabled,
  setWatchedFolders,
} from '@/tauri/commands/dropQueue'
import { inputExtensions } from '@/types/compression'
import type { PresetMediaType } from '@/types/preset'
import {
  DROP_ZONE_PRESET_SETTINGS,
  getPresetOutput,
  type PresetsState,
  resolvePresetChoice,
  savesAutomatically,
} from '@/utils/presetOutput'
import { hasTray } from '@/utils/tray'

/**
 * Whether the drop zone can compress automatically (Settings -> Drop Zone): when one of its presets
 * saves without asking where (nothing can ask). Media of a preset that asks are left to be saved
 * from the queue.
 */
export function isAutoCompressAvailable(
  settings: typeof settingsStore = settingsStore,
  presetsState: PresetsState = presetsStore,
) {
  return (
    Object.entries(DROP_ZONE_PRESET_SETTINGS) as [
      PresetMediaType,
      (typeof DROP_ZONE_PRESET_SETTINGS)[PresetMediaType],
    ][]
  ).some(([mediaType, settingKey]) =>
    savesAutomatically(
      getPresetOutput(
        resolvePresetChoice(settings[settingKey], mediaType, presetsState),
        { presets: presetsState.presets, settings },
      ),
    ),
  )
}

/** `isAutoCompressAvailable`, updated when the settings or presets it depends on change */
export function useIsAutoCompressAvailable() {
  const settings = useSnapshot(settingsStore)
  const presetsState = useSnapshot(presetsStore)
  return isAutoCompressAvailable(
    settings as typeof settingsStore,
    presetsState as PresetsState,
  )
}

/**
 * Whether a watched folder's media can be saved: when each of its presets (Default unless chosen)
 * saves without asking where, as nothing can ask
 */
export function canWatchedFolderSave(
  folder: Pick<WatchedFolder, 'presetIds'>,
  settings: typeof settingsStore = settingsStore,
  presetsState: PresetsState = presetsStore,
) {
  return (['video', 'image', 'audio'] as const).every((mediaType) =>
    savesAutomatically(
      getPresetOutput(
        resolvePresetChoice(
          folder.presetIds?.[mediaType],
          mediaType,
          presetsState,
        ),
        { presets: presetsState.presets, settings },
      ),
    ),
  )
}

/** Tells the backend whether dropped media is queued for compression (see `drop_queue.rs`) */
export function useAutoCompressSync() {
  useEffect(() => {
    if (!hasTray) return
    let isEnabled: boolean | null = null
    const apply = () => {
      const shouldEnable =
        settingsStore.autoCompress && isAutoCompressAvailable()
      if (shouldEnable === isEnabled) return
      isEnabled = shouldEnable
      setAutoCompressEnabled(shouldEnable).catch(() => {})
    }
    apply()
    // The drop zone's presets, & their outputs (or the Standard one, in the settings)
    const unsubscribeSettings = subscribe(settingsStore, apply)
    const unsubscribePresets = subscribe(presetsStore, apply)
    return () => {
      unsubscribeSettings()
      unsubscribePresets()
    }
  }, [])
}

/** A folder's name, e.g. `Screenshots` for `/Users/me/Desktop/Screenshots` */
export function getFolderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** Media the watched folders pick up: what can be compressed */
const WATCHED_EXTENSIONS = [
  ...inputExtensions.video,
  ...inputExtensions.image,
  ...inputExtensions.audio,
]

/**
 * Tells the backend which folders to watch (Settings -> Watched folders): the enabled ones whose
 * media can be saved, while it can be compressed: with the menu bar's (or tray's) icon on macOS &
 * Windows, whose window compresses it, & always on Linux, where the main window does
 */
export function useWatchedFoldersSync() {
  useEffect(() => {
    let sent: string | null = null
    const apply = () => {
      const folders =
        !hasTray || settingsStore.showMenuBarIcon
          ? settingsStore.watchedFolders
              .filter(
                (folder) => folder.isEnabled && canWatchedFolderSave(folder),
              )
              .map((folder) => ({
                id: folder.id,
                path: folder.path,
                name: getFolderName(folder.path),
              }))
          : []
      const next = JSON.stringify(folders)
      if (next === sent) return
      sent = next
      setWatchedFolders(folders, WATCHED_EXTENSIONS).catch(() => {})
    }
    apply()
    // The folders, & their presets' outputs (or the Standard one, in the settings)
    const unsubscribeSettings = subscribe(settingsStore, apply)
    const unsubscribePresets = subscribe(presetsStore, apply)
    return () => {
      unsubscribeSettings()
      unsubscribePresets()
    }
  }, [])
}
