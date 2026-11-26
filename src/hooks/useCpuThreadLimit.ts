import { useEffect, useState } from 'react'
import { subscribeKey } from 'valtio/utils'

import { settingsStore } from '@/stores/settingsStore'
import { getCpuThreadCount, setCpuThreadLimit } from '@/tauri/commands/cpu'

/**
 * Tells the backend how many CPU threads FFmpeg may use (Settings -> General), in every window that
 * compresses (the main window & the menu bar's)
 */
export function useCpuThreadLimitSync() {
  useEffect(() => {
    const apply = () => {
      setCpuThreadLimit(settingsStore.cpuThreadLimit ?? 0).catch(() => {})
    }
    apply()
    return subscribeKey(settingsStore, 'cpuThreadLimit', apply)
  }, [])
}

/** The CPU threads available to FFmpeg (logical processors), `null` until they are read */
export function useCpuThreadCount() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let isMounted = true
    getCpuThreadCount()
      .then((threads) => {
        if (isMounted) setCount(Math.max(1, Math.round(threads)))
      })
      .catch(() => {
        if (isMounted) setCount(1)
      })
    return () => {
      isMounted = false
    }
  }, [])

  return count
}
