import { core } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { CircularProgress } from '@/components/Progress'
import Tooltip from '@/components/Tooltip'
import { useDropQueue, useDropQueuePaused } from '@/hooks/useDropQueue'
import { openFilesAccessSettings } from '@/tauri/commands/app'
import {
  cancelDropQueue,
  clearFinishedDropQueue,
  type DropQueueItem,
  removeDropQueueItem,
  retryDropQueueItem,
  setDropQueuePaused,
} from '@/tauri/commands/dropQueue'
import { generateVideoThumbnail } from '@/tauri/commands/ffmpeg'
import { deleteFile, showItemInFileManager } from '@/tauri/commands/fs'
import { needsImagePreview, prepareImagePreview } from '@/tauri/commands/image'
import { inputExtensions, isAudioFileExtension } from '@/types/compression'
import { getSummary } from '@/ui/DropQueueList'
import { formatBytes, getPlatform } from '@/utils/fs'
import { isOverlayOpen, isTextEntryElement } from '@/utils/keyboard'
import { cn } from '@/utils/tailwind'

const { isMacOS } = getPlatform()

/** The island morphs between the pill & the panel with the same spring, like iOS' */
const ISLAND_SPRING = { type: 'spring', stiffness: 380, damping: 32 } as const

/**
 * The pill's content fades in once the island has nearly shrunk to it (& out quickly), so it is not
 * seen scaled while the island zooms
 */
const PILL_CONTENT_TRANSITION = {
  opacity: { delay: 0.14, duration: 0.18 },
} as const

function getName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** Kind of a queued media, by its extension */
function getMediaKind(path: string): 'video' | 'audio' | 'image' {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  if (isAudioFileExtension(extension)) return 'audio'
  return inputExtensions.video.includes(extension) ? 'video' : 'image'
}

/**
 * Thumbnails of queued videos (and the cover art of audio files), generated once (images are shown
 * as they are)
 */
const videoThumbnails = new Map<
  string,
  Promise<{ path: string; src: string } | null>
>()

/**
 * Deletes the thumbnails of the videos no longer in the queue (they are in the app's cache, made
 * only for the queue)
 */
function deleteUnusedThumbnails(items: readonly DropQueueItem[]) {
  const queuedPaths = new Set(items.map((item) => item.path))
  for (const [videoPath, thumbnail] of videoThumbnails) {
    if (queuedPaths.has(videoPath)) continue
    videoThumbnails.delete(videoPath)
    thumbnail.then((result) => {
      if (result) deleteFile(result.path).catch(() => {})
    })
  }
}

function useThumbnail(item: DropQueueItem) {
  const kind = getMediaKind(item.path)
  const hasGeneratedThumbnail = kind !== 'image' || needsImagePreview(item.path)
  const [src, setSrc] = useState<string | null>(() =>
    hasGeneratedThumbnail ? null : core.convertFileSrc(item.path),
  )

  useEffect(() => {
    if (!hasGeneratedThumbnail) return
    let isMounted = true
    let thumbnail = videoThumbnails.get(item.path)
    if (!thumbnail) {
      // An audio file's cover art is its only picture, at the start
      thumbnail = (
        kind === 'image'
          ? prepareImagePreview(item.path).then((filePath) => ({ filePath }))
          : generateVideoThumbnail(
              item.path,
              kind === 'audio' ? '00:00:00.00' : undefined,
            )
      )
        .then((result) => ({
          path: result.filePath,
          src: core.convertFileSrc(result.filePath),
        }))
        .catch(() => null)
      videoThumbnails.set(item.path, thumbnail)
    }
    thumbnail.then((result) => {
      if (isMounted) setSrc(result?.src ?? null)
    })
    return () => {
      isMounted = false
    }
  }, [hasGeneratedThumbnail, kind, item.path])

  // A file that cannot be read (e.g. not allowed on macOS) shows no picture, not a broken one
  const onError = () => setSrc(null)

  return { src, kind, onError }
}

