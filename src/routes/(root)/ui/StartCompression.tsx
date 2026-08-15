import { core, event } from '@tauri-apps/api'
import { TimelineAction } from '@xzdarcy/timeline-engine'
import { motion } from 'framer-motion'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import { compressMediaBatch } from '@/tauri/commands/media'
import { MediaMetadataConfig } from '@/types/app'
import {
  CustomEvents,
  ImageCompressionConfig,
  MediaBatchCompressionResult,
  MediaTransformHistory,
  VideoCompressionConfig,
  VideoTrimSegment,
} from '@/types/compression'
import { formatBytes } from '@/utils/fs'
import CancelCompression from './CancelCompression'
import SaveMedia from './SaveMedia'
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

      const { results } = (await Promise.race([
        compressMediaBatch(
          batchId,
          appSnapshot.state.media.map((v) => ({
            videoConfig:
              v.type === 'video'
                ? ({
                    videoId: v.id!,
                    videoPath: v.pathRaw!,
                    convertToExtension: (v.config?.convertToExtension === '-'
                      ? v.extension
                      : v.config.convertToExtension)!,
                    presetName: !v.config?.shouldDisableCompression
                      ? v.config.presetName
                      : null,
                    quality: !v.config?.shouldDisableCompression
                      ? (v.config?.quality as number)
                      : 101,
                    audioConfig: {
                      volume: v.config?.audioConfig?.volume ?? 100,
                      audioChannelConfig:
                        (v.config?.audioConfig?.volume ?? 100) !== 0
                          ? (v.config?.audioConfig?.audioChannelConfig ?? null)
                          : null,
                      bitrate:
                        (v.config?.audioConfig?.volume ?? 100) !== 0
                          ? (v.config?.audioConfig?.bitrate ?? null)
                          : null,
                      audioCodec:
                        v.config?.shouldEnableCustomAudioCodec &&
                        v.config.audioConfig?.audioCodec !== '-'
                          ? (v.config?.audioConfig?.audioCodec ?? null)
                          : null,
                      selectedAudioTracks:
                        v.config?.shouldEnableAudioTrackSelection &&
                        (v.config?.audioConfig?.volume ?? 100) !== 0
                          ? (v.config?.selectedAudioTracks ?? null)
                          : null,
                    },
                    dimensions:
                      v.config?.shouldEnableCustomDimensions &&
                      v.config.customDimensions
                        ? ([
                            Math.round(v.config.customDimensions[0]),
                            Math.round(v.config.customDimensions[1]),
                          ] as [number, number])
                        : null,

                    speed:
                      v.config?.shouldEnableCustomSpeed &&
                      v.config.customSpeed !== 1
                        ? v.config.customSpeed
                        : null,
                    fps: v.config?.shouldEnableCustomFPS
                      ? v.config.customFPS?.toString?.()
                      : null,
                    videoCodec:
                      v.config?.shouldEnableCustomVideoCodec &&
                      v.config?.customVideoCodec !== '-'
                        ? v.config.customVideoCodec
                        : null,
                    transformHistory: v.config?.shouldTransformVideo
                      ? ((v.config.transformVideoConfig?.transformHistory ??
                          []) as MediaTransformHistory[])
                      : null,
                    stripMetadata: v.config?.shouldStripMetadata,
                    metadataConfig:
                      !v.config?.shouldStripMetadata && v.config?.metadataConfig
                        ? Object.entries(
                            v.config?.metadataConfig as MediaMetadataConfig,
                          ).reduce(
                            (a, [key, value]: [string, any]) => {
                              a[key] = value?.length > 0 ? value : null
                              return a
                            },
                            {} as Record<string, string>,
                          )
                        : null,
                    customThumbnailPath:
                      v.config?.shouldEnableCustomThumbnail &&
                      v.config?.customThumbnailPath?.length
                        ? v.config.customThumbnailPath
                        : null,
                    trimSegments:
                      v.config?.shouldTrimVideo &&
                      Array.isArray(v.config?.trimConfig)
                        ? (v.config.trimConfig
                            .filter((a) => a.end >= a.start)
                            .map(
                              (action: TimelineAction): VideoTrimSegment => ({
                                start: action.start,
                                end: action.end,
                              }),
                            ) as VideoTrimSegment[])
                        : null,
                    subtitlesConfig:
                      (v.config?.subtitlesConfig?.shouldEnableSubtitles &&
                        v.config?.subtitlesConfig?.subtitles?.length > 0) ||
                      v.config?.subtitlesConfig?.preserveExistingSubtitles ===
                        true
                        ? {
                            subtitles:
                              v.config.subtitlesConfig?.subtitles?.map((s) => ({
                                subtitlePath: s.subtitlePath ?? null,
                                language: s.language || 'eng',
                                fileName: s.fileName ?? null,
                                title: s.title,
                              })) ?? [],
                            shouldEnableSubtitles:
                              v.config.subtitlesConfig.shouldEnableSubtitles ??
                              false,
                            preserveExistingSubtitles:
                              v.config.subtitlesConfig
                                .preserveExistingSubtitles,
                          }
                        : null,
                  } satisfies VideoCompressionConfig)
                : undefined,
            imageConfig:
              v.type === 'image'
                ? ({
                    imageId: v.id!,
                    convertToExtension: (v.config.convertToExtension === '-'
                      ? v.extension
                      : v.config.convertToExtension)!,
                    imagePath: v.pathRaw!,
                    isLossless: v.config.isLossless,
                    quality: v.config.isLossless
                      ? 100
                      : (v.config.quality ?? 100),
                    stripMetadata: v.config.shouldStripMetadata,
                    svgScaleFactor: v.config.svgScaleFactor ?? null,
                    svgConfig: v.config?.shouldEnableAdvancedSvgSetting
                      ? (v.config.svgConfig ?? null)
                      : null,
                    dimensions:
                      v.config?.shouldEnableCustomDimensions &&
                      v.config.customDimensions
                        ? ([
                            v.config.customDimensions[0],
                            v.config.customDimensions[1],
                          ] as [number, number])
                        : null,
                    transformHistory: v.config?.shouldTransformImage
                      ? (v.config.transformImageConfig?.transformHistory as
                          | MediaTransformHistory[]
                          | null)
                      : null,
                  } satisfies ImageCompressionConfig)
                : undefined,
          })),
        ),
        new Promise((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            unlisten()
            reject('CANCELLED')
          })
        }),
      ])) as MediaBatchCompressionResult

      unlisten()

      if (Object.keys(results).length === 0) {
        throw new Error()
      }

      appProxy.state.isCompressing = false
      appProxy.state.isProcessCompleted = true

      for (const index in appProxy.state.media) {
        if (appProxy.state.media[index].type === 'video') {
          const video = appProxy.state.media[index]
          const videoResult = results[video.id!] || null

          appProxy.state.media[index].isProcessCompleted = true
          appProxy.state.media[index].compressedFile = {
            isSuccessful: !(videoResult == null),
            fileName: videoResult?.fileMetadata?.fileName ?? video.fileName,
            fileNameToDisplay: `${video?.fileName?.slice(
              0,
              -((video?.extension?.length ?? 0) + 1),
            )}.${videoResult?.fileMetadata?.extension}`,
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
            fileNameToDisplay: `${image?.fileName?.slice(
              0,
              -((image?.extension?.length ?? 0) + 1),
            )}.${imageResult?.fileMetadata?.extension}`,
            pathRaw: imageResult?.fileMetadata?.path,
            path: core.convertFileSrc(imageResult?.fileMetadata?.path ?? ''),
            mimeType: imageResult?.fileMetadata?.mimeType,
            sizeInBytes: imageResult?.fileMetadata?.size,
            size: formatBytes(imageResult?.fileMetadata?.size ?? 0),
            extension: imageResult?.fileMetadata?.extension,
          }
        }
      }
    } catch (error) {
      if (error !== 'CANCELLED') {
        toast.error('压缩过程中出现错误。')
        appProxy.timeTravel('beforeCompressionStarted')
      }
    }
  }, [])

  return selectedMediaIndexForCustomization < 0 ? (
    <div className="mt-4">
      {isCompressing ? (
        <CancelCompression />
      ) : isProcessCompleted ? (
        <SaveMedia />
      ) : (
        <Button
          as={motion.button}
          onPress={handleCompression}
          fullWidth
          className="w-full text-primary bg-primary/20"
          isDisabled={isLoadingMediaFiles}
        >
          开始处理
        </Button>
      )}
    </div>
  ) : null
}

export default StartCompression
