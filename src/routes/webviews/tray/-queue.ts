import { event } from '@tauri-apps/api'
import clamp from 'lodash/clamp'
import cloneDeep from 'lodash/cloneDeep'
import { useEffect } from 'react'

import { useDropQueue, useDropQueuePaused } from '@/hooks/useDropQueue'
import {
  getMediaItemConfig,
  getOutputDuration,
  MediaFile,
} from '@/routes/(root)/-compression'
import {
  applyImagePresetToConfig,
  applyVideoPresetToConfig,
  getImagePreset,
  getVideoPreset,
} from '@/routes/(root)/-presets'
import { saveQueueOutput } from '@/routes/(root)/-save'
import {
  imageConfigInitialState,
  videoConfigInitialState,
} from '@/routes/(root)/-state'
import { settingsStore } from '@/stores/settingsStore'
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
} from '@/tauri/commands/fs'
import { compressMediaBatch } from '@/tauri/commands/media'
import { playCompletionSound } from '@/tauri/commands/sound'
import {
  type BatchMediaCompressionProgress,
  CustomEvents,
  extensions,
  inputOnlyExtensions,
} from '@/types/compression'
import { STANDARD_PRESET_ID } from '@/types/preset'
import { getOutputFileName } from '@/utils/fs'
import { convertDurationToMilliseconds } from '@/utils/string'

/** Top folders of dropped folders saved so far, shared by the media of a drop */
const topFolders = new Map<string, string>()

let isRunning = false

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

/** Whether a media is still to be compressed (not cancelled or removed) */
async function isStillCompressing(id: string) {
  return (await getDropQueue().catch(() => [])).some(
    (item) => item.id === id && item.status === 'compressing',
  )
}

/** Resolves once the main window is not compressing, so only one compression runs at a time */
async function waitForMainWindow() {
  while (
    (await getCompressionStatus().catch(() => null))?.state === 'compressing'
  ) {
    await wait(1000)
  }
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

  if (metadata.mimeType.startsWith('video')) {
    const info = await getVideoBasicInfo(item.path)
    const [width, height] = info?.dimensions ?? []
    const dimensions =
      width && height && !Number.isNaN(width) && !Number.isNaN(height)
        ? { width, height }
        : undefined
    const preset = getVideoPreset(settingsStore.dropZoneVideoPresetId)
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
      getImagePreset(settingsStore.dropZoneImagePresetId),
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
      },
      { groupKey: item.groupId, topFolders },
    )
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
        message: 'Not saved, as it is larger than the original.',
      })
    } else {
      await update({
        status: 'failed',
        outputPath: outputMetadata.path,
        message:
          saved.reason === 'no-save-location'
            ? 'Choose a save location in Settings, under Output.'
            : 'The compressed media could not be saved.',
      })
    }
    return true
  } catch {
    await update({
      status: 'failed',
      message: 'The media could not be compressed.',
    })
    return false
  } finally {
    unlisten?.()
  }
}

/**
 * Compresses the waiting media of the drop zone's queue one by one, in the order it was added, until
 * none is left. Runs once at a time; call it whenever media is added.
 */
export async function runDropQueue() {
  if (isRunning) return
  isRunning = true
  let hasCompressed = false
  // The queue ran out (not paused), so the compression completed
  let isCompleted = false
  // The media compressed in this run, to tell if it was stopped
  const compressedIds = new Set<string>()
  try {
    // Left compressing by a reload of this window (e.g. while it was compressing)
    for (const item of await getDropQueue()) {
      if (item.status === 'compressing') {
        await updateDropQueueItem(item.id, { status: 'waiting', progress: 0 })
      }
    }
    while (true) {
      // Paused: the media being compressed finished, nothing new starts
      if (await isDropQueuePaused().catch(() => false)) break
      await waitForMainWindow()
      // The media queued first (media tried again is queued after the waiting media)
      const next = (await getDropQueue())
        .filter((item) => item.status === 'waiting')
        .sort((a, b) => a.queueOrder - b.queueOrder)[0]
      if (!next) {
        isCompleted = true
        break
      }
      compressedIds.add(next.id)
      if (await compressQueueItem(next)) hasCompressed = true
    }
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
  }
}

/** Compresses the queue whenever media is waiting in it (in the menu bar's window) */
export function useDropQueueRunner() {
  const items = useDropQueue()
  const isPaused = useDropQueuePaused()
  const hasWaitingItems = items.some((item) => item.status === 'waiting')
  useEffect(() => {
    // Also when resumed
    if (hasWaitingItems && !isPaused) runDropQueue()
  }, [hasWaitingItems, isPaused])
}
