import { Button } from '@heroui/react'
import { core } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PhotoView } from 'react-photo-view'
import { OnProgressProps } from 'react-player/base'
import { toast } from 'sonner'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Image from '@/components/Image'
import ImageViewer from '@/components/ImageViewer'
import Popover, { PopoverContent, PopoverTrigger } from '@/components/Popover'
import useTimelineEngine from '@/components/Timeline/useTimelineEngine'
import Tooltip from '@/components/Tooltip'
import VideoPlayer, { VideoPlayerRef } from '@/components/VideoPlayer'
import { generateVideoThumbnail } from '@/tauri/commands/ffmpeg'
import { copyFileToClipboard } from '@/tauri/commands/fs'
import VideoTrimmerTimeline, {
  rowIds,
  scales,
  VideoTrimmerTimelineRef,
} from '@/ui/VideoTrimmerTimeline'
import { formatDuration } from '@/utils/string'
import { getTransformPreview } from '@/utils/transform'
import MediaTransformer from './MediaTransformer'
import { appProxy } from '../-state'

function pickRandomTimestamp(durationMs: number): string {
  const durationSeconds = durationMs / 1000
  // Avoid the first 5% and last 5% of the video to get more interesting frames
  const minSeconds = durationSeconds * 0.05
  const maxSeconds = durationSeconds * 0.95

  const randomSeconds = minSeconds + Math.random() * (maxSeconds - minSeconds)

  return formatDuration(randomSeconds)
}

type MediaThumbnailProps = {
  mediaIndex: number
}

