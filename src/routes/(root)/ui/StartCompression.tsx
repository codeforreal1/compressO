import { core, event } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import ShortcutHint from '@/components/ShortcutHint'
import { useCommandEnterShortcut } from '@/hooks/useCommandEnterShortcut'
import { useCommandKeyHeld } from '@/hooks/useCommandKeyHeld'
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
  type MediaFile,
  waitForDropZone,
} from '../-compression'
import {
  autoCopyCompressedMediaToClipboard,
  autoSaveCompressedMedia,
} from '../-save'
import { appProxy } from '../-state'

function StartCompression() {
  const {
    state: {
      selectedMediaIndexForCustomization,
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)

  const handleCompression = useCallback(async () => {
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
      await autoCopyCompressedMediaToClipboard()
    } catch (error) {
      if (error !== 'CANCELLED') {
        toast.error('Something went wrong during compression.')
        appProxy.timeTravel('beforeCompressionStarted')
      }
    }
  }, [])

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
          className="w-full bg-primary"
          variant="solid"
          isDisabled={isLoadingMediaFiles}
        >
          Process
          <ShortcutHint isVisible={isCommandKeyHeld} />
        </Button>
      )}
    </div>
  ) : null
}

export default StartCompression
