import { presetsStore } from '@/stores/presetsStore'
import {
  addHistoryEntries,
  type HistoryEntry,
  type HistorySource,
  setHistoryOutput,
} from '@/tauri/commands/history'
import { STANDARD_PRESET_ID } from '@/types/preset'
import { appProxy } from './-state'

/**
 * Recording every compression in the history (Settings -> History, see `history.rs`): by the main
 * window once a batch is compressed (& saved automatically), & by the
 * drop zone's queue once each media is. Outputs saved later (e.g. with the Save button) update their
 * entry.
 */

/** A preset's name as recorded (`null` for the Standard preset, or a deleted one) */
function getPresetName(presetId: string | null | undefined) {
  if (!presetId || presetId === STANDARD_PRESET_ID) return null
  return (
    presetsStore.presets.find((preset) => preset.id === presetId)?.name ?? null
  )
}

/** The dropped folder a media was in (e.g. `Vacation` for `Vacation/Day1`), if any */
function getFolderName(relativeDir: string | null | undefined) {
  return relativeDir ? (relativeDir.split('/')[0] ?? null) : null
}

function getMediaType(media: {
  type: 'video' | 'image'
  isAudioFile?: boolean
}): HistoryEntry['mediaType'] {
  return media.type === 'image'
    ? 'image'
    : media.isAudioFile
      ? 'audio'
      : 'video'
}

/** Records the media compressed by the main window in a batch (each gets its entry's id) */
export function recordMainWindowHistory(batchId: string) {
  const now = Date.now()
  const entries: HistoryEntry[] = []
  for (const mediaFile of appProxy.state.media) {
    const file = mediaFile.compressedFile
    if (!file?.isSuccessful || !mediaFile.pathRaw) continue
    const id = `${batchId}:${mediaFile.id}`
    file.historyId = id
    entries.push({
      id,
      completedAt: now,
      mediaType: getMediaType(
        mediaFile as { type: 'video' | 'image'; isAudioFile?: boolean },
      ),
      source: 'main',
      groupId: batchId,
      folderName: getFolderName(mediaFile.relativeDir),
      relativeDir: mediaFile.relativeDir || null,
      originalPath: mediaFile.pathRaw,
      originalSize: mediaFile.sizeInBytes ?? null,
      outputPath: file.isSaved ? (file.savedPath ?? null) : null,
      outputSize: file.sizeInBytes ?? null,
      presetName: getPresetName(mediaFile.config?.presetId),
    })
  }
  if (entries.length) addHistoryEntries(entries).catch(() => {})
}

/**
 * Updates a media's entry once its output is saved (or replaced by another output). Its entry is
 * found by the id kept on the output, or else by the batch & the media (as it was recorded).
 */
export function recordSavedOutput(
  file: {
    historyId?: string
    savedPath?: string
    sizeInBytes?: number | null
  },
  mediaId: string | null | undefined,
) {
  const { batchId } = appProxy.state
  const id =
    file.historyId ?? (batchId && mediaId ? `${batchId}:${mediaId}` : null)
  if (!id || !file.savedPath) return
  setHistoryOutput(id, file.savedPath, file.sizeInBytes ?? null).catch(() => {})
}

/** Records a media compressed by the drop zone's queue (dropped, pasted, or from a watched folder) */
export function recordQueueHistory({
  id,
  groupId,
  relativeDir,
  watchFolderName,
  originalPath,
  originalSize,
  outputPath,
  outputSize,
  mediaType,
  presetId,
}: {
  /** Of the queue item (each compression of it gets its own entry) */
  id: string
  groupId: string
  relativeDir: string
  watchFolderName: string | null
  originalPath: string
  originalSize: number | null
  outputPath: string | null
  outputSize: number | null
  mediaType: HistoryEntry['mediaType']
  presetId: string | null | undefined
}) {
  const source: HistorySource = watchFolderName ? 'watchedFolder' : 'dropZone'
  addHistoryEntries([
    {
      id: `${id}:${Date.now()}`,
      completedAt: Date.now(),
      mediaType,
      source,
      watchFolderName,
      groupId,
      folderName: getFolderName(relativeDir),
      relativeDir: relativeDir || null,
      originalPath,
      originalSize,
      outputPath,
      outputSize,
      presetName: getPresetName(presetId),
    },
  ]).catch(() => {})
}
