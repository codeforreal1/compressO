import { Button } from '@heroui/react'
import { core } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import isEqual from 'lodash/isEqual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useImagePreview } from '@/hooks/useImagePreview'
import { usePlayPauseOnSpace } from '@/hooks/usePlayPauseOnSpace'
import { generateVideoThumbnail } from '@/tauri/commands/ffmpeg'
import { copyFileToClipboard } from '@/tauri/commands/fs'
import { isAudioExtension } from '@/types/compression'
import VideoTrimmerTimeline, {
  rowIds,
  scales,
  VideoTrimmerTimelineRef,
} from '@/ui/VideoTrimmerTimeline'
import { formatDuration } from '@/utils/string'
import { getTransformPreview, renderTransformPreview } from '@/utils/transform'
import { constructVideoUrl, isVideoPreviewAvailable } from '@/utils/video'
import MediaTransformer from './MediaTransformer'
import { appProxy } from '../-state'

type MediaThumbnailProps = {
  mediaIndex: number
  /** Shows the media without its transforms (crop, rotation, flip), e.g. to compare */
  showOriginal?: boolean
}

function MediaThumbnail({ mediaIndex, showOriginal }: MediaThumbnailProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return

  const {
    state: { media },
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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
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
      toast.error(t('thumbnail.copyFrameUnavailable'))
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
      toast.success(t('thumbnail.frameCopied'))
    } catch {
      toast.error(t('thumbnail.copyFrameFailed'))
    } finally {
      setIsCopyingFrame(false)
    }
  }, [mediaPathRaw, mediaIndex, t])

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

  // Transforms set by a preset have no preview yet (the editor renders one when used), so it is
  // rendered here, for the media being shown
  const transformConfigToPreview =
    mediaFile?.type === 'image'
      ? shouldTransformImage && mediaFile.extension !== 'gif'
        ? mediaFile.config.transformImageConfig
        : undefined
      : mediaFile?.type === 'video' && shouldTransformVideo
        ? mediaFile.config.transformVideoConfig
        : undefined
  const isEditingTransform = !!(
    isImageTransformEditMode || isVideoTransformEditMode
  )
  useEffect(() => {
    const transforms = transformConfigToPreview?.transforms
    const thumbnailPathRaw = appProxy.state.media[mediaIndex]?.thumbnailPathRaw
    if (
      !transforms ||
      transformConfigToPreview?.previewUrl ||
      isEditingTransform ||
      isProcessCompleted ||
      !thumbnailPathRaw
    ) {
      return
    }
    let isCancelled = false
    renderTransformPreview(core.convertFileSrc(thumbnailPathRaw), transforms)
      .then((previewUrl) => {
        const targetMedia = appProxy.state.media[mediaIndex]
        const targetConfig =
          targetMedia?.type === 'image'
            ? targetMedia.config.transformImageConfig
            : targetMedia?.type === 'video'
              ? targetMedia.config.transformVideoConfig
              : undefined
        // Only for the transforms it was rendered for
        if (
          isCancelled ||
          !targetConfig ||
          targetConfig.previewUrl ||
          !isEqual(targetConfig.transforms, transforms)
        ) {
          URL.revokeObjectURL(previewUrl)
          return
        }
        targetConfig.previewUrl = previewUrl
      })
      .catch(() => {})
    return () => {
      isCancelled = true
    }
  }, [
    transformConfigToPreview,
    isEditingTransform,
    isProcessCompleted,
    mediaIndex,
  ])

  const showTransformerLayout =
    ((shouldTransformVideo && isVideoTransformEditMode) ||
      (shouldTransformImage && isImageTransformEditMode)) &&
    !isProcessCompleted

  // Rendered result of the crop/rotate/flip, so the preview reflects the applied transforms
  const transformedThumbnailPreview = showOriginal
    ? undefined
    : mediaFile?.type === 'image' && shouldTransformImage
      ? mediaFile.config.transformImageConfig?.previewUrl
      : mediaFile?.type === 'video' && shouldTransformVideo
        ? mediaFile.config.transformVideoConfig?.previewUrl
        : undefined

  // Animated gifs preview the transforms live with css (like videos) instead of the still snapshot
  const gifTransformPreview = useMemo(
    () =>
      !showOriginal &&
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
    [mediaFile, shouldTransformImage, isProcessCompleted, showOriginal],
  )

  const thumbnailPath =
    (gifTransformPreview ? undefined : transformedThumbnailPreview) ??
    mediaFile?.thumbnailPath ??
    mediaPath

  // The compressed output already has the transforms applied
  const videoTransformHistory =
    mediaFile?.type === 'video' &&
    shouldTransformVideo &&
    !isProcessCompleted &&
    !showOriginal
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
  const outputImagePreview = useImagePreview(
    mediaFile?.type === 'image'
      ? (compressedFile?.savedPath ?? compressedFile?.pathRaw)
      : undefined,
    compressedFile,
    thumbnailPath,
  )
  const compressedFileSrc = useMemo(
    () =>
      outputImagePreview ??
      (compressedFile?.path ? `${compressedFile.path}?v=${Date.now()}` : ''),
    [compressedFile, outputImagePreview],
  )

  // Saving moves the output out of the cache, so saved outputs are loaded from where they were saved
  const savedOutputSrc =
    compressedFile?.isSaved && compressedFile.savedPath
      ? (outputImagePreview ?? core.convertFileSrc(compressedFile.savedPath))
      : null

  // Audio extracted from a video: show the video's thumbnail with an audio player
  const isAudioOutput =
    !!isProcessCompleted && isAudioExtension(compressedFile?.extension)
  const audioOutputSrc = isAudioOutput
    ? (savedOutputSrc ?? compressedFileSrc)
    : undefined
  // Linux's webview cannot play media from asset links, so it is played through the app's local
  // server, as videos are (see `constructVideoUrl`); elsewhere the asset link is played as it is
  const [audioPlaybackSrc, setAudioPlaybackSrc] = useState<string>()
  useEffect(() => {
    if (!audioOutputSrc) {
      setAudioPlaybackSrc(undefined)
      return
    }
    let isCurrent = true
    ;(async () => {
      // Without the cache-busting `?v=`, which would be read as part of the file's path
      const [assetSrc] = audioOutputSrc.split('?')
      const serverSrc = await constructVideoUrl(assetSrc).catch(() => assetSrc)
      if (!isCurrent) return
      setAudioPlaybackSrc(
        serverSrc === assetSrc
          ? audioOutputSrc
          : `${serverSrc}${serverSrc.includes('?') ? '&' : '?'}v=${Date.now()}`,
      )
    })()
    return () => {
      isCurrent = false
    }
  }, [audioOutputSrc])

  const toggleAudioPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [])
  usePlayPauseOnSpace(!!audioOutputSrc, toggleAudioPlayback)

  // An audio file plays like a video, over its cover art (or a music icon), as it has no picture
  const isAudioFile = mediaFile?.type === 'video' && !!mediaFile.isAudioFile
  const audioFileBackdrop = isAudioFile ? (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-3xl border-1 border-zinc-200 dark:border-zinc-900">
      {videoThumbnailPath ? (
        <Image
          alt={t('thumbnail.coverArt')}
          src={videoThumbnailPath}
          className="h-full w-full object-contain"
          removeWrapper
        />
      ) : (
        <Icon name="music" size={160} className="text-primary" />
      )}
    </div>
  ) : null

  const imageToRenderSrc = isProcessCompleted
    ? mediaFile?.type === 'video' &&
      mediaFile?.previewMode === 'image' &&
      mediaFile?.compressedFile?.extension !== 'gif'
      ? mediaFile?.thumbnailPath!
      : (savedOutputSrc ?? compressedFileSrc)
    : thumbnailPath!

  return (
    <>
      <div className="relative w-full">
        <div className="relative w-full px-4">
          {mediaFile?.type === 'video' &&
          mediaFile.previewMode === 'video' &&
          mediaPath &&
          !isAudioOutput &&
          (mediaFile?.isProcessCompleted
            ? mediaFile?.compressedFile?.extension !== 'gif'
            : true) ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="relative"
            >
              {audioFileBackdrop}
              <VideoPlayer
                ref={playerRef}
                url={
                  isProcessCompleted && compressedFile
                    ? (savedOutputSrc ?? compressedFile.path!)
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
                  !isProcessCompleted && !isAudioFile ? (
                    <div className="min-w-[120px] p-0">
                      <button
                        className="flex items-center gap-1 w-full px-2 py-2 text-xs text-left hover:bg-default-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={handleCopyCurrentFrame}
                        disabled={isCopyingFrame}
                      >
                        <Icon name="copy" size={20} />
                        <span>{t('thumbnail.copyFrame')}</span>
                      </button>
                    </div>
                  ) : null
                }
                style={{
                  width: '100%',
                  minWidth: '50vw',
                  maxHeight: '60vh',
                  aspectRatio: isAudioFile
                    ? 16 / 9
                    : (mediaFile?.dimensions?.width ?? 1) /
                      (mediaFile?.dimensions?.height ?? 1),
                }}
                config={{
                  file: {
                    attributes: {
                      crossOrigin: 'anonymous',
                    },
                    tracks: [],
                    // Played as audio, whatever the format (e.g. FLAC, Opus)
                    forceAudio: isAudioFile,
                  },
                }}
                // Like the audio player after a compression
                isPlayPauseControlAtBottom={isAudioFile}
                disableClosedCaptions
                onError={(error: any) => {
                  if (error.name !== 'AbortError') {
                    toast.warning(
                      isAudioFile
                        ? t('thumbnail.audioUnplayable')
                        : t('thumbnail.switchingToImage'),
                    )
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
          ) : audioOutputSrc ? (
            // Audio extracted from a video has no picture: a music icon with the play button
            <div className="relative flex flex-col justify-center items-center gap-6 mx-auto w-full max-w-[740px] min-h-[420px] rounded-3xl border-1 border-zinc-200 dark:border-zinc-900">
              <Icon name="music" size={200} className="text-primary" />
              {/* Played like videos, so not where they cannot be played (Linux, with video
              previews off) */}
              {isVideoPreviewAvailable ? (
                <>
                  <audio
                    ref={audioRef}
                    key={audioPlaybackSrc}
                    src={audioPlaybackSrc}
                    onPlay={() => setIsAudioPlaying(true)}
                    onPause={() => setIsAudioPlaying(false)}
                    onEnded={() => setIsAudioPlaying(false)}
                    className="hidden"
                  />
                  <Button
                    onPress={toggleAudioPlayback}
                    variant="bordered"
                    isIconOnly
                    radius="full"
                    aria-label={
                      isAudioPlaying
                        ? t('thumbnail.pauseAudio')
                        : t('thumbnail.playAudio')
                    }
                    className="absolute bottom-4 left-1/2 -translate-x-1/2"
                  >
                    <Icon
                      name={isAudioPlaying ? 'pause' : 'play'}
                      size={20}
                      className="text-white drop-shadow-lg"
                    />
                  </Button>
                </>
              ) : null}
            </div>
          ) : isAudioFile ? (
            // An audio file that is not played here (Linux, with video previews off)
            <div className="relative mx-auto w-full max-w-[740px] aspect-video">
              {audioFileBackdrop}
            </div>
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
                      alt={t('preview.mediaToCompress')}
                      src={imageToRenderSrc}
                      style={gifTransformPreview.mediaStyle}
                    />
                  </div>
                </div>
              ) : (
                <Image
                  alt={t('preview.mediaToCompress')}
                  src={imageToRenderSrc}
                  className="object-contain rounded-3xl max-h-[60vh] border-1 border-zinc-200 dark:border-zinc-900 min-w-[100px] min-h-[100px]"
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
                          {isVideoPreviewAvailable ? (
                            <p>{t('thumbnail.videoUnplayable')}</p>
                          ) : (
                            <p>{t('thumbnail.previewsOff')}</p>
                          )}
                          {!isProcessCompleted ? (
                            <>
                              <br />
                              <p>{t('thumbnail.stillCompressible')}</p>
                            </>
                          ) : null}
                        </div>
                      </PopoverContent>
                    </Popover>
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
                        <Tooltip content={t('thumbnail.enlarge')}>
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
        <div
          data-tint-overlay=""
          className="absolute top-0 right-0 bottom-0 left-0 w-full h-full m-auto z-[10] p-4 bg-white1 dark:bg-black1 flex flex-col"
        >
          <MediaTransformer mediaIndex={mediaIndex} />
        </div>
      ) : null}
    </>
  )
}

export default MediaThumbnail
