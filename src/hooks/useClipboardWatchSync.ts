import { event } from '@tauri-apps/api'
import { useEffect } from 'react'
import { subscribeKey } from 'valtio/utils'

import { settingsStore } from '@/stores/settingsStore'
import {
  CLIPBOARD_WATCH_EVENT,
  isClipboardWatchEnabled,
  setClipboardWatchEnabled,
} from '@/tauri/commands/tray'
import { getPlatform } from '@/utils/fs'

const { isMacOS } = getPlatform()

/**
 * Keeps the "Watch clipboard" setting in sync with the backend, which watches the clipboard, and
 * with the other window (it can be switched in the settings & in the menu bar popover). The main
 * window applies the saved setting on launch (`applyOnMount`); others take the backend's.
 */
export function useClipboardWatchSync({
  applyOnMount,
}: {
  applyOnMount: boolean
}) {
  useEffect(() => {
    if (!isMacOS) return

    let isMounted = true
    let unlisten: event.UnlistenFn | undefined
    ;(async () => {
      unlisten = await event.listen<boolean>(CLIPBOARD_WATCH_EVENT, (evt) => {
        if (settingsStore.watchClipboard !== evt.payload) {
          settingsStore.watchClipboard = evt.payload
        }
      })
      if (!isMounted) {
        unlisten()
        return
      }
      if (applyOnMount) {
        setClipboardWatchEnabled(settingsStore.watchClipboard).catch(() => {})
      } else {
        const isEnabled = await isClipboardWatchEnabled().catch(() => null)
        if (isMounted && isEnabled != null) {
          settingsStore.watchClipboard = isEnabled
        }
      }
    })()

    const unsubscribe = subscribeKey(
      settingsStore,
      'watchClipboard',
      (value) => {
        setClipboardWatchEnabled(value).catch(() => {})
      },
    )
    return () => {
      isMounted = false
      unlisten?.()
      unsubscribe()
    }
  }, [applyOnMount])
}