function IslandTile({
  item,
  style,
}: {
  item: DropQueueItem
  /** Position in the virtual grid */
  style: React.CSSProperties
}) {
  const { t } = useTranslation()
  const { src, kind, onError } = useThumbnail(item)
  const name = getName(item.path)
  const reduction =
    item.originalSize && item.outputSize != null
      ? Math.round(
          ((item.originalSize - item.outputSize) * 100) / item.originalSize,
        )
      : null

  return (
    <motion.div
      // Only a fade: a layout animation measures positions, which are wrong in a scrolled grid
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      style={style}
      className="group absolute rounded-xl overflow-hidden bg-white/10"
      title={
        item.status === 'done' && item.originalSize && item.outputSize != null
          ? `${name}: ${t('common.sizeChange', { from: formatBytes(item.originalSize), to: formatBytes(item.outputSize) })}`
          : (item.message ?? name)
      }
    >
      {src ? (
        <img
          src={src}
          alt=""
          // Decoded off the main thread, so scrolling stays smooth
          decoding="async"
          onError={onError}
          className={cn(
            'w-full h-full object-cover',
            (item.status === 'waiting' || item.status === 'cancelled') &&
              'opacity-40',
          )}
        />
      ) : item.status === 'failed' ? null : (
        // Not under a failed one's label, which is in the same place
        <div className="w-full h-full flex items-center justify-center text-white/50">
          <Icon
            name={
              kind === 'video' ? 'video' : kind === 'audio' ? 'music' : 'image'
            }
            size={22}
          />
        </div>
      )}

      {/* Status */}
      {item.status === 'compressing' ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <CircularProgress
            aria-label={t('queue.compressingName', { name })}
            value={item.progress}
            showValueLabel
            strokeWidth={3}
            classNames={{
              svg: 'w-11 h-11',
              indicator: 'stroke-white',
              track: 'stroke-white/20',
              value: 'text-[10px] text-white',
            }}
          />
        </div>
      ) : item.status === 'waiting' || item.status === 'cancelled' ? (
        <div className="absolute bottom-1 left-1 right-1 text-[10px] text-white/70 truncate">
          {item.status === 'waiting'
            ? t('queue.status.waiting')
            : t('queue.status.cancelled')}
        </div>
      ) : item.status === 'done' ? (
        <div className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          <Icon name="tick" size={10} className="text-success" />
          {reduction != null && reduction > 0
            ? t('queue.status.smaller', { value: reduction })
            : t('queue.status.done')}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/40 text-white text-[10px]">
          <Icon name="warning" size={18} />
          {t('queue.status.failed')}
        </div>
      )}

      {/* From a watched folder (dropped media has no tag), with its name; hidden on hover, when
          the actions show at the top */}
      {item.watchFolderName ? (
        <div
          className="absolute top-1 left-1 max-w-[calc(100%-3.5rem)] flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white transition-opacity group-hover:opacity-0"
          title={t('queue.fromWatchedFolder', { name: item.watchFolderName })}
        >
          <Icon name="fileExplorer" size={10} className="shrink-0 opacity-80" />
          <span className="truncate">{item.watchFolderName}</span>
        </div>
      ) : null}

      {/* Actions, on hover */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {item.status === 'done' && item.savedPath ? (
          <Tooltip
            content={t('common.showInFileManager')}
            aria-label={t('common.showInFileManager')}
          >
            <Button
              isIconOnly
              size="sm"
              radius="full"
              aria-label={t('common.showNameInFileManager', { name })}
              className="min-w-6 w-6 h-6 bg-black/60 text-white"
              onPress={() => {
                showItemInFileManager(item.savedPath!).catch(() => {})
              }}
            >
              <Icon name="fileExplorer" size={12} />
            </Button>
          </Tooltip>
        ) : null}
        {item.status === 'failed' && item.isAccessDenied && isMacOS ? (
          <Tooltip
            content={t('media.openSettings')}
            aria-label={t('media.openSettings')}
          >
            <Button
              isIconOnly
              size="sm"
              radius="full"
              aria-label={t('media.openSettings')}
              className="min-w-6 w-6 h-6 bg-black/60 text-white"
              onPress={() => {
                openFilesAccessSettings().catch(() => {})
              }}
            >
              <Icon name="setting" size={14} />
            </Button>
          </Tooltip>
        ) : null}
        {/* Failed or stopped: tried again; done: compressed again from the original (e.g. after
            changing its preset), keeping the output saved before */}
        {item.status === 'failed' ||
        item.status === 'cancelled' ||
        item.status === 'done' ? (
          <Tooltip
            content={
              item.status === 'done'
                ? t('queue.compressAgain')
                : t('queue.tryAgain')
            }
            aria-label={
              item.status === 'done'
                ? t('queue.compressAgain')
                : t('queue.tryAgain')
            }
          >
            <Button
              isIconOnly
              size="sm"
              radius="full"
              aria-label={
                item.status === 'done'
                  ? t('queue.compressNameAgain', { name })
                  : t('queue.tryNameAgain', { name })
              }
              className="min-w-6 w-6 h-6 bg-black/60 text-white"
              onPress={() => {
                retryDropQueueItem(item.id).catch(() => {})
              }}
            >
              <Icon name="redo" size={14} />
            </Button>
          </Tooltip>
        ) : null}
        {item.status !== 'compressing' ? (
          <Button
            isIconOnly
            size="sm"
            radius="full"
            aria-label={t('dropZone.remove', { name })}
            className="min-w-6 w-6 h-6 bg-black/60 text-white"
            onPress={() => {
              removeDropQueueItem(item.id).catch(() => {})
            }}
          >
            <Icon name="cross" size={14} />
          </Button>
        ) : null}
      </div>
    </motion.div>
  )
}

