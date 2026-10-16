import { useEffect } from 'react'
import { subscribe } from 'valtio'

import { settingsStore } from '@/stores/settingsStore'
import { setKeepAwakeSettings } from '@/tauri/commands/app'

/**
 * Tells the backend whether to keep the computer (and the screen) awake while compressing
 * (Settings -> General), in every window that compresses (the main window & the menu bar's)
 */
export function useKeepAwakeSync() {
  useEffect(() => {
    let lastSent: string | null = null
    const apply = () => {
      const { preventSleepWhileCompressing, keepScreenOnWhileCompressing } =
        settingsStore
      const keepDisplayOn =
        preventSleepWhileCompressing && keepScreenOnWhileCompressing
      const next = `${preventSleepWhileCompressing}-${keepDisplayOn}`
      if (next === lastSent) return
      lastSent = next
      setKeepAwakeSettings(preventSleepWhileCompressing, keepDisplayOn).catch(
        () => {},
      )
    }
    apply()
    return subscribe(settingsStore, apply)
  }, [])
}
