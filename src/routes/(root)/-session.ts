import { core, event } from '@tauri-apps/api'
import cloneDeep from 'lodash/cloneDeep'
import { snapshot } from 'valtio'

import {
  type ActiveSession,
  clearActiveSession,
  getActiveSession,
  MAIN_SESSION_COMPLETED_EVENT,
  type MainSessionItemInfo,
  startMainSession,
  updateMainSessionState,
} from '@/tauri/commands/session'
import type { App } from '@/types/app'
import type { MediaCompressionResult } from '@/types/compression'
import { formatBytes, getOutputFileName } from '@/utils/fs'
import { isVideoPreviewAvailable } from '@/utils/video'
import {
  getOutputDuration,
  getOutputOptions,
  getVideoClipOutputs,
  type MediaFile,
} from './-compression'
import { buildContractForMedia } from './-presets'
import { appProxy } from './-state'

function resolveAssetUrl(pathRaw: string) {
  if (!pathRaw) return ''
  const normalized = /^[A-Za-z]:\\/.test(pathRaw)
    ? pathRaw.replace(/\\{2,}/g, '\\')
    : pathRaw
  return core.convertFileSrc(normalized)
}

function buildSessionItems(): MainSessionItemInfo[] {
  return snapshot(appProxy).state.media.map((item) => {
    const mediaType =
      item.type === 'image' ? 'image' : item.isAudioFile ? 'audio' : 'video'
    return {
      id: item.id ?? '',
      mediaType,
      pathRaw: item.pathRaw ?? '',
      fileName: item.fileName ?? '',
      sourceExtension: item.extension ?? '',
      relativeDir: item.relativeDir ?? '',
      sizeInBytes: item.sizeInBytes ?? null,
      presetId: item.config?.presetId ?? null,
      outputDurationMs: getOutputDuration(item as MediaFile),
      contract: buildContractForMedia(item as MediaFile),
    }
  })
}

export async function beginMainSession(batchId: string) {
  try {
    const stateClone = cloneDeep(snapshot(appProxy).state) as Record<
      string,
      unknown
    >
    await startMainSession({
      batchId,
      items: buildSessionItems(),
      appState: stateClone,
    })
  } catch {
    // Non-fatal in pure Vite dev mode
  }
}

export async function syncCompletedMainSession() {
  try {
    const snap = snapshot(appProxy).state
    const hasUnsaved =
      snap.isProcessCompleted &&
      snap.media.some(
        (m) => m.compressedFile?.isSuccessful && !m.compressedFile?.isSaved,
      )
    if (!hasUnsaved) {
      await clearActiveSession()
      return
    }
    const stateClone = cloneDeep(snap) as Record<string, unknown>
    await updateMainSessionState(stateClone, true)
  } catch {
    // Non-fatal
  }
}

function resetPendingMediaItem(mediaItem: App['media'][number]) {
  mediaItem.isCompressing = false
  mediaItem.isProcessCompleted = false
  mediaItem.compressionProgress = 0
  if (mediaItem.type === 'video') {
    mediaItem.targetSizeRound = null
    mediaItem.previewMode = isVideoPreviewAvailable ? 'video' : 'image'
  }
  delete mediaItem.compressedFile
  if (mediaItem.thumbnailPathRaw) {
    mediaItem.thumbnailPath = core.convertFileSrc(mediaItem.thumbnailPathRaw)
  }
}

export function buildSessionSnapshots(restored: App) {
  const beforeCompressionStarted = cloneDeep(restored)
  delete beforeCompressionStarted.batchId
  beforeCompressionStarted.isCompressing = false
  beforeCompressionStarted.isBatchPaused = false
  beforeCompressionStarted.isProcessCompleted = false
  beforeCompressionStarted.isBatchCompressionCancelled = false
  beforeCompressionStarted.isSaved = false
  beforeCompressionStarted.isSaving = false
  beforeCompressionStarted.isPreviewingClip = false
  beforeCompressionStarted.isWaitingForDropZone = false
  beforeCompressionStarted.totalProgress = 0
  for (const mediaItem of beforeCompressionStarted.media) {
    resetPendingMediaItem(mediaItem)
  }

  const batchCompressionStep = cloneDeep(restored)
  batchCompressionStep.isBatchPaused = false
  batchCompressionStep.isSaving = false
  batchCompressionStep.isSaved = false
  batchCompressionStep.isPreviewingClip = false
  batchCompressionStep.isWaitingForDropZone = false
  for (const mediaItem of batchCompressionStep.media) {
    if (!mediaItem.isProcessCompleted) {
      resetPendingMediaItem(mediaItem)
    }
  }

  return { beforeCompressionStarted, batchCompressionStep }
}

