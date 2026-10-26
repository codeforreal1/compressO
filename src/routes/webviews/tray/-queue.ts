import { event } from '@tauri-apps/api'
import clamp from 'lodash/clamp'
import cloneDeep from 'lodash/cloneDeep'
import { useEffect } from 'react'

import { useDropQueue, useDropQueuePaused } from '@/hooks/useDropQueue'
import { t } from '@/i18n'
import {
  getMediaItemConfig,
  getOutputDuration,
  MediaFile,
} from '@/routes/(root)/-compression'
import { recordQueueHistory } from '@/routes/(root)/-history'
import {
  applyAudioPresetToConfig,
  applyImagePresetToConfig,
  applyVideoPresetToConfig,
  getAudioPreset,
  getImagePreset,
  getVideoPreset,
} from '@/routes/(root)/-presets'
import { saveQueueOutput } from '@/routes/(root)/-save'
import { estimateTargetSizeVideos } from '@/routes/(root)/-sizeEstimate'
import {
  audioFileConfigInitialState,
  imageConfigInitialState,
  videoConfigInitialState,
} from '@/routes/(root)/-state'
import { settingsStore } from '@/stores/settingsStore'
import { logError } from '@/tauri/commands/app'
import { getCompressionStatus } from '@/tauri/commands/compression'
import {
  type DropQueueItem,
  type DropQueueItemUpdate,
  getDropQueue,
  isDropQueuePaused,
  updateDropQueueItem,
} from '@/tauri/commands/dropQueue'
import { getAudioStreams, getVideoBasicInfo } from '@/tauri/commands/ffprobe'
import {
  copyFilesToClipboard,
  deleteFile,
  getFileMetadata,
  getImageDimension,
  getSvgDimension,
  isPermissionDeniedError,
} from '@/tauri/commands/fs'
import { compressMediaBatch } from '@/tauri/commands/media'
import { playCompletionSound } from '@/tauri/commands/sound'
import {
  type BatchMediaCompressionProgress,
  CustomEvents,
  extensions,
  getAudioFileOutputExtension,
  inputExtensions,
  inputOnlyExtensions,
  isAudioFileExtension,
} from '@/types/compression'
import { type PresetMediaType, STANDARD_PRESET_ID } from '@/types/preset'
import { getOutputFileName } from '@/utils/fs'
import { DROP_ZONE_PRESET_SETTINGS } from '@/utils/presetOutput'
import { convertDurationToMilliseconds } from '@/utils/string'

/** Top folders of dropped folders saved so far, shared by the media of a drop */
const topFolders = new Map<string, Promise<string>>()

let isRunning = false

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

/** Whether a media is still to be compressed (not cancelled or removed) */
async function isStillCompressing(id: string) {
  return (await getDropQueue().catch(() => [])).some(
    (item) => item.id === id && item.status === 'compressing',
  )
}

/** Resolves once the main window is not compressing, so the two never compress at the same time */
async function waitForMainWindow() {
  while (
    (await getCompressionStatus().catch(() => null))?.state === 'compressing'
  ) {
    await wait(1000)
  }
}

/**
 * The preset a queued media is compressed with: its watched folder's (Standard unless chosen), or
 * the drop zone's (Settings -> Drop Zone)
 */
function getQueuePresetId(item: DropQueueItem, mediaType: PresetMediaType) {
  if (item.watchFolderId) {
    const folder = settingsStore.watchedFolders.find(
      ({ id }) => id === item.watchFolderId,
    )
    return folder?.presetIds?.[mediaType] ?? STANDARD_PRESET_ID
  }
  return settingsStore[DROP_ZONE_PRESET_SETTINGS[mediaType]]
}

/**
 * A queued media with the settings of the drop zone's preset (Settings -> Drop Zone), like media
 * added in the main window gets its default preset
 */
