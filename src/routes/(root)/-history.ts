import { snapshot } from 'valtio'

import { toast } from '@/components/Toast'
import { t } from '@/i18n'
import { presetsStore } from '@/stores/presetsStore'
import { settingsDialogStore } from '@/stores/settingsDialogStore'
import { deleteFile, readFilesFromPaths } from '@/tauri/commands/fs'
import {
  addHistoryEntries,
  type HistoryEntry,
  type HistorySource,
  pathsExist,
  setHistoryOutput,
} from '@/tauri/commands/history'
import { clearActiveSession } from '@/tauri/commands/session'
import { STANDARD_PRESET_ID } from '@/types/preset'
import { addMedia } from './-media'
import { applyContractToMediaFile, buildContractForMedia } from './-presets'
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
    const contract = buildContractForMedia(mediaFile)
    const clips = mediaFile.type === 'video' ? file.clips : undefined
    if (clips?.length) {
      for (const clip of clips) {
        const clipId = `${batchId}:${mediaFile.id}:clip-${clip.index}`
        clip.historyId = clipId
        entries.push({
          id: clipId,
          completedAt: now,
          mediaType: 'video',
          source: 'main',
          groupId: batchId,
          folderName: getFolderName(mediaFile.relativeDir),
          relativeDir: mediaFile.relativeDir || null,
          originalPath: mediaFile.pathRaw,
          // The original is counted once, with its first clip
          originalSize:
            clip.index === 1 ? (mediaFile.sizeInBytes ?? null) : null,
          outputPath: clip.isSaved ? (clip.savedPath ?? null) : null,
          outputSize: clip.sizeInBytes ?? null,
          presetName: getPresetName(mediaFile.config?.presetId),
          contract,
        })
      }
      continue
    }
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
      contract,
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
  isFromCommandLine,
  originalPath,
  originalSize,
  outputPath,
  outputSize,
  mediaType,
  presetId,
  presetName,
}: {
  /** Of the queue item (each compression of it gets its own entry) */
  id: string
  groupId: string
  relativeDir: string
  watchFolderName: string | null
  /** Compressed for the command line (see `cli_server.rs`) */
  isFromCommandLine: boolean
  originalPath: string
  originalSize: number | null
  outputPath: string | null
  outputSize: number | null
  mediaType: HistoryEntry['mediaType']
  presetId: string | null | undefined
  presetName?: string | null
}) {
  const source: HistorySource = isFromCommandLine
    ? 'commandLine'
    : watchFolderName
      ? 'watchedFolder'
      : 'dropZone'
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
      presetName: presetName ?? getPresetName(presetId),
    },
  ]).catch(() => {})
}

/**
 * Reopens an entry's original file in the main editor with the JSON contract settings recorded for
 * it, guarding against active compressions and unsaved outputs.
 */
export async function reopenHistoryEntryWithSettings(
  entry: HistoryEntry,
): Promise<boolean> {
  if (!entry.contract || !entry.originalPath) return false

  const state = snapshot(appProxy).state
  if (state.isCompressing) {
    toast.warning(t('settings.history.cannotReopenWhileCompressing'))
    return false
  }
  const hasUnsavedOutput =
    state.isProcessCompleted &&
    state.media.some(
      (mediaFile) =>
        mediaFile.compressedFile?.isSuccessful &&
        !mediaFile.compressedFile?.isSaved,
    )
  if (hasUnsavedOutput) {
    toast.warning(t('settings.history.cannotReopenUnsaved'))
    return false
  }

  const [exists] = await pathsExist([entry.originalPath]).catch(() => [false])
  if (!exists) {
    toast.error(t('settings.history.missing'))
    return false
  }

  let files: Awaited<ReturnType<typeof readFilesFromPaths>>
  try {
    // Allow Tauri fs/asset scope for the historical path before loading its webview preview
    files = await readFilesFromPaths([entry.originalPath])
  } catch {
    toast.error(t('media.invalidFiles'))
    return false
  }
  if (!files.length) {
    toast.error(t('settings.history.missing'))
    return false
  }

  const cachePaths = state.media
    .flatMap((media) => [
      media.compressedFile?.pathRaw ?? null,
      ...(media.type === 'video'
        ? (media.compressedFile?.clips ?? []).map(
            (clip) => clip.pathRaw ?? null,
          )
        : []),
      media.type === 'video' ? (media.thumbnailPathRaw ?? null) : null,
    ])
    .filter((p): p is string => !!p)
  await Promise.allSettled(cachePaths.map((path) => deleteFile(path)))

  appProxy.resetProxy()
  clearActiveSession().catch(() => {})
  settingsDialogStore.isOpen = false

  await addMedia(files)
  if (!appProxy.state.media.length) return false

  await applyContractToMediaFile(0, entry.contract, entry.presetName)
  appProxy.state.media[0].isConfigDirty = true
  toast.success(t('settings.history.reopened'))
  return true
}
