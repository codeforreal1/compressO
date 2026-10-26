import { core, event } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import ShortcutHint from '@/components/ShortcutHint'
import { useCommandEnterShortcut } from '@/hooks/useCommandEnterShortcut'
import { useCommandKeyHeld } from '@/hooks/useCommandKeyHeld'
import { flushSyncStates } from '@/hooks/useSyncState'
import { settingsStore } from '@/stores/settingsStore'
import { getDropQueue } from '@/tauri/commands/dropQueue'
import { compressMediaBatch } from '@/tauri/commands/media'
import { playCompletionSound } from '@/tauri/commands/sound'
import {
  CustomEvents,
  getBatchResolutionLongerSide,
  MediaBatchCompressionResult,
} from '@/types/compression'
import { formatBytes, getOutputFileName } from '@/utils/fs'
import CancelCompression from './CancelCompression'
import PauseCompression from './PauseCompression'
import SaveMedia from './SaveMedia'
import {
  getMediaItemConfig,
  getOutputOptions,
  getQualitySizeEstimate,
  getTargetSizePlan,
  type MediaFile,
  waitForDropZone,
} from '../-compression'
import { recordMainWindowHistory } from '../-history'
import {
  autoCopyCompressedMediaToClipboard,
  autoSaveCompressedMedia,
} from '../-save'
import {
  estimateTargetSizeVideos,
  needsQualityEstimate,
} from '../-sizeEstimate'
import { appProxy } from '../-state'

