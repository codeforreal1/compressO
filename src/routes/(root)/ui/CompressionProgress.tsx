import { core, event } from '@tauri-apps/api'
import { invoke } from '@tauri-apps/api/core'
import clamp from 'lodash/clamp'
import { memo, useEffect, useRef } from 'react'
import { snapshot, useSnapshot } from 'valtio'

import {
  BatchMediaCompressionProgress,
  BatchMediaIndividualCompressionResult,
  CustomEvents,
} from '@/types/compression'
import { formatBytes, getOutputFileName } from '@/utils/fs'
import { convertDurationToMilliseconds } from '@/utils/string'
import { getOutputDuration, getOutputOptions, MediaFile } from '../-compression'
import { appProxy } from '../-state'

async function updateDockProgress() {
  const media = snapshot(appProxy).state.media
  if (media.length === 0) return

  const totalProgress = media.reduce(
    (sum, media) => sum + (media.compressionProgress ?? 0),
    0,
  )
  const batchProgress = totalProgress / media.length

  try {
    await invoke('set_dock_progress', { progress: batchProgress })
  } catch {
    // Silently fail on non-macOS platforms
  }
}

async function clearDockProgress() {
  try {
    await invoke('clear_dock_badge')
  } catch {
    // Silently fail on non-macOS platforms
  }
}

function CompressionProgress() {
  const {
    state: { batchId },
  } = useSnapshot(appProxy)
  const compressionProgressUnlistenRef = useRef<event.UnlistenFn>()
  const individualCompressionResultUnlistenRef = useRef<event.UnlistenFn>()

  useEffect(() => {
    // Batch compression progress
    if (batchId) {
      ;(async () => {
        if (compressionProgressUnlistenRef.current) {
          compressionProgressUnlistenRef.current?.()
        }
        compressionProgressUnlistenRef.current =
          await event.listen<BatchMediaCompressionProgress>(
            CustomEvents.BatchMediaCompressionProgress,
            (evt) => {
              const payload = evt?.payload
              if (batchId === payload?.batchId) {
                const media = snapshot(appProxy).state.media
                const targetMediaIndex = media.findIndex(
                  (v) =>
                    v.id ===
                    (payload.mediaProgress.mediaType === 'video'
                      ? payload.mediaProgress.videoId
                      : payload.mediaProgress.imageId),
                )
                if (targetMediaIndex !== -1) {
                  appProxy.state.currentMediaIndex = targetMediaIndex
                  appProxy.state.media[targetMediaIndex].isCompressing = true

                  if (
                    payload.mediaProgress.mediaType === 'video' &&
                    media[targetMediaIndex].type === 'video'
                  ) {
                    // Only the trimmed parts, at the custom speed (see `getOutputDuration`)
                    const videoDurationInMilliseconds = getOutputDuration(
                      media[targetMediaIndex] as MediaFile,
                    )

                    const currentDurationInMilliseconds =
                      convertDurationToMilliseconds(
                        payload.mediaProgress.currentDuration,
                      )

                    if (
                      currentDurationInMilliseconds > 0 &&
                      videoDurationInMilliseconds >=
                        currentDurationInMilliseconds
                    ) {
                      appProxy.state.media[
                        targetMediaIndex
                      ].compressionProgress = clamp(
                        (currentDurationInMilliseconds * 100) /
                          videoDurationInMilliseconds,
                        0,
                        100,
                      )

                      updateDockProgress()
                    }
                  } else if (
                    payload.mediaProgress.mediaType === 'image' &&
                    media[targetMediaIndex].type === 'image'
                  ) {
                    appProxy.state.media[targetMediaIndex].compressionProgress =
                      clamp(payload.mediaProgress.progress, 0, 100)

                    updateDockProgress()
                  }
                }
              }
            },
          )
      })()

      // Individual compression progress
      ;(async () => {
        if (individualCompressionResultUnlistenRef.current) {
          individualCompressionResultUnlistenRef.current?.()
        }
        individualCompressionResultUnlistenRef.current =
          await event.listen<BatchMediaIndividualCompressionResult>(
            CustomEvents.BatchMediaIndividualCompressionCompletion,
            (evt) => {
              const payload = evt?.payload
              if (batchId === payload?.batchId && payload?.result) {
                const media = snapshot(appProxy).state.media
                const targetMediaIndex = media.findIndex(
                  (v) =>
                    v.id ===
                    (payload.result.mediaType === 'video'
                      ? payload.result.videoId
                      : payload.result.imageId),
                )
                if (targetMediaIndex !== -1) {
                  const fileMetadata = payload.result.fileMetadata
                  const originalMedia = media[targetMediaIndex]

                  appProxy.state.media[targetMediaIndex].isProcessCompleted =
                    true
                  appProxy.state.media[targetMediaIndex].isCompressing = false
                  appProxy.state.media[targetMediaIndex].compressionProgress =
                    100
                  appProxy.state.media[targetMediaIndex].compressedFile = {
                    isSuccessful: true,
                    fileName: fileMetadata?.fileName,
                    // This event can arrive after the final results, so it must name the file the
                    // same way (after the original, not the generated output file name)
                    fileNameToDisplay: getOutputFileName(
                      originalMedia.fileName,
                      originalMedia.extension,
                      fileMetadata?.extension,
                    ),
                    pathRaw: fileMetadata?.path,
                    path: core.convertFileSrc(fileMetadata?.path ?? ''),
                    mimeType: fileMetadata?.extension,
                    extension: fileMetadata?.extension,
                    size: formatBytes(fileMetadata?.size ?? 0),
                    sizeInBytes: fileMetadata?.size,
                    ...getOutputOptions(
                      payload.result,
                      originalMedia.type === 'video'
                        ? originalMedia.config?.targetSizeInMB
                        : null,
                    ),
                  }
                  if (appProxy.state.media.length > 1) {
                    appProxy.takeSnapshot('batchCompressionStep')
                  }

                  const allMediaCompleted = snapshot(
                    appProxy,
                  ).state?.media?.every((v) => v.isProcessCompleted)
                  if (allMediaCompleted) {
                    clearDockProgress()
                  } else {
                    updateDockProgress()
                  }
                }
              }
            },
          )
      })()
    }
    return () => {
      compressionProgressUnlistenRef.current?.()
      individualCompressionResultUnlistenRef.current?.()
      clearDockProgress()
    }
  }, [batchId])

  return null
}

export default memo(CompressionProgress)
