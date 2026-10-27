import { core } from '@tauri-apps/api'

/** Sent to every window when the history changes */
export const HISTORY_EVENT = 'history-changed'

/** Where a compression was started */
export type HistorySource = 'main' | 'dropZone' | 'watchedFolder'

/** A compression, as recorded when it was done (see `history.rs`) */
export type HistoryEntry = {
  id: string
  /** Milliseconds since 1970 */
  completedAt: number
  mediaType: 'video' | 'image' | 'audio'
  source: HistorySource
  watchFolderName?: string | null
  /** Media compressed together (a batch, or a drop) share it */
  groupId?: string | null
  /** The dropped folder it was in (e.g. `Vacation`), & its folder within it */
  folderName?: string | null
  relativeDir?: string | null
  originalPath: string
  originalSize?: number | null
  /** Where the output was saved (`null` while it is not) */
  outputPath?: string | null
  outputSize?: number | null
  /** `null` for the Standard preset */
  presetName?: string | null
}

/** Every entry, newest last */
export function getHistory() {
  return core.invoke<HistoryEntry[]>('get_history')
}

/** Records compressions (an entry with the id of one already recorded replaces it) */
export function addHistoryEntries(entries: HistoryEntry[]) {
  return core.invoke<void>('add_history_entries', { entries })
}

/** Where an output was saved, once it is */
export function setHistoryOutput(
  id: string,
  outputPath: string,
  outputSize: number | null,
) {
  return core.invoke<void>('set_history_output', {
    id,
    outputPath,
    outputSize,
  })
}

export function clearHistory() {
  return core.invoke<void>('clear_history')
}

/** Whether each path still exists (files may have been moved or deleted since) */
export function pathsExist(paths: string[]) {
  return core.invoke<boolean[]>('paths_exist', { paths })
}
