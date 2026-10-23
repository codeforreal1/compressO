import { core } from '@tauri-apps/api'

/** Sent to every window with the whole queue when it changes */
export const DROP_QUEUE_EVENT = 'drop-queue-changed'

export type DropQueueItemStatus =
  | 'waiting'
  | 'compressing'
  | 'done'
  | 'failed'
  /** Stopped, or never compressed (see `cancelDropQueue`) */
  | 'cancelled'

/**
 * Media dropped on the menu bar (or copied) while "Compress automatically" is on, compressed one
 * by one by the menu bar popover (see `drop_queue.rs`)
 */
export type DropQueueItem = {
  id: string
  path: string
  /** Folder of the file relative to the dropped folder (e.g. `Vacation/Day1`), empty for a file */
  relativeDir: string
  /** Media added together (e.g. the files of a dropped folder) share it */
  groupId: string
  status: DropQueueItemStatus
  /**
   * Media is compressed in this order (the lowest first); the queue keeps the order it was added
   * in (media tried again stays in its place)
   */
  queueOrder: number
  /** 0 to 100, while compressing */
  progress: number
  originalSize: number | null
  outputSize: number | null
  /** Where the output was saved */
  savedPath: string | null
  /**
   * The output in the app's cache, when it was not saved (e.g. larger than the original); deleted
   * when the item is cleared
   */
  outputPath: string | null
  /** Why it failed, or was not saved (e.g. larger than the original) */
  message: string | null
  /** It failed as the system did not allow opening it (e.g. macOS privacy settings) */
  isAccessDenied: boolean
  /**
   * The watched folder it landed in (see `watch_folders.rs`), `null` for media dropped, pasted or
   * copied, which is compressed first
   */
  watchFolderId: string | null
  /** That folder's name, shown with it */
  watchFolderName: string | null
}

export type DropQueueItemUpdate = Partial<
  Pick<
    DropQueueItem,
    | 'status'
    | 'progress'
    | 'originalSize'
    | 'outputSize'
    | 'savedPath'
    | 'outputPath'
    | 'message'
    | 'isAccessDenied'
  >
>

/** Turns compressing the dropped media automatically on or off */
export function setAutoCompressEnabled(enabled: boolean) {
  return core.invoke<void>('set_auto_compress_enabled', { enabled })
}

export function getDropQueue() {
  return core.invoke<DropQueueItem[]>('get_drop_queue')
}

export function updateDropQueueItem(id: string, update: DropQueueItemUpdate) {
  return core.invoke<void>('update_drop_queue_item', { id, update })
}

/** Compresses an item again (e.g. one that failed), at the end of the queue */
export function retryDropQueueItem(id: string) {
  return core.invoke<void>('retry_drop_queue_item', { id })
}

/** Removes an item that is not being compressed */
export function removeDropQueueItem(id: string) {
  return core.invoke<void>('remove_drop_queue_item', { id })
}

/** Removes the items that are done or failed */
export function clearFinishedDropQueue() {
  return core.invoke<void>('clear_finished_drop_queue')
}

/** Stops the media being compressed & removes the waiting media (the finished media is kept) */
export function cancelDropQueue() {
  return core.invoke<void>('cancel_drop_queue')
}

/** Sent to every window when the queue is paused or resumed */
export const DROP_QUEUE_PAUSED_EVENT = 'drop-queue-paused-changed'

/** Pauses the queue after the media being compressed, or resumes it */
export function setDropQueuePaused(paused: boolean) {
  return core.invoke<void>('set_drop_queue_paused', { paused })
}

export function isDropQueuePaused() {
  return core.invoke<boolean>('is_drop_queue_paused')
}

/** A watched folder, as the backend watches it (only the enabled ones are sent) */
export type WatchedFolderToWatch = { id: string; path: string; name: string }

/**
 * Sets the folders watched, & the extensions of the media they pick up (see `watch_folders.rs`)
 */
export function setWatchedFolders(
  folders: WatchedFolderToWatch[],
  supportedExtensions: readonly string[],
) {
  return core.invoke<void>('set_watched_folders', {
    folders,
    supportedExtensions,
  })
}

/** Configured paths that no longer exist as directories. */
export function getMissingWatchedFolders(paths: string[]) {
  return core.invoke<string[]>('missing_watched_folders', { paths })
}