async function loadQueueMedia(item: DropQueueItem): Promise<MediaFile> {
  const metadata = await getFileMetadata(item.path)
  const extension = metadata.extension?.toLowerCase() ?? null
  const base = {
    id: item.id,
    pathRaw: item.path,
    relativeDir: item.relativeDir,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    sizeInBytes: metadata.size,
    extension,
  }

  // With the drop zone's audio preset (not the video one, made for videos)
  if (isAudioFileExtension(extension)) {
    const info = await getVideoBasicInfo(item.path).catch(() => null)
    return {
      ...base,
      type: 'video',
      isAudioFile: true,
      videoDuration: info?.duration ?? null,
      config: applyAudioPresetToConfig(
        {
          ...cloneDeep(audioFileConfigInitialState),
          convertToExtension: getAudioFileOutputExtension(extension),
        },
        getAudioPreset(getQueuePresetId(item, 'audio')),
        { sourceExtension: extension },
        { isBatchConfig: false },
      ),
    }
  }

  if (metadata.mimeType.startsWith('video')) {
    const info = await getVideoBasicInfo(item.path)
    const [width, height] = info?.dimensions ?? []
    const dimensions =
      width && height && !Number.isNaN(width) && !Number.isNaN(height)
        ? { width, height }
        : undefined
    const preset = getVideoPreset(getQueuePresetId(item, 'video'))
    // Whether it has audio only matters for a preset's audio settings
    const audioStreams =
      preset.id !== STANDARD_PRESET_ID
        ? await getAudioStreams(item.path).catch(() => null)
        : null
    const config = cloneDeep(videoConfigInitialState)
    if (extension && extension in extensions.video) {
      config.convertToExtension = extension as keyof typeof extensions.video
    }
    return {
      ...base,
      type: 'video',
      videoDuration: info?.duration ?? null,
      dimensions,
      config: applyVideoPresetToConfig(
        config,
        preset,
        {
          sourceExtension: extension,
          hasAudio: audioStreams ? audioStreams.length > 0 : null,
          dimensions,
        },
        { isBatchConfig: false },
      ),
    }
  }

  const [width, height] = await (extension === 'svg'
    ? getSvgDimension(item.path)
    : getImageDimension(item.path)
  ).catch(() => [0, 0])
  const dimensions = width && height ? { width, height } : undefined
  const config = cloneDeep(imageConfigInitialState)
  // Formats that can only be opened are converted to PNG by default
  if (
    (inputOnlyExtensions.image as readonly string[]).includes(extension ?? '')
  ) {
    config.convertToExtension = 'png'
  }
  return {
    ...base,
    type: 'image',
    dimensions,
    config: applyImagePresetToConfig(
      config,
      getImagePreset(getQueuePresetId(item, 'image')),
      { sourceExtension: extension, dimensions },
      { isBatchConfig: false },
    ),
  }
}

/** Compresses & saves a queued media, reporting its progress to the queue */
async function compressQueueItem(item: DropQueueItem) {
  const update = (changes: DropQueueItemUpdate) =>
    updateDropQueueItem(item.id, changes).catch(() => {})
  await update({ status: 'compressing', progress: 0 })

  let unlisten: event.UnlistenFn | undefined
  try {
    const media = await loadQueueMedia(item)
    // Cancelled while it was being read
    if (!(await isStillCompressing(item.id))) return false
    await update({ originalSize: media.sizeInBytes ?? null })

    const outputDuration = getOutputDuration(media)
    let lastProgress = 0
    unlisten = await event.listen<BatchMediaCompressionProgress>(
      CustomEvents.BatchMediaCompressionProgress,
      ({ payload }) => {
        if (payload?.batchId !== item.id) return
        const mediaProgress = payload.mediaProgress
        const progress =
          mediaProgress.mediaType === 'video'
            ? outputDuration > 0
              ? (convertDurationToMilliseconds(mediaProgress.currentDuration) *
                  100) /
                outputDuration
              : 0
            : mediaProgress.progress
        // Whole percents, so the queue is not updated too often
        const rounded = Math.floor(clamp(progress, 0, 99))
        if (rounded > lastProgress) {
          lastProgress = rounded
          update({ progress: rounded })
        }
      },
    )

    // Compressed at its quality settings when those fit its target size (see `-sizeEstimate.ts`)
    await estimateTargetSizeVideos([media], null)
    // The queue item's id is the batch's, so its progress & cancellation are its own
    const { results } = await compressMediaBatch(item.id, [
      getMediaItemConfig(media, {
        batchVideoLongerSide: null,
        batchImageLongerSide: null,
      }),
    ])
    const outputMetadata = results[media.id!]?.fileMetadata
    if (!outputMetadata?.path) throw new Error('No output')
    // Cancelled just as it finished: the output is not kept
    if (!(await isStillCompressing(item.id))) {
      deleteFile(outputMetadata.path).catch(() => {})
      return false
    }

    const saved = await saveQueueOutput(
      {
        sourcePath: item.path,
        relativeDir: item.relativeDir,
        originalSize: media.sizeInBytes ?? 0,
        outputPath: outputMetadata.path,
        outputSize: outputMetadata.size,
        outputFileName: getOutputFileName(
          media.fileName,
          media.extension,
          outputMetadata.extension,
        ),
        presetId: media.config?.presetId,
      },
      { groupKey: item.groupId, topFolders },
    )
    recordQueueHistory({
      id: item.id,
      groupId: item.groupId,
      relativeDir: item.relativeDir,
      watchFolderName: item.watchFolderName,
      originalPath: item.path,
      originalSize: media.sizeInBytes ?? null,
      outputPath: 'savedPath' in saved ? saved.savedPath : null,
      outputSize: outputMetadata.size,
      mediaType:
        media.type === 'image'
          ? 'image'
          : media.isAudioFile
            ? 'audio'
            : 'video',
      presetId: media.config?.presetId,
    })
    if ('savedPath' in saved) {
      await update({
        status: 'done',
        progress: 100,
        outputSize: outputMetadata.size,
        savedPath: saved.savedPath,
      })
      if (settingsStore.copyOutputToClipboard) {
        copyFilesToClipboard([{ path: saved.savedPath }]).catch(() => {})
      }
    } else if (saved.reason === 'larger') {
      await update({
        status: 'done',
        progress: 100,
        outputSize: outputMetadata.size,
        // Kept until the item is cleared, which deletes it
        outputPath: outputMetadata.path,
        message: t('queue.notSavedLarger'),
      })
    } else {
      await update({
        status: 'failed',
        outputPath: outputMetadata.path,
        message:
          saved.reason === 'no-save-location'
            ? t('queue.noSaveLocation')
            : t('queue.saveFailed'),
        needsSaveLocation: saved.reason === 'no-save-location',
      })
    }
    return true
  } catch (error) {
    logError(`[drop-queue] Could not compress ${item.path}`, error)
    const isAccessDenied = isPermissionDeniedError(error)
    await update({
      status: 'failed',
      message: isAccessDenied
        ? t('queue.accessDenied')
        : t('queue.compressFailed'),
      isAccessDenied,
    })
    return false
  } finally {
    unlisten?.()
  }
}