function MediaThumbnail({ mediaIndex }: MediaThumbnailProps) {
  if (mediaIndex < 0) return

  const {
    state: { media, isSaved },
  } = useSnapshot(appProxy)
  const mediaFile = media.length > 0 ? media[mediaIndex] : null
  const {
    path: mediaPath,
    pathRaw: mediaPathRaw,
    compressedFile,
    isProcessCompleted,
  } = mediaFile ?? {}
  const { thumbnailPath: videoThumbnailPath } = mediaFile ?? {}
  const {
    shouldTransformVideo,
    isVideoTransformEditMode,
    trimConfig,
    isVideoTrimEditMode,
    shouldTrimVideo,
  } = mediaFile?.type === 'video' ? (mediaFile?.config ?? {}) : {}

  const { shouldTransformImage, isImageTransformEditMode } =
    mediaFile?.type === 'image' ? (mediaFile?.config ?? {}) : {}

  const playerRef = useRef<VideoPlayerRef | null>(null)
  const trimmerRef = useRef<VideoTrimmerTimelineRef | null>(null)
  const trimConfigSetDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const [isThumbnailRegenerating, setIsThumbnailRegenerating] = useState(false)
  const thumbnailCacheRef = useRef<Record<string, string>>({})
  const [isCopyingFrame, setIsCopyingFrame] = useState(false)

  const handleCopyCurrentFrame = useCallback(async () => {
    const targetMedia = appProxy.state.media[mediaIndex]
    if (
      !targetMedia ||
      targetMedia.type !== 'video' ||
      !targetMedia.videoDuration ||
      !mediaPathRaw ||
      !playerRef.current
    ) {
      toast.error('Unable to copy frame')
      return
    }

    setIsCopyingFrame(true)
    try {
      const currentTime = playerRef.current.playerRef?.getCurrentTime?.() ?? 0
      const videoDuration = targetMedia.videoDuration
      const targetDuration =
        currentTime >= videoDuration
          ? currentTime - 0.02
          : currentTime <= 0
            ? 0.02
            : currentTime
      const timestamp = formatDuration(targetDuration)

      const result = await generateVideoThumbnail(mediaPathRaw, timestamp)

      await copyFileToClipboard(result.filePath)
      toast.success('Frame copied to clipboard')
    } catch {
      toast.error('Failed to copy frame to clipboard')
    } finally {
      setIsCopyingFrame(false)
    }
  }, [mediaPathRaw, mediaIndex])

  const handleRegenerateThumbnail = useCallback(
    async (timeStamp?: string, retries = 2, forced = false) => {
      const targetMedia = appProxy.state.media[mediaIndex]

      if (
        !targetMedia ||
        targetMedia.type !== 'video' ||
        !targetMedia.videoDuration ||
        !mediaPathRaw ||
        (forced ? false : isThumbnailRegenerating)
      )
        return

      setIsThumbnailRegenerating(true)
      try {
        const videoDuration = targetMedia.videoDuration
        const result = await generateVideoThumbnail(
          mediaPathRaw,
          timeStamp ?? pickRandomTimestamp(videoDuration * 1000),
        )
        appProxy.state.media[mediaIndex].thumbnailPathRaw = result.filePath
        appProxy.state.media[mediaIndex].thumbnailPath = core.convertFileSrc(
          result.filePath,
        )
      } catch {
        if (retries > 0) {
          handleRegenerateThumbnail('00:00:01.00', retries - 1)
        }
      } finally {
        setIsThumbnailRegenerating(false)
      }
    },
    [mediaPathRaw, mediaIndex, isThumbnailRegenerating],
  )

  const seekPlayerTo = useCallback((time: number, onPausedOnly = true) => {
    if (playerRef.current?.playerRef) {
      const playbackState = playerRef.current.getPlaybackState()
      if (onPausedOnly) {
        playbackState === 'paused' && playerRef.current.playerRef.seekTo(time)
      } else {
        playerRef.current.playerRef.seekTo(time, 'seconds')
      }
    }
  }, [])

  const {
    setTime: setTimelineTime,
    autoScrollCursorToCurrentTime,
    refreshTimeline,
  } = useTimelineEngine({
    timelineState: trimmerRef,
    totalDuration:
      mediaFile?.type === 'video' ? (mediaFile.videoDuration ?? 0) : 0,
    onPlay: () => {
      playerRef.current?.playVideo?.()
    },
    onPause: () => {
      playerRef.current?.pauseVideo?.()
    },
    onEnd: () => {
      playerRef.current?.pauseVideo?.()
    },
    onSeek: seekPlayerTo,
  })

  // Crop on the frame at the current playback time when the transform editor opens. Driven by the
  // snapshot value (not `subscribeKey` on the config object), since the config/media objects get
  // replaced (batch config normalization, resets, snapshot restores) which left a subscription stale.
  useEffect(() => {
    if (!isVideoTransformEditMode) return

    const generateThumbnailAtCurrentTime = async () => {
      const targetMedia = appProxy.state.media[mediaIndex]
      if (
        targetMedia?.type !== 'video' ||
        !targetMedia.pathRaw ||
        !(playerRef.current || trimmerRef.current)
      )
        return

      playerRef.current?.pauseVideo()
      const currentTime = playerRef.current
        ? playerRef.current.playerRef?.getCurrentTime?.()
        : trimmerRef.current?.getTime?.()
      if (currentTime == null || Number.isNaN(currentTime)) return

      try {
        const targetDuration =
          currentTime >= targetMedia.videoDuration!
            ? currentTime - 0.02
            : currentTime <= 0
              ? 0.02
              : currentTime
        const timestamp = formatDuration(targetDuration)

        let thumbnailPath = thumbnailCacheRef.current[timestamp]

        if (!thumbnailPath) {
          const result = await generateVideoThumbnail(
            targetMedia.pathRaw,
            timestamp,
          )

          thumbnailPath = result.filePath
          thumbnailCacheRef.current[timestamp] = thumbnailPath
        }

        // Re-read in case the media entry was replaced while generating
        const latestMedia = appProxy.state.media[mediaIndex]
        if (
          latestMedia?.type === 'video' &&
          latestMedia.pathRaw === targetMedia.pathRaw
        ) {
          latestMedia.thumbnailPathRaw = thumbnailPath
          latestMedia.thumbnailPath = core.convertFileSrc(thumbnailPath)
        }
      } catch {}
    }

    generateThumbnailAtCurrentTime()
  }, [isVideoTransformEditMode, mediaIndex])

  // biome-ignore lint/correctness/useExhaustiveDependencies: <Clear thumbnail cache when video changes>
  useEffect(() => {
    thumbnailCacheRef.current = {}
  }, [mediaIndex])

  // When the trim editor opens/closes, pause (on open) and move the timeline playhead to the
  // player's current time. Driven by the snapshot value rather than `subscribeKey` on the config
  // object, which went stale whenever the config/media objects were replaced.
  const previousTrimEditModeRef = useRef(isVideoTrimEditMode)
  useEffect(() => {
    if (previousTrimEditModeRef.current === isVideoTrimEditMode) return
    previousTrimEditModeRef.current = isVideoTrimEditMode

    if (!playerRef.current) return
    if (isVideoTrimEditMode) {
      playerRef.current.pauseVideo()
    }

    const timeoutId = setTimeout(() => {
      const currentTime = playerRef.current?.playerRef?.getCurrentTime?.()
      if (currentTime != null && !Number.isNaN(currentTime)) {
        setTimelineTime(currentTime)
        autoScrollCursorToCurrentTime(scales, {
          onlyOnOutOfView: false,
        })
      }
    }, 100)
    return () => clearTimeout(timeoutId)
  }, [isVideoTrimEditMode, autoScrollCursorToCurrentTime, setTimelineTime])

  const showTrimmerLayout =
    shouldTrimVideo && isVideoTrimEditMode && !isProcessCompleted

  const showTransformerLayout =
    ((shouldTransformVideo && isVideoTransformEditMode) ||
      (shouldTransformImage && isImageTransformEditMode)) &&
    !isProcessCompleted

  // Rendered result of the crop/rotate/flip, so the preview reflects the applied transforms
  const transformedThumbnailPreview =
    mediaFile?.type === 'image' && shouldTransformImage
      ? mediaFile.config.transformImageConfig?.previewUrl
      : mediaFile?.type === 'video' && shouldTransformVideo
        ? mediaFile.config.transformVideoConfig?.previewUrl
        : undefined

  // Animated gifs preview the transforms live with css (like videos) instead of the still snapshot
  const gifTransformPreview = useMemo(
    () =>
      mediaFile?.type === 'image' &&
      mediaFile.extension === 'gif' &&
      shouldTransformImage &&
      !isProcessCompleted &&
      mediaFile.config.transformImageConfig?.transformHistory &&
      mediaFile.dimensions
        ? getTransformPreview(
            mediaFile.config.transformImageConfig.transformHistory,
            mediaFile.dimensions.width,
            mediaFile.dimensions.height,
          )
        : null,
    [mediaFile, shouldTransformImage, isProcessCompleted],
  )

  const thumbnailPath =
    (gifTransformPreview ? undefined : transformedThumbnailPreview) ??
    (mediaFile?.type === 'video' ? videoThumbnailPath : mediaPath)

  // The compressed output already has the transforms applied
  const videoTransformHistory =
    mediaFile?.type === 'video' && shouldTransformVideo && !isProcessCompleted
      ? mediaFile.config.transformVideoConfig?.transformHistory
      : null

  // Kept segments, so the player timeline can mark the trimmed out parts
  const trimSegments = useMemo(
    () =>
      shouldTrimVideo ? trimConfig?.filter((a) => a.end >= a.start) : null,
    [shouldTrimVideo, trimConfig],
  )

  // Re-compressing writes to the same output file, so give each result a unique url to
  // bypass the webview's image cache (otherwise a previous result can be shown)
  const compressedFileSrc = useMemo(
    () =>
      compressedFile?.path ? `${compressedFile.path}?v=${Date.now()}` : '',
    [compressedFile],
  )

  const imageToRenderSrc = isProcessCompleted
    ? mediaFile?.type === 'video' &&
      mediaFile?.previewMode === 'image' &&
      mediaFile?.compressedFile?.extension !== 'gif'
      ? mediaFile?.thumbnailPath!
      : isSaved
        ? core.convertFileSrc(mediaFile?.compressedFile?.savedPath!)
        : compressedFileSrc
    : thumbnailPath!

  return (
    <>
      <div className="relative w-full">
        <div className="relative w-full px-4">
          {mediaFile?.type === 'video' &&
          mediaFile.previewMode === 'video' &&
          mediaPath &&
          (mediaFile?.isProcessCompleted
            ? mediaFile?.compressedFile?.extension !== 'gif'
            : true) ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <VideoPlayer
                ref={playerRef}
                url={
                  isProcessCompleted && compressedFile
                    ? compressedFile.path!
                    : mediaPath!
                }
                enableTimelinePlayer={
                  !(
                    showTrimmerLayout ||
                    showTransformerLayout ||
                    isProcessCompleted
                  )
                }
                progressInterval={10}
                controls={false}
                transformHistory={videoTransformHistory}
                trimSegments={trimSegments}
                playPauseOnSpaceKeydown={!showTransformerLayout}
                autoFocus
                containerClassName="w-full h-full"
                contextMenu={
                  !isProcessCompleted ? (
                    <div className="min-w-[120px] p-0">
                      <button
                        className="flex items-center gap-1 w-full px-2 py-2 text-xs text-left hover:bg-default-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleCopyCurrentFrame}
                        disabled={isCopyingFrame}
                      >
                        <Icon name="copy" size={20} />
                        <span>Copy current frame</span>
                      </button>
                    </div>
                  ) : null
                }
                style={{
                  width: '100%',
                  minWidth: '50vw',
                  maxHeight: '60vh',
                  aspectRatio:
                    (mediaFile?.dimensions?.width ?? 1) /
                    (mediaFile?.dimensions?.height ?? 1),
                }}
                config={{
                  file: {
                    attributes: {
                      crossOrigin: 'anonymous',
                    },
                    tracks: [],
                  },
                }}
                disableClosedCaptions
                onError={(error: any) => {
                  if (error.name !== 'AbortError') {
                    toast.warning('Switching to image thumbnail...')
                    if (appProxy.state.media[mediaIndex].type === 'video') {
                      appProxy.state.media[mediaIndex].previewMode = 'image'
                    }
                  }
                }}
                onProgress={({ playedSeconds }: OnProgressProps) => {
                  if (playerRef.current?.playerRef) {
                    setTimelineTime(playedSeconds)
                    autoScrollCursorToCurrentTime(scales)
                  }
                }}
                // ffmpeg duration is sometimes incorrect, so force set this duration to particular video
                onDuration={(duration: number) => {
                  if (
                    duration &&
                    !Number.isNaN(duration) &&
                    !appProxy.state.isProcessCompleted
                  ) {
                    if (appProxy.state.media[mediaIndex].type === 'video') {
                      appProxy.state.media[mediaIndex].videoDuration = duration
                    }
                    refreshTimeline()
                  }
                }}
                onPlay={() => {
                  setTimeout(() => {
                    autoScrollCursorToCurrentTime(scales)
                  }, 100)
                }}
                onArrowKeySeek={() => {
                  autoScrollCursorToCurrentTime(scales, {
                    onlyOnOutOfView: false,
                    smoothScrolling: true,
                  })
                }}
              />
            </motion.div>
          ) : (
            <div className="relative w-fit mx-auto">
              {gifTransformPreview ? (
                <div
                  className="relative overflow-hidden rounded-3xl border-1 border-zinc-200 dark:border-zinc-900"
                  style={{
                    aspectRatio: gifTransformPreview.aspectRatio,
                    // fit within 60vh without upscaling past the cropped size
                    width: `min(calc(60vh * ${gifTransformPreview.aspectRatio}), ${gifTransformPreview.croppedWidth}px)`,
                    maxWidth: '100%',
                  }}
                >
                  <div style={gifTransformPreview.frameStyle}>
                    <img
                      alt="image to compress"
                      src={imageToRenderSrc}
                      style={gifTransformPreview.mediaStyle}
                    />
                  </div>
                </div>
              ) : (
                <Image
                  alt="image to compress"
                  src={imageToRenderSrc}
                  className="object-contain rounded-3xl max-h-[60vh] border-1 border-zinc-200 dark:border-zinc-900 min-w-[100px] min-h-[100px]"
                  onError={() => {
                    if (!isProcessCompleted) {
                      handleRegenerateThumbnail('00:00:01.00', 0, true)
                    }
                  }}
                />
              )}
              {!showTransformerLayout ? (
                <div className="absolute bottom-3 right-3 z-[10] flex items-center gap-3 bg-zinc-900/10 dark:bg-zinc-900/40 min-h-[25px] px-2 rounded-2xl">
                  {mediaFile?.type === 'video' &&
                  mediaFile?.previewMode === 'image' ? (
                    <Popover>
                      <PopoverTrigger>
                        <button>
                          <Icon
                            name="info"
                            size={20}
                            className="cursor-pointer"
                          />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent>
                        <div className="py-2 px-1 max-w-[250px]">
                          <p>
                            This video is unable to play by this app because it
                            contains advanced codec/configurations. Such videos
                            require dedicated media players like VLC.
                          </p>
                          {!isProcessCompleted ? (
                            <>
                              <br />
                              <p>
                                Rest assured, you can still apply the output
                                settings and perform all the conversions.
                              </p>
                            </>
                          ) : null}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ) : null}
                  {mediaFile?.type === 'video' &&
                  mediaFile.videoDuration &&
                  !isProcessCompleted ? (
                    <>
                      <Button
                        size="sm"
                        variant="light"
                        isIconOnly
                        onPress={() => {
                          handleRegenerateThumbnail()
                        }}
                        isDisabled={isThumbnailRegenerating}
                        isLoading={isThumbnailRegenerating}
                        className="!p-0 !min-h-0 !py-2 !w-[unset] !min-w-[unset] !h-0 "
                      >
                        <Tooltip
                          content="Regenerate Thumbnail"
                          className="w-0! h-0!"
                        >
                          <Icon name="image" size={20} />
                        </Tooltip>
                      </Button>
                    </>
                  ) : null}

                  <ImageViewer
                    // @ts-ignore
                    providerProps={
                      mediaFile?.extension === 'svg' ||
                      (isProcessCompleted &&
                        mediaFile?.config?.convertToExtension === 'svg')
                        ? { photoWrapClassName: 'bg-zinc-800' }
                        : {}
                    }
                  >
                    <PhotoView
                      src={
                        (gifTransformPreview
                          ? transformedThumbnailPreview
                          : undefined) ?? imageToRenderSrc!
                      }
                    >
                      <div>
                        <Tooltip content="Enlarge image">
                          <Icon
                            name="zoom"
                            size={18}
                            className="cursor-pointer"
                          />
                        </Tooltip>
                      </div>
                    </PhotoView>
                  </ImageViewer>
                </div>
              ) : null}
            </div>
          )}
          {mediaFile?.type === 'video' &&
          showTrimmerLayout &&
          mediaFile.videoDuration ? (
            <div className="mt-4">
              <VideoTrimmerTimeline
                id="video-trimmer-1"
                ref={trimmerRef}
                duration={mediaFile.videoDuration}
                {...(trimConfig
                  ? {
                      initialTrimActions: trimConfig as any,
                    }
                  : {})}
                onActionResizing={(data) => {
                  if (playerRef.current?.playerRef) {
                    playerRef.current.playerRef.seekTo(
                      data.dir === 'left' ? data.start : data.end,
                    )
                  }
                }}
                onCursorDrag={seekPlayerTo}
                onClickTimeArea={(time) => {
                  seekPlayerTo(time, false)
                  return true
                }}
                onClickActionOnly={(_, { time }) => {
                  seekPlayerTo(time, false)
                  setTimelineTime(time)
                }}
                onEditorDataChange={(data) => {
                  if (trimConfigSetDebounceRef.current) {
                    clearTimeout(trimConfigSetDebounceRef.current)
                  }
                  trimConfigSetDebounceRef.current = setTimeout(() => {
                    const trimRow = data.find((d) => d.id === rowIds.videoTrim)
                    if (
                      trimRow &&
                      appProxy.state.media[mediaIndex].type === 'video' &&
                      appProxy.state.media[mediaIndex]?.config
                    ) {
                      appProxy.state.media[mediaIndex].config.trimConfig =
                        trimRow.actions
                    }
                  }, 250)
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
      {showTransformerLayout ? (
        <div className="absolute top-0 right-0 bottom-0 left-0 w-full h-full m-auto z-[10] p-4 bg-white1 dark:bg-black1 flex flex-col">
          <MediaTransformer mediaIndex={mediaIndex} />
        </div>
      ) : null}
    </>
  )
}

export default MediaThumbnail
