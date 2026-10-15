import { useEffect } from 'react'
import { subscribe } from 'valtio'

import { settingsStore } from '@/stores/settingsStore'
import { setAutoCompressEnabled } from '@/tauri/commands/dropQueue'
import { getPlatform } from '@/utils/fs'

const { isMacOS } = getPlatform()

/**
 * Whether the drop zone compresses automatically (Settings -> Drop Zone): only with a save location,
 * as nothing can ask where to save
 */
export function isAutoCompressAvailable({
  saveLocation,
  saveFolder,
}: Pick<typeof settingsStore, 'saveLocation' | 'saveFolder'> = settingsStore) {
  return (
    saveLocation === 'sameFolder' ||
    (saveLocation === 'fixedFolder' && !!saveFolder)
  )
}

/** Tells the backend whether dropped media is queued for compression (see `drop_queue.rs`) */
export function useAutoCompressSync() {
  useEffect(() => {
    if (!isMacOS) return
    let isEnabled: boolean | null = null
    const apply = () => {
      const shouldEnable =
        settingsStore.autoCompress && isAutoCompressAvailable()
      if (shouldEnable === isEnabled) return
      isEnabled = shouldEnable
      setAutoCompressEnabled(shouldEnable).catch(() => {})
    }
    apply()
    return subscribe(settingsStore, apply)
  }, [])
}
