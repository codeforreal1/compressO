import { useEffect } from 'react'
import { subscribe, useSnapshot } from 'valtio'

import { presetsStore } from '@/stores/presetsStore'
import { settingsStore, type WatchedFolder } from '@/stores/settingsStore'
import {
  setAutoCompressEnabled,
  setWatchedFolders,
} from '@/tauri/commands/dropQueue'
import { inputExtensions } from '@/types/compression'
import {
  DROP_ZONE_PRESET_SETTINGS,
  getPresetOutput,
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
  presets: typeof presetsStore.presets = presetsStore.presets,
) {
  return Object.values(DROP_ZONE_PRESET_SETTINGS).some((settingKey) =>
    savesAutomatically(
      getPresetOutput(settings[settingKey], { presets, settings }),
    ),
  )
}

/** `isAutoCompressAvailable`, updated when the settings or presets it depends on change */
export function useIsAutoCompressAvailable() {
  const settings = useSnapshot(settingsStore)
  const { presets } = useSnapshot(presetsStore)
  return isAutoCompressAvailable(
    settings as typeof settingsStore,
    presets as typeof presetsStore.presets,
  )
}

/**
 * Whether a watched folder's media can be saved: when each of its presets (Standard by default)
 * saves without asking where, as nothing can ask
 */
export function canWatchedFolderSave(
  folder: Pick<WatchedFolder, 'presetIds'>,
  settings: typeof settingsStore = settingsStore,
  presets: typeof presetsStore.presets = presetsStore.presets,
) {
  return (['video', 'image', 'audio'] as const).every((mediaType) =>
    savesAutomatically(
      getPresetOutput(folder.presetIds?.[mediaType], { presets, settings }),
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
