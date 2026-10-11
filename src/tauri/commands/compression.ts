import { core } from '@tauri-apps/api'

export type CompressionStatus = {
  state: 'idle' | 'compressing' | 'completed'
  /** Overall progress (0-100); a batch only has an overall progress */
  progress: number
  mediaCount: number
  /** Name of the file, for a single media */
  fileName: string | null
  /** Compressed outputs that are not saved yet (quitting asks for confirmation) */
  hasUnsavedOutput: boolean
}

/** Sent to the tray window whenever the main window's compression status changes */
export const COMPRESSION_STATUS_EVENT = 'compression-status'

/** Reports the main window's compression status */
export function setCompressionStatus(status: CompressionStatus) {
  return core.invoke<void>('set_compression_status', { status })
}

export function getCompressionStatus() {
  return core.invoke<CompressionStatus>('get_compression_status')
}
