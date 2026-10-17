import { event } from '@tauri-apps/api'
import { useEffect, useState } from 'react'

import {
  DROP_QUEUE_EVENT,
  DROP_QUEUE_PAUSED_EVENT,
  type DropQueueItem,
  getDropQueue,
  isDropQueuePaused,
} from '@/tauri/commands/dropQueue'
import { hasTray } from '@/utils/tray'

/**
 * The drop zone's queue (macOS), kept up to date by the backend; the same in every window (the
 * menu bar's & the main window's)
 */
export function useDropQueue() {
  const [items, setItems] = useState<DropQueueItem[]>([])

  useEffect(() => {
    if (!hasTray) return
    let unlisten: event.UnlistenFn | undefined
    let isMounted = true
    ;(async () => {
      unlisten = await event.listen<DropQueueItem[]>(DROP_QUEUE_EVENT, (evt) =>
        setItems(evt.payload),
      )
      // Unmounted while the listener was being added
      if (!isMounted) {
        unlisten()
        return
      }
      const currentItems = await getDropQueue().catch(() => null)
      if (isMounted && currentItems) setItems(currentItems)
    })()
    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [])

  return items
}

/** Whether the drop zone's queue is paused (see `setDropQueuePaused`), the same in every window */
export function useDropQueuePaused() {
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    if (!hasTray) return
    let unlisten: event.UnlistenFn | undefined
    let isMounted = true
    ;(async () => {
      unlisten = await event.listen<boolean>(DROP_QUEUE_PAUSED_EVENT, (evt) =>
        setIsPaused(evt.payload),
      )
      if (!isMounted) {
        unlisten()
        return
      }
      const paused = await isDropQueuePaused().catch(() => null)
      if (isMounted && paused != null) setIsPaused(paused)
    })()
    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [])

  return isPaused
}
