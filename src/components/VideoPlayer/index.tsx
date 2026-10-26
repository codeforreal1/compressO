import { Timeline, TimelineState } from '@xzdarcy/react-timeline-editor'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import ReactPlayer from 'react-player'
import { BaseReactPlayerProps } from 'react-player/base'
import { ClassNameValue } from 'tailwind-merge'

import { usePlayPauseOnSpace } from '@/hooks/usePlayPauseOnSpace'
import { t } from '@/i18n'
import { MediaTransformHistory } from '@/types/compression'
import type { WaveformData } from '@/types/waveform'
import { cn } from '@/utils/tailwind'
import { getTransformPreview } from '@/utils/transform'
import { constructVideoUrl } from '@/utils/video'
import Button from '../Button'
import Icon from '../Icon'
import { BoundaryRowActionRender, ScaleRender } from '../Timeline'
import useTimelineEngine, {
  TimelineScales,
} from '../Timeline/useTimelineEngine'

/**
 * react-player v3 is better type-safety but is feature incomplete with v2.
 * v2 does not have good type-safety so we'll implement the types ourselves based on the usage
 */

export interface VideoPlayerRef {
  playerRef: ReactPlayer | null
  getInternalPlayer: () => HTMLVideoElement | null
  togglePlayPause: () => void
  playVideo: () => void
  pauseVideo: () => void
  getPlaybackState: () => 'playing' | 'paused'
  captureVideoFrame: () => Promise<string | null>
}

export interface VideoPlayerProps extends BaseReactPlayerProps {
  playPauseOnSpaceKeydown?: boolean
  containerClassName?: ClassNameValue
  enableTimelinePlayer?: boolean
  disableClosedCaptions?: boolean
  contextMenu?: React.ReactNode
  onSpaceKeydownForPlayPause?: () => void
  onArrowKeySeek?: (arrowKey: 'left' | 'right') => void
  disablePlayPauseControlAtCenter?: boolean
  /**
   * The play button at the bottom center, always shown (e.g. for audio, like its player after a
   * compression), instead of in the center, hidden while playing
   */
  isPlayPauseControlAtBottom?: boolean
  autoPlay?: boolean
  disablePlayPauseViaContainerClick?: boolean
  /** Previews these transforms (crop/rotate/flip) on the playing video */
  transformHistory?: readonly MediaTransformHistory[] | null
  /** Marks everything outside these segments as trimmed out on the timeline */
  trimSegments?: readonly { start: number; end: number }[] | null
  waveform?: WaveformData | null
}

const scales: TimelineScales = {
  scale: 1,
  scaleWidth: 80,
  startLeft: 20,
} as const

const SEEK_DURATION = 3