async function applySessionToProxy(session: ActiveSession) {
  const restored = cloneDeep(session.appState) as unknown as App
  if (!restored || !Array.isArray(restored.media)) return

  for (const mediaItem of restored.media) {
    const isVideo = mediaItem.type === 'video'
    if (isVideo) {
      mediaItem.previewMode = isVideoPreviewAvailable ? 'video' : 'image'
    }
    if (mediaItem.pathRaw) {
      mediaItem.path = resolveAssetUrl(mediaItem.pathRaw)
    }
    if (mediaItem.thumbnailPathRaw) {
      mediaItem.thumbnailPath = core.convertFileSrc(mediaItem.thumbnailPathRaw)
    }

    const id = mediaItem.id ?? ''
    const pct = session.progress?.[id]
    if (typeof pct === 'number' && !mediaItem.isProcessCompleted) {
      mediaItem.compressionProgress = pct
    }

    const finished = session.results?.[id] as MediaCompressionResult | undefined
    if (finished && !mediaItem.compressedFile?.isSuccessful) {
      mediaItem.isProcessCompleted = true
      mediaItem.isCompressing = false
      mediaItem.compressionProgress = 100
      if (finished.mediaType === 'video' && mediaItem.type === 'video') {
        const clips = getVideoClipOutputs(finished, mediaItem)
        for (const clip of clips) {
          if (clip.pathRaw) {
            clip.path = resolveAssetUrl(clip.pathRaw)
          }
        }
        const sizeInBytes = clips.length
          ? clips.reduce((s, c) => s + (c.sizeInBytes ?? 0), 0)
          : finished.fileMetadata?.size
        const primaryRaw = clips[0]?.pathRaw ?? finished.fileMetadata?.path
        mediaItem.compressedFile = {
          isSuccessful: true,
          fileName: clips[0]?.fileName ?? finished.fileMetadata?.fileName,
          fileNameToDisplay:
            clips[0]?.fileNameToDisplay ??
            getOutputFileName(
              mediaItem.fileName,
              mediaItem.extension,
              finished.fileMetadata?.extension,
            ),
          pathRaw: primaryRaw,
          path: primaryRaw ? resolveAssetUrl(primaryRaw) : '',
          mimeType: clips[0]?.mimeType ?? finished.fileMetadata?.mimeType,
          sizeInBytes,
          size: formatBytes(sizeInBytes ?? 0),
          extension: clips[0]?.extension ?? finished.fileMetadata?.extension,
          clips: clips.length ? clips : undefined,
          ...getOutputOptions(finished, mediaItem.config?.targetSizeInMB),
        }
      } else if (finished.mediaType === 'image' && mediaItem.type === 'image') {
        const raw = finished.fileMetadata?.path
        mediaItem.compressedFile = {
          isSuccessful: true,
          fileName: finished.fileName,
          fileNameToDisplay: getOutputFileName(
            mediaItem.fileName,
            mediaItem.extension,
            finished.fileMetadata?.extension,
          ),
          pathRaw: raw,
          path: raw ? core.convertFileSrc(raw) : '',
          mimeType: finished.fileMetadata?.mimeType,
          sizeInBytes: finished.fileMetadata?.size,
          size: formatBytes(finished.fileMetadata?.size ?? 0),
          extension: finished.fileMetadata?.extension,
        }
      }
    } else if (mediaItem.compressedFile) {
      const cf = mediaItem.compressedFile
      if (cf.pathRaw) {
        cf.path = resolveAssetUrl(cf.pathRaw)
      }
      if (isVideo && 'clips' in cf && Array.isArray(cf.clips)) {
        for (const clip of cf.clips) {
          if (clip.pathRaw) {
            clip.path = resolveAssetUrl(clip.pathRaw)
          }
        }
      }
    }
  }

  restored.batchId = session.batchId
  restored.isCompressing = session.status === 'compressing'
  restored.isBatchPaused = session.isPaused
  restored.isProcessCompleted = session.status === 'completed'
  const snapshots = buildSessionSnapshots(restored)
  appProxy.snapshots.beforeCompressionStarted =
    snapshots.beforeCompressionStarted
  appProxy.snapshots.batchCompressionStep = snapshots.batchCompressionStep
  appProxy.state = restored
}

/**
 * Hydrates an in-flight (reattached) or completed-unsaved (`Auto-Save OFF`) session into
 * `appProxy.state` when the main window mounts or reopens, and listens for detached completion.
 */
export function useMainSessionReattach() {
  let isMounted = true
  let unlisten: event.UnlistenFn | undefined

  const setup = async () => {
    unlisten = await event.listen<ActiveSession | null>(
      MAIN_SESSION_COMPLETED_EVENT,
      ({ payload }) => {
        if (!isMounted) return
        if (!payload) {
          appProxy.resetProxy()
          return
        }
        applySessionToProxy(payload).catch(() => {})
      },
    )

    if (appProxy.state.media.length > 0 || appProxy.state.isCompressing) return
    const session = await getActiveSession().catch(() => null)
    if (!isMounted || !session) return
    if (
      session.status === 'compressing' ||
      (session.status === 'completed' && session.hasUnsavedOutput)
    ) {
      await applySessionToProxy(session)
    }
  }

  setup().catch(() => {})
  return () => {
    isMounted = false
    unlisten?.()
  }
}