function StartCompression() {
  const { t } = useTranslation()

  // A video missed its target size & is compressed again (see `ffmpeg.rs`): the round is shown on
  // it while it lasts, so the time it takes is understood
  useEffect(() => {
    const unlisten = event.listen<{
      videoId: string
      pass: number
      onCpu: boolean
    }>('target-size-retry', ({ payload }) => {
      const media = appProxy.state.media.find(
        (mediaFile) => mediaFile.id === payload?.videoId,
      )
      if (media?.type === 'video') {
        media.targetSizeRound = {
          round: payload.pass,
          isWithoutHardwareAcceleration: payload.onCpu,
        }
      }
    })
    return () => {
      unlisten.then((stop) => stop()).catch(() => {})
    }
  }, [])
  const {
    state: {
      selectedMediaIndexForCustomization,
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)

  const handleCompression = useCallback(async () => {
    if (appProxy.state.isCompressing) return
    // A number still being typed is entered (inputs take it when they lose focus), & changes not
    // yet saved to the settings (e.g. just before, see `useSyncState`) are saved, so they are used
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
      // The value entered reaches `useSyncState` a moment later (valtio notifies after a tick)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    flushSyncStates()
    const appSnapshot = snapshot(appProxy)
    if (appSnapshot.state.isCompressing) return

    // Resets
    appProxy.clearSnapshots()
    appProxy.state.isBatchCompressionCancelled = false
    appProxy.state.selectedMediaIndexForCustomization = -1
    appProxy.state.showMediaInfo = false
    for (const index in appProxy.state.media) {
      if (appProxy.state.media[index].type === 'video') {
        appProxy.state.media[index].config.isVideoTransformEditMode = false
        appProxy.state.media[index].config.isVideoTrimEditMode = false
      } else if (appProxy.state.media[index].type === 'image') {
        appProxy.state.media[index].config.isImageTransformEditMode = false
      }
    }

    appProxy.takeSnapshot('beforeCompressionStarted')

    try {
      appProxy.state.isCompressing = true
      appProxy.state.isBatchPaused = false

      for (const index in appProxy.state.media) {
        if (appProxy.state.media[index].type === 'video') {
          if (
            appProxy.state.media[index]?.config?.shouldTransformVideo &&
            appProxy.state.media[index].config?.transformVideoConfig?.previewUrl
          ) {
            appProxy.state.media[index].thumbnailPath =
              appProxy.state.media[
                index
              ]?.config?.transformVideoConfig?.previewUrl
          }
          appProxy.state.media[index].config.isVideoTransformEditMode = false
          appProxy.state.media[index].targetSizeRound = null
        } else if (appProxy.state.media[index].type === 'image') {
          if (
            appProxy.state.media[index]?.config?.shouldTransformImage &&
            appProxy.state.media[index].config?.transformImageConfig?.previewUrl
          ) {
            appProxy.state.media[index].thumbnailPath =
              appProxy.state.media[
                index
              ]?.config?.transformImageConfig?.previewUrl
          }
          appProxy.state.media[index].config.isImageTransformEditMode = false
        }
      }

      const batchId = `${+new Date()}`
      appProxy.state.batchId = batchId

      const abortController = new AbortController()
      const unlisten = await event.listen(
        CustomEvents.CancelInProgressCompression,
        () => {
          abortController.abort()
        },
      )

      // A batch resolution applies to every video of a batch without its own custom dimensions
      const batchVideoLongerSide =
        appSnapshot.state.media.length > 1
          ? getBatchResolutionLongerSide(
              appSnapshot.state.commonConfigForBatchCompression.videoConfig
                .batchResolution,
            )
          : null

      // Size of the longer side of a batch's images (from a preset)
      const batchImageLongerSide =
        appSnapshot.state.media.length > 1
          ? (appSnapshot.state.commonConfigForBatchCompression.imageConfig
              .batchLongerSide ?? null)
          : null

      // Cancelling (also while waiting for the drop zone) stops waiting for the compression
      const cancellation = new Promise<never>((_, reject) => {
        abortController.signal.addEventListener('abort', () => {
          unlisten()
          reject('CANCELLED')
        })
      })
      cancellation.catch(() => {})

      // The drop zone finishes the media it is compressing first (it does not start more meanwhile,
      // as this window is compressing)
      const dropZone = await getDropQueue().catch(() => [])
      if (dropZone.some((item) => item.status === 'compressing')) {
        appProxy.state.isWaitingForDropZone = true
        try {
          await Promise.race([
            waitForDropZone(abortController.signal),
            cancellation,
          ])
        } finally {
          appProxy.state.isWaitingForDropZone = false
        }
      }

      // Videos compressed to a size are compressed at their quality settings when those fit, so
      // their size at them is estimated first (when not already)
      const mediaToEstimate = appSnapshot.state.media.filter((v) =>
        needsQualityEstimate(v as MediaFile, batchVideoLongerSide),
      ) as MediaFile[]
      if (mediaToEstimate.length > 0) {
        appProxy.state.isEstimatingSize = true
        try {
          await Promise.race([
            estimateTargetSizeVideos(
              mediaToEstimate,
              batchVideoLongerSide,
              abortController.signal,
            ),
            cancellation,
          ])
        } finally {
          appProxy.state.isEstimatingSize = false
        }
      }
      // The size each video compressed to a target size comes out at, shown while compressing
      for (const index in appProxy.state.media) {
        const item = appProxy.state.media[index]
        if (item.type !== 'video') continue
        const plan = getTargetSizePlan(
          snapshot(item) as MediaFile,
          batchVideoLongerSide,
        )
        const qualitySize = plan
          ? getQualitySizeEstimate(
              snapshot(item) as MediaFile,
              batchVideoLongerSide,
            )
          : null
        item.estimatedOutputSize = !plan
          ? null
          : plan.fitsAtQuality && qualitySize != null
            ? {
                sizeInBytes: Math.min(qualitySize, plan.sizeInBytes),
                isUpTo: false,
              }
            : { sizeInBytes: plan.sizeInBytes, isUpTo: true }
      }

      const { results } = (await Promise.race([
        compressMediaBatch(
          batchId,
          appSnapshot.state.media.map((v) =>
            getMediaItemConfig(v as MediaFile, {
              batchVideoLongerSide,
              batchImageLongerSide,
            }),
          ),
        ),
        cancellation,
      ])) as MediaBatchCompressionResult

      unlisten()

      if (Object.keys(results).length === 0) {
        throw new Error()
      }

      appProxy.state.isCompressing = false
      appProxy.state.isBatchPaused = false
      appProxy.state.isProcessCompleted = true

      for (const index in appProxy.state.media) {
        if (appProxy.state.media[index].type === 'video') {
          const video = appProxy.state.media[index]
          const videoResult = results[video.id!] || null

          appProxy.state.media[index].isProcessCompleted = true
          appProxy.state.media[index].compressedFile = {
            isSuccessful: !(videoResult == null),
            fileName: videoResult?.fileMetadata?.fileName ?? video.fileName,
            fileNameToDisplay: getOutputFileName(
              video.fileName,
              video.extension,
              videoResult?.fileMetadata?.extension,
            ),
            pathRaw: videoResult?.fileMetadata?.path,
            path: core.convertFileSrc(videoResult?.fileMetadata?.path ?? ''),
            mimeType: videoResult?.fileMetadata?.mimeType,
            sizeInBytes: videoResult?.fileMetadata?.size,
            size: formatBytes(videoResult?.fileMetadata?.size ?? 0),
            extension: videoResult?.fileMetadata?.extension,
            ...getOutputOptions(videoResult, video.config?.targetSizeInMB),
          }
        } else if (appProxy.state.media[index].type === 'image') {
          const image = appProxy.state.media[index]
          const imageResult = results[image.id!] || null

          appProxy.state.media[index].isProcessCompleted = true
          appProxy.state.media[index].compressedFile = {
            isSuccessful: !(imageResult == null),
            fileName: imageResult?.fileName ?? image.fileName,
            fileNameToDisplay: getOutputFileName(
              image.fileName,
              image.extension,
              imageResult?.fileMetadata?.extension,
            ),
            pathRaw: imageResult?.fileMetadata?.path,
            path: core.convertFileSrc(imageResult?.fileMetadata?.path ?? ''),
            mimeType: imageResult?.fileMetadata?.mimeType,
            sizeInBytes: imageResult?.fileMetadata?.size,
            size: formatBytes(imageResult?.fileMetadata?.size ?? 0),
            extension: imageResult?.fileMetadata?.extension,
          }
        }
      }

      // Once for the whole compression (a batch too), when anything was compressed
      if (
        settingsStore.playCompletionSound &&
        appProxy.state.media.some(
          (mediaFile) => mediaFile.compressedFile?.isSuccessful,
        )
      ) {
        playCompletionSound().catch(() => {})
      }

      // Saves right away when a save location is set in Settings (Output -> Save location)
      await autoSaveCompressedMedia()
      // Once saved automatically, so the saved outputs are recorded where they were saved
      recordMainWindowHistory(batchId)
      await autoCopyCompressedMediaToClipboard()
    } catch (error) {
      if (error !== 'CANCELLED') {
        toast.error(t('compression.failed'))
        appProxy.timeTravel('beforeCompressionStarted')
      }
    }
  }, [t])

  // ⌘+Shift+Enter acts like the Process button (cancelling is handled by CancelCompression)
  const isShortcutEnabled =
    selectedMediaIndexForCustomization < 0 &&
    !isCompressing &&
    !isProcessCompleted &&
    !isLoadingMediaFiles
  useCommandEnterShortcut(isShortcutEnabled, handleCompression)
  // Holding ⌘ (Ctrl) reveals the shortcut on the button
  const isCommandKeyHeld = useCommandKeyHeld(isShortcutEnabled)

  return selectedMediaIndexForCustomization < 0 ? (
    <div className="mt-4">
      {isCompressing ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CancelCompression />
          </div>
          <PauseCompression />
        </div>
      ) : isProcessCompleted ? (
        <SaveMedia />
      ) : (
        <Button
          as={motion.button}
          onPress={handleCompression}
          fullWidth
          className="w-full"
          color="primary"
          variant="solid"
          isDisabled={isLoadingMediaFiles}
        >
          {t('compression.process')}
          <ShortcutHint isVisible={isCommandKeyHeld} />
        </Button>
      )}
    </div>
  ) : null
}

export default StartCompression
