import { useEffect } from 'react'
import { subscribe } from 'valtio'

import {
  type CompressionStatus,
  setCompressionStatus,
} from '@/tauri/commands/compression'
import { appProxy } from './-state'

function getCompressionStatus(): CompressionStatus {
  const {
    media,
    isCompressing,
    isProcessCompleted,
    isBatchCompressionCancelled,
  } = appProxy.state
  const mediaCount = media.length
  const fileName = mediaCount === 1 ? (media[0].fileName ?? null) : null
  // Also the finished media of a cancelled batch
  const hasUnsavedOutput =
    isProcessCompleted &&
    media.some(
      (mediaFile) =>
        mediaFile.compressedFile?.isSuccessful &&
        !mediaFile.compressedFile?.isSaved,
    )

  if (isCompressing && mediaCount > 0) {
    // Same overall progress as the dock badge
    const progress =
      media.reduce(
        (sum, mediaFile) => sum + (mediaFile.compressionProgress ?? 0),
        0,
      ) / mediaCount
    return {
      state: 'compressing',
      progress: Math.round(progress),
      mediaCount,
      fileName,
      hasUnsavedOutput: false,
      isPaused: !!appProxy.state.isBatchPaused,
    }
  }
  if (
    isProcessCompleted &&
    !isBatchCompressionCancelled &&
    media.some((mediaFile) => mediaFile.compressedFile?.isSuccessful)
  ) {
    return {
      state: 'completed',
      progress: 100,
      mediaCount,
      fileName,
      hasUnsavedOutput,
    }
  }
  return { ...getIdleStatus(), hasUnsavedOutput }
}

/**
 * Reports the compression status to the backend, which asks for confirmation before quitting
 * during a compression, and on macOS shows it in the menu bar popover & keeps the window alive
 * (hidden) when it is closed during a compression.
 */
export function useCompressionStatusSync() {
  useEffect(() => {
    let lastSentStatus = ''
    const sync = () => {
      const status = getCompressionStatus()
      // Progress changes often; only actual changes are sent
      const serialized = JSON.stringify(status)
      if (serialized === lastSentStatus) return
      lastSentStatus = serialized
      setCompressionStatus(status).catch(() => {})
    }

    sync()
    // The whole proxy, since resetting or going back a step replaces `appProxy.state`
    const unsubscribe = subscribe(appProxy, sync)
    return () => {
      unsubscribe()
      setCompressionStatus(getIdleStatus()).catch(() => {})
    }
  }, [])
}

function getIdleStatus(): CompressionStatus {
  return {
    state: 'idle',
    progress: 0,
    mediaCount: 0,
    fileName: null,
    hasUnsavedOutput: false,
  }
}