const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(
  (
    {
      url,
      playPauseOnSpaceKeydown,
      containerClassName,
      enableTimelinePlayer,
      disableClosedCaptions,
      contextMenu,
      onSpaceKeydownForPlayPause,
      disablePlayPauseControlAtCenter,
      isPlayPauseControlAtBottom,
      autoPlay,
      disablePlayPauseViaContainerClick,
      onArrowKeySeek,
      onProgress,
      onDuration,
      onPlay,
      onPause,
      onEnded,
      onReady,
      transformHistory,
      trimSegments,
      waveform,
      style,

      ...props
    },
    forwardedRef,
  ) => {
    const id = useId()

    const [videoUrl, setVideoUrl] = useState<typeof url | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [duration, setDuration] = useState<number | null>(null)
    const [contextMenuOpen, setContextMenuOpen] = useState(false)
    const [contextMenuPosition, setContextMenuPosition] = useState<{
      x: number
      y: number
    } | null>(null)

    const [videoSize, setVideoSize] = useState<{
      width: number
      height: number
    } | null>(null)

    const playerRef = useRef<ReactPlayer | null>(null)
    const playPauseButtonRef = useRef<HTMLButtonElement | null>(null)
    const lastCapturedVideoFrame = useRef<string | null>(null)
    const timelinePlayerRef = useRef<TimelineState | null>(null)
    const playPauseButtonRefIntervalId = useRef<NodeJS.Timeout | null>(null)

    const {
      refreshTimeline,
      autoScrollCursorToCurrentTime,
      setTime: setTimelineTime,
    } = useTimelineEngine({
      timelineState: timelinePlayerRef,
      totalDuration: duration ?? 0,
    })

    const togglePlayPause = useCallback(() => {
      let playState: 'playing' | 'paused' = 'playing'
      setIsPlaying((s) => {
        playState = s ? 'paused' : 'playing'
        return !s
      })
      return playState
    }, [])

    const handleContextMenu = useCallback(
      (e: React.MouseEvent) => {
        if (!contextMenu) return

        e.preventDefault()
        e.stopPropagation()
        setContextMenuPosition({ x: e.clientX, y: e.clientY })
        setContextMenuOpen(true)
      },
      [contextMenu],
    )

    const closeContextMenu = useCallback(() => {
      setContextMenuOpen(false)
      setContextMenuPosition(null)
    }, [])

    useEffect(() => {
      if (!contextMenuOpen) return

      const handleClick = (e: MouseEvent) => {
        setTimeout(() => {
          closeContextMenu()
        }, 100)
      }
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeContextMenu()
      }

      window.addEventListener('click', handleClick, true)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('click', handleClick, true)
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [contextMenuOpen, closeContextMenu])

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        closeContextMenu()

        const target = e.target as HTMLElement
        const isInputField =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable

        if (e.code === 'ArrowRight' && !isInputField) {
          e.preventDefault()
          if (playerRef.current && duration) {
            const currentTime = playerRef.current.getCurrentTime()
            const newTime = Math.min(currentTime + SEEK_DURATION, duration)
            playerRef.current.seekTo(newTime, 'seconds')
            autoScrollCursorToCurrentTime(scales, {
              onlyOnOutOfView: false,
              smoothScrolling: true,
            })
            onArrowKeySeek?.('right')
          }
        } else if (e.code === 'ArrowLeft' && !isInputField) {
          e.preventDefault()
          if (playerRef.current) {
            const currentTime = playerRef.current.getCurrentTime()
            const newTime = Math.max(currentTime - SEEK_DURATION, 0)
            playerRef.current.seekTo(newTime, 'seconds')
            autoScrollCursorToCurrentTime(scales, {
              onlyOnOutOfView: false,
              smoothScrolling: true,
            })

            onArrowKeySeek?.('left')
          }
        }
      },
      [
        duration,
        closeContextMenu,
        autoScrollCursorToCurrentTime,
        onArrowKeySeek,
      ],
    )

    const captureVideoFrame = useCallback(async () => {
      if (!playerRef.current) return null

      const internalPlayer =
        playerRef.current.getInternalPlayer() as HTMLVideoElement | null
      if (!internalPlayer) return null

      if (
        internalPlayer.videoWidth === 0 ||
        internalPlayer.videoHeight === 0 ||
        internalPlayer.readyState < 2
      ) {
        await new Promise<void>((resolve) => {
          const checkReady = () => {
            if (
              internalPlayer.videoWidth > 0 &&
              internalPlayer.videoHeight > 0 &&
              internalPlayer.readyState >= 2
            ) {
              resolve()
            } else {
              internalPlayer.addEventListener('loadeddata', checkReady, {
                once: true,
              })
            }
          }
          checkReady()
        })
      }

      // Small delay to ensure frame is actually rendered
      await new Promise((resolve) => setTimeout(resolve, 100))

      const canvas = document.createElement('canvas')
      canvas.width = internalPlayer.videoWidth
      canvas.height = internalPlayer.videoHeight

      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      ctx.drawImage(internalPlayer, 0, 0, canvas.width, canvas.height)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpg'),
      )

      if (!blob) {
        return null
      }

      if (lastCapturedVideoFrame.current) {
        URL.revokeObjectURL(lastCapturedVideoFrame.current)
      }

      const videoFrameUrl = URL.createObjectURL(blob)

      lastCapturedVideoFrame.current = videoFrameUrl

      return videoFrameUrl
    }, [])

    const toggleClosedCaptions = useCallback((disable = false) => {
      if (playerRef.current) {
        const video = playerRef.current.getInternalPlayer()
        if (video && video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].mode = disable ? 'hidden' : 'showing'
          }
        }
      }
    }, [])

    useEffect(() => {
      if (playPauseOnSpaceKeydown) {
        window.addEventListener('keydown', handleKeyDown)
      } else {
        window.removeEventListener('keydown', handleKeyDown)
      }
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [handleKeyDown, playPauseOnSpaceKeydown])

    usePlayPauseOnSpace(!!playPauseOnSpaceKeydown, () => {
      closeContextMenu()
      togglePlayPause()
      onSpaceKeydownForPlayPause?.()
    })

    useEffect(() => {
      if (playPauseButtonRef.current) {
        playPauseButtonRef.current.focus()
      }
    }, [])

    useEffect(() => {
      if (
        enableTimelinePlayer &&
        timelinePlayerRef.current &&
        playerRef.current
      ) {
        setTimelineTime(playerRef.current.getCurrentTime())
      }
    }, [enableTimelinePlayer, setTimelineTime])

    // biome-ignore lint/correctness/useExhaustiveDependencies: <autoScrollCursorToCurrentTime>
    useEffect(() => {
      if (enableTimelinePlayer && timelinePlayerRef.current) {
        autoScrollCursorToCurrentTime(scales, {
          onlyOnOutOfView: false,
        })
      }
    }, [enableTimelinePlayer])

    useEffect(() => {
      if (playerRef.current) {
        toggleClosedCaptions(disableClosedCaptions)
      }
    }, [disableClosedCaptions, toggleClosedCaptions])

    useEffect(() => {
      if (
        isPlaying &&
        playPauseButtonRef.current &&
        !isPlayPauseControlAtBottom
      ) {
        if (playPauseButtonRefIntervalId.current) {
          clearInterval(playPauseButtonRefIntervalId.current)
        }
        playPauseButtonRefIntervalId.current = setInterval(() => {
          if (playPauseButtonRef.current) {
            playPauseButtonRef.current.style.visibility = 'hidden'
          }
        }, 1000)
      } else {
        clearInterval(playPauseButtonRefIntervalId.current!)
        // Cleared rather than set to `visible`, which would show it even inside a hidden parent
        // (e.g. covered by the full media info with the tinted window, see `global.css`)
        if (playPauseButtonRef.current) {
          playPauseButtonRef.current.style.visibility = ''
        }
      }
      return () => {
        clearInterval(playPauseButtonRefIntervalId.current!)
      }
    }, [isPlaying, isPlayPauseControlAtBottom])

    useEffect(() => {
      // On platforms like Linux, native Webview does not support accessing local asset like video. We have to serve the video asset via a local server from the backend.
      ;(async () => {
        if (!url || typeof url !== 'string' || !url?.startsWith('asset://')) {
          setVideoUrl(url)
          return
        }

        try {
          const uri = await constructVideoUrl(url)
          setVideoUrl(uri)
        } catch {
          setVideoUrl(url)
        }
      })()
    }, [url])

    useImperativeHandle(
      forwardedRef,
      () =>
        ({
          playerRef: playerRef.current,
          getInternalPlayer: () => {
            return playerRef.current?.getInternalPlayer() as any
          },
          togglePlayPause: togglePlayPause,
          playVideo: () => {
            setIsPlaying(true)
          },
          pauseVideo: () => {
            setIsPlaying(false)
          },
          getPlaybackState() {
            return isPlaying ? 'playing' : 'paused'
          },
          captureVideoFrame,
        }) satisfies VideoPlayerRef,
    )

    // Uses the decoded size (not ffprobe's) since the webview & ffmpeg both apply rotation metadata
    const transformPreview = useMemo(
      () =>
        transformHistory && videoSize
          ? getTransformPreview(
              transformHistory,
              videoSize.width,
              videoSize.height,
            )
          : null,
      [transformHistory, videoSize],
    )

    return (
      <div className={cn('w-full h-full', containerClassName)}>
        <div
          className="relative w-full h-full"
          {...(!disablePlayPauseViaContainerClick
            ? {
                role: 'button',
                onClick: togglePlayPause,
              }
            : {})}
          onContextMenu={(e) => {
            if (contextMenu) {
              handleContextMenu(e)
            }
          }}
        >
          {/* Wrappers stay mounted (as `display: contents` when unused) so toggling the
          preview doesn't remount & reload the video */}
          <div
            className={
              transformPreview ? 'relative overflow-hidden mx-auto' : ''
            }
            style={
              transformPreview
                ? {
                    aspectRatio: transformPreview.aspectRatio,
                    // fit within the max height while keeping the output's aspect ratio
                    width: style?.maxHeight
                      ? `min(100%, calc(${style.maxHeight} * ${transformPreview.aspectRatio}))`
                      : '100%',
                  }
                : { display: 'contents' }
            }
          >
            <div
              style={
                transformPreview
                  ? transformPreview.frameStyle
                  : { display: 'contents' }
              }
            >
              <ReactPlayer
                ref={playerRef}
                url={videoUrl!}
                controls
                width={transformPreview?.mediaStyle.width ?? '100%'}
                height={transformPreview?.mediaStyle.height ?? '100%'}
                style={transformPreview ? transformPreview.mediaStyle : style}
                playing={isPlaying}
                onPlay={() => {
                  setIsPlaying(true)
                  onPlay?.()
                  setTimeout(() => {
                    autoScrollCursorToCurrentTime(scales)
                  }, 100)
                }}
                onPause={() => {
                  setIsPlaying(false)
                  onPause?.()
                }}
                onEnded={() => {
                  onEnded?.()
                  setIsPlaying(false)
                }}
                onProgress={(progress) => {
                  onProgress?.(progress)
                  if (timelinePlayerRef.current) {
                    timelinePlayerRef.current.setTime(progress.playedSeconds)
                    autoScrollCursorToCurrentTime(scales)
                  }
                }}
                onDuration={(duration) => {
                  onDuration?.(duration)
                  setDuration(duration)
                  if (timelinePlayerRef.current) {
                    refreshTimeline()
                  }
                }}
                onReady={(player) => {
                  onReady?.(player)
                  const video = player.getInternalPlayer() as HTMLVideoElement
                  if (video?.videoWidth && video?.videoHeight) {
                    setVideoSize({
                      width: video.videoWidth,
                      height: video.videoHeight,
                    })
                  }
                  toggleClosedCaptions(disableClosedCaptions)
                  if (autoPlay) {
                    setIsPlaying(true)
                  }
                }}
                {...props}
              />
            </div>
          </div>
          {!disablePlayPauseControlAtCenter ? (
            isPlayPauseControlAtBottom ? (
              <Button
                ref={playPauseButtonRef}
                onPress={togglePlayPause}
                variant="bordered"
                isIconOnly
                radius="full"
                aria-label={isPlaying ? t('player.pause') : t('player.play')}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 cursor-pointer"
              >
                <Icon
                  name={isPlaying ? 'pause' : 'play'}
                  size={20}
                  className="text-zinc-800 dark:text-white dark:drop-shadow-lg"
                />
              </Button>
            ) : (
              <Button
                ref={playPauseButtonRef}
                onPress={togglePlayPause}
                isIconOnly
                radius="full"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2  bg-black/30 cursor-pointer"
              >
                <Icon
                  name={isPlaying ? 'pause' : 'play'}
                  size={28}
                  className="text-white drop-shadow-lg"
                />
              </Button>
            )
          ) : null}
        </div>
        {contextMenuOpen && contextMenuPosition && contextMenu ? (
          <div
            role="menu"
            className="fixed z-50 bg-content1 rounded-xl"
            style={{
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
            }}
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            {contextMenu}
          </div>
        ) : null}
        {enableTimelinePlayer && duration ? (
          <Timeline
            key={id}
            ref={timelinePlayerRef}
            editorData={[
              {
                id: 'videoPlayer',
                actions: [
                  {
                    id: 'videoPlayer',
                    start: 0,
                    minStart: 0,
                    end: duration,
                    maxEnd: duration,
                    effectId: 'videoPlayer',
                    disable: true,
                    movable: false,
                    flexible: false,
                  },
                ],
              },
            ]}
            effects={{
              videoPlayer: { id: 'videoPlayer', name: '' },
            }}
            scale={scales.scale}
            scaleWidth={scales.scaleWidth}
            startLeft={scales.startLeft}
            autoScroll
            style={{
              width: '100%',
              height: '75px',
              margin: '10px 0',
            }}
            getActionRender={(action, row) => {
              if (action.effectId === 'videoPlayer') {
                return (
                  <BoundaryRowActionRender
                    action={action}
                    row={row}
                    keptSegments={trimSegments}
                    waveform={waveform}
                  />
                )
              }
            }}
            getScaleRender={(scale) => <ScaleRender scale={scale} />}
            onCursorDrag={(time) => {
              if (playerRef.current) {
                playerRef.current.seekTo(time, 'seconds')
              }
            }}
            onClickTimeArea={(time) => {
              if (playerRef.current) {
                playerRef.current.seekTo(time, 'seconds')
              }
              return true
            }}
            onClickRow={(_, { time }) => {
              if (playerRef.current) {
                playerRef.current.seekTo(time, 'seconds')
              }
            }}
          />
        ) : null}
      </div>
    )
  },
)

export default memo(VideoPlayer)
