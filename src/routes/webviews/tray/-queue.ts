import { event } from '@tauri-apps/api'
import clamp from 'lodash/clamp'
import cloneDeep from 'lodash/cloneDeep'
import { useEffect } from 'react'

import {
  applyOneShotContractOverrides,
  contractOutputToPresetOutput,
  contractToPreset,
} from '@/contract'
import type {
  AudioContract,
  ImageContract,
  MediaContract,
  VideoContract,
} from '@/contract/types'
import { useDropQueue, useDropQueuePaused } from '@/hooks/useDropQueue'
import { t } from '@/i18n'
import {
  type AccelerationSettings,
  getMediaItemConfig,
  getOutputDuration,
  getVideoClipOutputs,
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
import { logError, logInfo } from '@/tauri/commands/app'
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
import { getImageDynamicRange } from '@/tauri/commands/image'
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
import {
  DROP_ZONE_PRESET_SETTINGS,
  getPresetOutput,
  resolvePresetChoice,
} from '@/utils/presetOutput'
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

function getQueueContract<T extends PresetMediaType>(
  item: DropQueueItem,
  mediaType: T,
):
  | (T extends 'video'
      ? VideoContract
      : T extends 'image'
        ? ImageContract
        : AudioContract)
  | null {
  return (item.cliJob?.contracts?.[mediaType] ?? null) as never
}

/**
 * The preset a queued media is compressed with: the one chosen on the command line, its watched
 * folder's, or the drop zone's (Settings -> Drop Zone), Default (the preset starred now) unless
 * another is chosen
 */
function getQueuePresetId(item: DropQueueItem, mediaType: PresetMediaType) {
  if (item.cliJob) {
    return resolvePresetChoice(item.cliJob.presetIds[mediaType], mediaType)
  }
  const choice = item.watchFolderId
    ? settingsStore.watchedFolders.find(({ id }) => id === item.watchFolderId)
        ?.presetIds?.[mediaType]
    : settingsStore[DROP_ZONE_PRESET_SETTINGS[mediaType]]
  return resolvePresetChoice(choice, mediaType)
}

/**
 * The hardware acceleration settings chosen on the command line for a queued media, if any (the
 * app's are used otherwise)
 */
function getQueueAcceleration(
  item: DropQueueItem,
): AccelerationSettings | undefined {
  const job = item.cliJob
  if (
    job?.useHardwareAcceleration == null &&
    job?.reachTargetSizesWithoutAcceleration == null &&
    job?.cpuThreads == null
  ) {
    return undefined
  }
  return {
    useHardwareAcceleration:
      job.useHardwareAcceleration ?? settingsStore.useHardwareAcceleration,
    retryTargetSizeOnCpu:
      job.reachTargetSizesWithoutAcceleration ??
      settingsStore.retryTargetSizeOnCpu,
    ...(job.cpuThreads != null ? { cpuThreads: job.cpuThreads } : {}),
  }
}

/**
 * A queued media with the settings of the drop zone's preset (Settings -> Drop Zone), like media
 * added in the main window gets its default preset
 */
async function loadQueueMedia(item: DropQueueItem): Promise<MediaFile> {
  const media = await readQueueMedia(item)
  const acceleration = getQueueAcceleration(item)
  // A format chosen on the command line (by the output's file name) replaces the preset's; the
  // command line only sends one the media type can be saved in
  const extension = item.cliJob?.convertToExtension
  const config = extension
    ? { ...media.config, convertToExtension: extension }
    : media.config
  return {
    ...media,
    config,
    ...(acceleration ? { acceleration } : {}),
  } as MediaFile
}

async function readQueueMedia(item: DropQueueItem): Promise<MediaFile> {
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

  // With the drop zone's audio preset (or inline contract)
  if (isAudioFileExtension(extension)) {
    const info = await getVideoBasicInfo(item.path).catch(() => null)
    const contract = getQueueContract(item, 'audio')
    const preset = contract
      ? (contractToPreset('cli-contract', contract) as ReturnType<
          typeof getAudioPreset
        >)
      : getAudioPreset(getQueuePresetId(item, 'audio'))
    let config = applyAudioPresetToConfig(
      {
        ...cloneDeep(audioFileConfigInitialState),
        convertToExtension: getAudioFileOutputExtension(extension),
      },
      preset,
      { sourceExtension: extension },
      { isBatchConfig: false },
    )
    if (contract) {
      logInfo(`[drop-queue] Applying one-shot audio contract to ${item.path}`)
      config = applyOneShotContractOverrides(config, contract)
    }
    return {
      ...base,
      type: 'video',
      isAudioFile: true,
      videoDuration: info?.duration ?? null,
      config,
    }
  }

  if (metadata.mimeType.startsWith('video')) {
    const info = await getVideoBasicInfo(item.path)
    const [width, height] = info?.dimensions ?? []
    const dimensions =
      width && height && !Number.isNaN(width) && !Number.isNaN(height)
        ? { width, height }
        : undefined
    const contract = getQueueContract(item, 'video')
    const preset = contract
      ? (contractToPreset('cli-contract', contract) as ReturnType<
          typeof getVideoPreset
        >)
      : getVideoPreset(getQueuePresetId(item, 'video'))
    // Whether it has audio only matters for a preset's audio settings
    const audioStreams =
      preset.id !== STANDARD_PRESET_ID
        ? await getAudioStreams(item.path).catch(() => null)
        : null
    const baseConfig = cloneDeep(videoConfigInitialState)
    if (extension && extension in extensions.video) {
      baseConfig.convertToExtension = extension as keyof typeof extensions.video
    }
    let config = applyVideoPresetToConfig(
      baseConfig,
      preset,
      {
        sourceExtension: extension,
        hasAudio: audioStreams ? audioStreams.length > 0 : null,
        dimensions,
      },
      { isBatchConfig: false },
    )
    if (contract) {
      logInfo(`[drop-queue] Applying one-shot video contract to ${item.path}`)
      config = applyOneShotContractOverrides(config, contract)
    }
    return {
      ...base,
      type: 'video',
      videoDuration: info?.duration ?? null,
      dimensions,
      config,
    }
  }

  const [width, height] = await (extension === 'svg'
    ? getSvgDimension(item.path)
    : getImageDimension(item.path)
  ).catch(() => [0, 0])
  const dimensions = width && height ? { width, height } : undefined
  const baseConfig = cloneDeep(imageConfigInitialState)
  // Formats that can only be opened are converted to PNG by default
  if (
    (inputOnlyExtensions.image as readonly string[]).includes(extension ?? '')
  ) {
    baseConfig.convertToExtension = 'png'
  }
  const imageContract = getQueueContract(item, 'image')
  if (imageContract) {
    logInfo(`[drop-queue] Applying one-shot image contract to ${item.path}`)
  }
  const imagePreset = imageContract
    ? (contractToPreset('cli-contract', imageContract) as ReturnType<
        typeof getImagePreset
      >)
    : getImagePreset(getQueuePresetId(item, 'image'))
  return {
    ...base,
    type: 'image',
    dynamicRangeInfo: await getImageDynamicRange(item.path).catch(
      () => undefined,
    ),
    dimensions,
    config: applyImagePresetToConfig(
      baseConfig,
      imagePreset,
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
    const result = results[media.id!]
    const outputMetadata = result?.fileMetadata
    if (!outputMetadata?.path) throw new Error('No output')
    const clips =
      media.type === 'video' && result?.mediaType === 'video'
        ? getVideoClipOutputs(result, media)
        : []
    const outputFiles = clips.length
      ? clips.map((clip) => ({
          path: clip.pathRaw,
          size: clip.sizeInBytes ?? 0,
          fileName: clip.fileNameToDisplay ?? clip.fileName,
        }))
      : [
          {
            path: outputMetadata.path,
            size: outputMetadata.size,
            fileName: getOutputFileName(
              media.fileName,
              media.extension,
              outputMetadata.extension,
            ),
          },
        ]
    const outputSize = outputFiles.reduce((total, file) => total + file.size, 0)
    // Cancelled just as it finished: the outputs are not kept
    if (!(await isStillCompressing(item.id))) {
      for (const file of outputFiles) deleteFile(file.path).catch(() => {})
      return false
    }

    const itemMediaType: PresetMediaType =
      media.type === 'image' ? 'image' : media.isAudioFile ? 'audio' : 'video'
    const itemContract: MediaContract | null = getQueueContract(
      item,
      itemMediaType,
    )
    const contractOutput = itemContract
      ? (contractOutputToPresetOutput(itemContract.output) ??
        getPresetOutput(STANDARD_PRESET_ID))
      : undefined
    const contractName = itemContract
      ? itemContract.name?.trim() || 'Custom contract'
      : undefined

    const saved = await saveQueueOutput(
      {
        sourcePath: item.path,
        relativeDir: item.relativeDir,
        originalSize: media.sizeInBytes ?? 0,
        outputs: outputFiles,
        presetId: media.config?.presetId,
        presetOutput: contractOutput,
        presetName: contractName,
        settings: item.cliJob,
      },
      { groupKey: item.groupId, topFolders },
    )
    const savedPaths = 'savedPaths' in saved ? saved.savedPaths : []
    if (clips.length) {
      clips.forEach((clip, index) => {
        recordQueueHistory({
          id: `${item.id}:clip-${clip.index}`,
          groupId: item.groupId,
          relativeDir: item.relativeDir,
          watchFolderName: item.watchFolderName,
          isFromCommandLine: !!item.cliJob,
          originalPath: item.path,
          // The original is counted once, with its first clip
          originalSize: clip.index === 1 ? (media.sizeInBytes ?? null) : null,
          outputPath: savedPaths[index] ?? null,
          outputSize: clip.sizeInBytes ?? null,
          mediaType: 'video',
          presetId: media.config?.presetId,
          presetName: contractName,
        })
      })
    } else {
      recordQueueHistory({
        id: item.id,
        groupId: item.groupId,
        relativeDir: item.relativeDir,
        watchFolderName: item.watchFolderName,
        isFromCommandLine: !!item.cliJob,
        originalPath: item.path,
        originalSize: media.sizeInBytes ?? null,
        outputPath: savedPaths[0] ?? null,
        outputSize: outputMetadata.size,
        mediaType: itemMediaType,
        presetId: media.config?.presetId,
        presetName: contractName,
      })
    }
    if ('savedPaths' in saved) {
      await update({
        status: 'done',
        progress: 100,
        outputSize,
        clipCount: clips.length,
        savedPath: savedPaths[0] ?? null,
        replacedOriginal: saved.replacedOriginal,
        outputPaths: [],
      })
      // Not for the command line, which is not at the app
      if (settingsStore.copyOutputToClipboard && !item.cliJob) {
        copyFilesToClipboard(savedPaths.map((path) => ({ path }))).catch(
          () => {},
        )
      }
    } else if (saved.reason === 'larger') {
      // Nothing can save it later from the command line, so it is not kept
      if (item.cliJob) {
        for (const file of outputFiles) deleteFile(file.path).catch(() => {})
      }
      await update({
        status: 'done',
        progress: 100,
        outputSize,
        clipCount: clips.length,
        // Kept until the item is cleared, which deletes them
        outputPaths: item.cliJob ? [] : outputFiles.map((file) => file.path),
        message: t('queue.notSavedLarger'),
        reason: 'larger',
      })
    } else {
      await update({
        status: 'failed',
        outputSize,
        clipCount: clips.length,
        outputPaths: outputFiles.map((file) => file.path),
        message:
          saved.reason === 'no-save-location'
            ? t('queue.noSaveLocation')
            : t('queue.saveFailed'),
        needsSaveLocation: saved.reason === 'no-save-location',
        reason:
          saved.reason === 'no-save-location' ? 'noSaveLocation' : 'saveFailed',
      })
    }
    // The completion sound is for media added in the app
    return !item.cliJob
  } catch (error) {
    logError(`[drop-queue] Could not compress ${item.path}`, error)
    const isAccessDenied = isPermissionDeniedError(error)
    await update({
      status: 'failed',
      message: isAccessDenied
        ? t('queue.accessDenied')
        : t('queue.compressFailed'),
      isAccessDenied,
      reason: isAccessDenied ? 'accessDenied' : 'compressFailed',
      error: error instanceof Error ? error.message : String(error),
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