/** Which lane a queued media is compressed in (see `runDropQueue`), by its file */
type Lane = 'video' | 'audio' | 'image'

function getLane(item: DropQueueItem): Lane {
  const extension = item.path.split('.').pop()?.toLowerCase() ?? ''
  if (isAudioFileExtension(extension)) return 'audio'
  return (inputExtensions.image as string[]).includes(extension)
    ? 'image'
    : 'video'
}

const LANES: Lane[] = ['video', 'audio', 'image']

/** Asked for while the queue was running, to look again once it is done */
let isRunRequested = false

/**
 * Compresses the waiting media of the drop zone's queue in three lanes, one for each kind of media:
 * one video, one audio file & one image at a time, each lane in the order its media was added (like
 * `compress_media_batch`), so images & audio do not wait for a video. Runs once at a time; call it
 * whenever media is added.
 */
export async function runDropQueue() {
  if (isRunning) {
    isRunRequested = true
    return
  }
  isRunning = true
  isRunRequested = false
  let hasCompressed = false
  let isPaused = false
  // The media compressed in this run, to tell if it was stopped
  const compressedIds = new Set<string>()
  // Lanes looking for or compressing media; an idle lane waits for them, as media of its kind may
  // still be added
  let activeLanes = 0

  const runLane = async (lane: Lane) => {
    while (true) {
      activeLanes++
      let next: DropQueueItem | undefined
      try {
        // Paused: the media being compressed finished, nothing new starts
        if (await isDropQueuePaused().catch(() => false)) {
          isPaused = true
          return
        }
        await waitForMainWindow()
        // The media dropped (or pasted, or copied) first, then that of the watched folders, each
        // in the order it was queued (media tried again is queued after the waiting media)
        next = (await getDropQueue())
          .filter((item) => item.status === 'waiting' && getLane(item) === lane)
          .sort(
            (a, b) =>
              Number(!!a.watchFolderId) - Number(!!b.watchFolderId) ||
              a.queueOrder - b.queueOrder,
          )[0]
        if (next) {
          compressedIds.add(next.id)
          if (await compressQueueItem(next)) hasCompressed = true
        }
      } finally {
        activeLanes--
      }
      if (!next) {
        if (activeLanes === 0 || isPaused) return
        await wait(500)
      }
    }
  }

  try {
    // Left compressing by a reload of this window (e.g. while it was compressing)
    for (const item of await getDropQueue()) {
      if (item.status === 'compressing') {
        await updateDropQueueItem(item.id, { status: 'waiting', progress: 0 })
      }
    }
    await Promise.all(LANES.map(runLane))
    // The queue ran out (not paused), so the compression completed
    const isCompleted = !isPaused
    // Stopped: its media is cancelled, which is not a completion either
    const isStopped =
      isCompleted &&
      (await getDropQueue()).some(
        (item) => item.status === 'cancelled' && compressedIds.has(item.id),
      )
    // Only once the queue completes, not when it is paused or stopped
    if (
      isCompleted &&
      !isStopped &&
      hasCompressed &&
      settingsStore.playCompletionSound
    ) {
      playCompletionSound().catch(() => {})
    }
  } catch {
    // Retried when media is added next
  } finally {
    isRunning = false
    if (isRunRequested) runDropQueue()
  }
}

/** Compresses waiting media in the tray window, or the main window on Linux. */
export function useDropQueueRunner() {
  const items = useDropQueue()
  const isPaused = useDropQueuePaused()
  const hasWaitingItems = items.some((item) => item.status === 'waiting')
  useEffect(() => {
    // Also when resumed
    if (hasWaitingItems && !isPaused) runDropQueue()
  }, [hasWaitingItems, isPaused])
}
