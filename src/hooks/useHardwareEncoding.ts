import { useEffect, useState } from 'react'
import { subscribeKey } from 'valtio/utils'

import { settingsStore } from '@/stores/settingsStore'
import {
  getHardwareEncoders,
  setHardwareEncodingEnabled,
} from '@/tauri/commands/hardwareEncoder'

/**
 * Tells the backend whether to use hardware acceleration (Settings -> Output), in every
 * window that compresses (the main window & the menu bar's)
 */
export function useHardwareEncodingSync() {
  useEffect(() => {
    const apply = () => {
      setHardwareEncodingEnabled(settingsStore.useHardwareAcceleration).catch(
        () => {},
      )
    }
    apply()
    return subscribeKey(settingsStore, 'useHardwareAcceleration', apply)
  }, [])
}

/**
 * The graphics card's video encoders that work on this computer; `null` until they are found, empty
 * without any
 */
export function useHardwareEncoders() {
  const [encoders, setEncoders] = useState<string[] | null>(null)

  useEffect(() => {
    let isMounted = true
    getHardwareEncoders()
      .then((found) => {
        if (isMounted) setEncoders(found)
      })
      .catch(() => {
        if (isMounted) setEncoders([])
      })
    return () => {
      isMounted = false
    }
  }, [])

  return encoders
}
