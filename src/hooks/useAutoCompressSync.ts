import { useEffect } from 'react'
import { subscribe, useSnapshot } from 'valtio'

import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import { setAutoCompressEnabled } from '@/tauri/commands/dropQueue'
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
