import { useEffect, useState } from 'react'
import { subscribeKey } from 'valtio/utils'

import { whenCoreStateReady } from '@/hooks/useCoreStateSync'
import { settingsStore } from '@/stores/settingsStore'
import {
  getHardwareEncoders,
  setHardwareEncodingEnabled,
} from '@/tauri/commands/hardwareEncoder'

/**
 * Tells the backend whether to use hardware acceleration (Settings -> General), in every
 * window that compresses (the main window & the menu bar's)
 */
export function useHardwareEncodingSync() {
  useEffect(() => {
    let isMounted = true
    let isReady = false
    const apply = () => {
      if (!isMounted || !isReady) return
      setHardwareEncodingEnabled(settingsStore.useHardwareAcceleration).catch(
        () => {},
      )
    }
    whenCoreStateReady().then(() => {
      isReady = true
      apply()
    })
    const unsubscribe = subscribeKey(
      settingsStore,
      'useHardwareAcceleration',
      apply,
    )
    return () => {
      isMounted = false
      unsubscribe()
    }
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