const TILE_SIZE = 112
const TILE_GAP = 8
const COLUMNS = 3
const ROW_HEIGHT = TILE_SIZE + TILE_GAP
/** Rows shown at once; more media scrolls */
const VISIBLE_ROWS = 3
/** Rows rendered above & below the visible ones, so scrolling shows no gaps */
const OVERSCAN_ROWS = 1

/**
 * The media of the queue, 3 per row. Only the rows in view are rendered (there can be hundreds of
 * media), each tile at its fixed place. Scrolls without a scrollbar.
 */
function IslandGrid({ items }: { items: readonly DropQueueItem[] }) {
  const [scrollTop, setScrollTop] = useState(0)
  const frameRef = useRef<number | null>(null)
  const rowCount = Math.ceil(items.length / COLUMNS)
  const viewportHeight =
    Math.min(rowCount, VISIBLE_ROWS) * ROW_HEIGHT - TILE_GAP
  const firstRow = Math.max(
    0,
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
  )
  const lastRow = Math.min(
    rowCount - 1,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS,
  )
  const visibleItems = items.slice(firstRow * COLUMNS, (lastRow + 1) * COLUMNS)

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  return (
    <div
      className={cn(
        'relative',
        rowCount > VISIBLE_ROWS
          ? 'overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'overflow-hidden',
      )}
      style={{ height: viewportHeight }}
      onScroll={(evt) => {
        const target = evt.currentTarget
        // Once per frame
        if (frameRef.current != null) return
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null
          setScrollTop(target.scrollTop)
        })
      }}
    >
      <div
        className="relative"
        style={{ height: rowCount * ROW_HEIGHT - TILE_GAP }}
      >
        {visibleItems.map((item, index) => {
          const position = firstRow * COLUMNS + index
          return (
            <IslandTile
              key={item.id}
              item={item}
              style={{
                top: Math.floor(position / COLUMNS) * ROW_HEIGHT,
                left: (position % COLUMNS) * ROW_HEIGHT,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * The drop zone's queue in the main window, like iOS' Dynamic Island: a pill at the top while the
 * drop zone has media, expanding into a grid of it
 */
function DropZoneIsland() {
  const { t } = useTranslation()
  const items = useDropQueue()
  const isPaused = useDropQueuePaused()
  const [isExpanded, setIsExpanded] = useState(false)
  const islandRef = useRef<HTMLDivElement>(null)

  const compressingItem = items.find((item) => item.status === 'compressing')
  const pendingCount = items.filter(
    (item) => item.status === 'waiting' || item.status === 'compressing',
  ).length
  const finishedCount = items.length - pendingCount
  // Progress of the whole queue
  const progress = items.length
    ? (finishedCount * 100 + (compressingItem?.progress ?? 0)) / items.length
    : 0

  // Collapses when clicking outside it or with Escape
  useEffect(() => {
    if (!isExpanded) return
    const handlePointerDown = (evt: PointerEvent) => {
      if (!islandRef.current?.contains(evt.target as Node)) {
        setIsExpanded(false)
      }
    }
    const handleKeyDown = (evt: KeyboardEvent) => {
      if (
        evt.key !== 'Escape' ||
        evt.defaultPrevented ||
        isTextEntryElement(evt.target as HTMLElement | null) ||
        isOverlayOpen()
      ) {
        return
      }
      evt.preventDefault()
      evt.stopPropagation()
      setIsExpanded(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    // Capture phase, before the other Escape shortcuts (e.g. exit)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isExpanded])

  useEffect(() => {
    if (!items.length) setIsExpanded(false)
  }, [items.length])

  // Thumbnails of cleared or removed videos are deleted
  useEffect(() => {
    deleteUnusedThumbnails(items)
  }, [items])

  return (
    <div className="fixed top-[7px] left-0 right-0 z-[60] flex justify-center pointer-events-none">
      <AnimatePresence>
        {items.length ? (
          <motion.div
            ref={islandRef}
            layout
            initial={{ opacity: 0, scale: 0.6, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: -8 }}
            transition={ISLAND_SPRING}
            style={{ borderRadius: isExpanded ? 24 : 999 }}
            className={cn(
              'pointer-events-auto overflow-hidden bg-black text-white border border-white/10 dark:bg-zinc-900',
              // The grid's width (3 tiles) & the padding
              isExpanded ? 'w-[376px]' : 'w-auto',
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {isExpanded ? (
                <motion.div
                  key="panel"
                  initial={{ opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{
                    opacity: 0,
                    filter: 'blur(4px)',
                    transition: { duration: 0.1 },
                  }}
                  transition={{ duration: 0.2 }}
                  className="p-3"
                >
                  <div className="flex items-center gap-1 pb-2">
                    <Icon name="dropzone" size={20} className="text-primary" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-white/60 truncate">
                        {getSummary(items, isPaused)}
                      </p>
                    </div>
                    <div className="ml-auto flex items-center">
                      {pendingCount ? (
                        <Tooltip
                          content={
                            isPaused
                              ? t('queue.resume')
                              : t('queue.pauseAfterCurrent')
                          }
                          aria-label={
                            isPaused ? t('queue.resume') : t('queue.pause')
                          }
                        >
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            radius="full"
                            aria-label={
                              isPaused ? t('queue.resume') : t('queue.pause')
                            }
                            className="min-w-6 w-6 h-6 text-white/80"
                            onPress={() => {
                              setDropQueuePaused(!isPaused).catch(() => {})
                            }}
                          >
                            <Icon
                              name={isPaused ? 'play' : 'pause'}
                              size={14}
                            />
                          </Button>
                        </Tooltip>
                      ) : null}
                      {/* Stop first (while compressing), then clear what is finished */}
                      <Tooltip
                        content={
                          pendingCount
                            ? t('queue.stopCompression')
                            : t('queue.clearAll')
                        }
                        aria-label={
                          pendingCount ? t('queue.stop') : t('queue.clear')
                        }
                      >
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          radius="full"
                          aria-label={
                            pendingCount ? t('queue.stop') : t('queue.clear')
                          }
                          className={cn(
                            'min-w-6 w-6 h-6',
                            pendingCount ? 'text-danger' : 'text-white/80',
                          )}
                          onPress={() => {
                            ;(pendingCount
                              ? cancelDropQueue()
                              : clearFinishedDropQueue()
                            ).catch(() => {})
                          }}
                        >
                          <Icon
                            name={pendingCount ? 'stop' : 'cross'}
                            size={pendingCount ? 19 : 14}
                          />
                        </Button>
                      </Tooltip>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        radius="full"
                        aria-label={t('queue.collapse')}
                        className="min-w-6 w-6 h-6 text-white/80"
                        onPress={() => setIsExpanded(false)}
                      >
                        <Icon name="chevron" size={14} className="rotate-180" />
                      </Button>
                    </div>
                  </div>
                  <IslandGrid items={items} />
                </motion.div>
              ) : (
                <motion.div
                  key="pill"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={PILL_CONTENT_TRANSITION}
                  // Anywhere on the pill (its padding too) expands it; the button is for the keyboard
                  onClick={() => setIsExpanded(true)}
                  className="group flex items-center gap-1 h-8 px-3 text-[11px] whitespace-nowrap cursor-pointer"
                >
                  <button
                    type="button"
                    aria-label={t('queue.showDropZone')}
                    className="flex items-center gap-2 h-full"
                  >
                    <Icon name="dropzone" size={18} className="text-primary" />
                    <span>
                      {pendingCount
                        ? getSummary(items, isPaused)
                        : t('queue.filesCompressed', { count: finishedCount })}
                    </span>
                  </button>
                  {pendingCount ? (
                    <span
                      aria-hidden
                      className="w-10 h-1 rounded-full bg-white/20 overflow-hidden"
                    >
                      <motion.span
                        className="block h-full rounded-full bg-primary"
                        animate={{ width: `${Math.max(4, progress)}%` }}
                        transition={{ duration: 0.4 }}
                      />
                    </span>
                  ) : (
                    // One fixed slot: the tick & the clear button crossfade on hover, so nothing
                    // moves
                    <span className="relative w-5 h-5 flex-shrink-0">
                      <span className="absolute inset-0 flex items-center justify-center text-success transition-opacity duration-150 group-hover:opacity-0">
                        <Icon name="tick" size={16} />
                      </span>
                      <button
                        type="button"
                        onClick={(evt) => {
                          // Clears without expanding the pill
                          evt.stopPropagation()
                          clearFinishedDropQueue().catch(() => {})
                        }}
                        aria-label={t('queue.clearFinished')}
                        title={t('queue.clearFinished')}
                        className="absolute inset-0 flex items-center justify-center rounded-full text-white/80 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto hover:bg-white/15 hover:text-white"
                      >
                        <Icon name="cross" size={12} />
                      </button>
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default DropZoneIsland
