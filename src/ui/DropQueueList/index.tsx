import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Progress from '@/components/Progress'
import ScrollShadow from '@/components/ScrollShadow'
import Tooltip from '@/components/Tooltip'
import { useDropQueuePaused } from '@/hooks/useDropQueue'
import { t } from '@/i18n'
import { openFilesAccessSettings } from '@/tauri/commands/app'
import {
  cancelDropQueue,
  clearFinishedDropQueue,
  type DropQueueItem,
  removeDropQueueItem,
  retryDropQueueItem,
  setDropQueuePaused,
} from '@/tauri/commands/dropQueue'
import { showItemInFileManager } from '@/tauri/commands/fs'
import { formatBytes, getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'

const { isMacOS } = getPlatform()

/** Name of a file from its path */
function getName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

/** What the queue is doing, e.g. "Compressing 2 of 5" */
export function getSummary(items: readonly DropQueueItem[], isPaused = false) {
  const pendingCount = items.filter(
    (item) => item.status === 'waiting' || item.status === 'compressing',
  ).length
  if (!pendingCount) {
    const failedCount = items.filter((item) => item.status === 'failed').length
    const cancelledCount = items.filter(
      (item) => item.status === 'cancelled',
    ).length
    if (cancelledCount) {
      return failedCount
        ? t('queue.summary.cancelledAndFailed', {
            cancelled: t('queue.summary.cancelled', { count: cancelledCount }),
            failed: t('queue.summary.failed', { count: failedCount }),
          })
        : t('queue.summary.cancelled', { count: cancelledCount })
    }
    return failedCount
      ? t('queue.summary.failed', { count: failedCount })
      : t('queue.summary.complete')
  }
  const finishedCount = items.length - pendingCount
  const position = finishedCount + 1
  const isCompressing = items.some((item) => item.status === 'compressing')
  if (isPaused) {
    return isCompressing
      ? t('queue.summary.pausing', { position, total: items.length })
      : t('queue.summary.paused', { count: pendingCount })
  }
  return isCompressing
    ? t('queue.summary.compressing', { position, total: items.length })
    : t('queue.summary.waiting', { count: pendingCount })
}

function QueueItem({
  item,
  isCompact,
  style,
}: {
  item: DropQueueItem
  isCompact: boolean
  /** Position in the virtual list */
  style: React.CSSProperties
}) {
  const { t } = useTranslation()
  const name = getName(item.path)
  const iconButtonClassName = isCompact ? 'min-w-4 w-4 h-4' : 'min-w-6 w-6 h-6'

  return (
    <li
      style={style}
      className={cn(
        'group absolute left-0 right-0 flex items-center gap-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5',
        isCompact ? 'pl-1.5 py-1' : 'px-2 py-1.5',
      )}
    >
      <div className="flex-1 min-w-0">
        <p
          className={cn('truncate', isCompact ? 'text-xs' : 'text-sm')}
          title={item.path}
        >
          {name}
        </p>
        {item.status === 'compressing' ? (
          <Progress
            aria-label={t('queue.compressingName', { name })}
            size="sm"
            value={item.progress}
            classNames={{ base: 'mt-1', track: 'h-1', indicator: 'h-1' }}
          />
        ) : (
          <p
            className={cn(
              'truncate text-zinc-500 dark:text-zinc-400',
              isCompact ? 'text-[10px]' : 'text-xs',
              item.status === 'failed' && 'text-danger',
            )}
            title={item.message ?? undefined}
          >
            {item.status === 'waiting'
              ? t('queue.status.waiting')
              : item.status === 'cancelled'
                ? t('queue.status.cancelled')
                : item.status === 'failed'
                  ? (item.message ?? t('queue.compressFailed'))
                  : item.originalSize != null && item.outputSize != null
                    ? `${t('common.sizeChange', { from: formatBytes(item.originalSize), to: formatBytes(item.outputSize) })}${item.message ? `. ${item.message}` : ''}`
                    : (item.message ?? t('queue.status.done'))}
          </p>
        )}
      </div>
      {item.status === 'compressing' ? (
        <span
          className={cn(
            'tabular-nums text-zinc-500 dark:text-zinc-400',
            isCompact ? 'text-[10px]' : 'text-xs',
          )}
        >
          {Math.round(item.progress)}%
        </span>
      ) : null}
      {item.status === 'done' && item.savedPath ? (
        <Tooltip
          content={t('common.showInFileManager')}
          aria-label={t('common.showInFileManager')}
        >
          <Button
            isIconOnly
            size="sm"
            variant="light"
            radius="full"
            aria-label={t('common.showNameInFileManager', { name })}
            className={cn(iconButtonClassName, 'text-success')}
            onPress={() => {
              showItemInFileManager(item.savedPath!).catch(() => {})
            }}
          >
            <Icon name="fileExplorer" size={14} />
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
            variant="light"
            radius="full"
            aria-label={t('media.openSettings')}
            className={cn(
              iconButtonClassName,
              'text-zinc-500 dark:text-zinc-400',
            )}
            onPress={() => {
              openFilesAccessSettings().catch(() => {})
            }}
          >
            <Icon name="setting" size={14} />
          </Button>
        </Tooltip>
      ) : null}
      {item.status === 'failed' || item.status === 'cancelled' ? (
        <Tooltip content={t('queue.tryAgain')} aria-label={t('queue.tryAgain')}>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            radius="full"
            aria-label={t('queue.tryNameAgain', { name })}
            className={cn(
              iconButtonClassName,
              'text-zinc-500 dark:text-zinc-400',
            )}
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
          variant="light"
          radius="full"
          aria-label={t('dropZone.remove', { name })}
          className={cn(
            iconButtonClassName,
            'text-zinc-500 dark:text-zinc-400',
          )}
          onPress={() => {
            removeDropQueueItem(item.id).catch(() => {})
          }}
        >
          <Icon name="cross" size={14} />
        </Button>
      ) : null}
    </li>
  )
}

/** Height of a row (fixed, so only the rows in view are rendered) */
const ROW_HEIGHT = { compact: 40, regular: 48 } as const
/** Rows rendered above & below the visible ones, so scrolling shows no gaps */
const OVERSCAN_ROWS = 4

/** The rows of the queue; only those in view are rendered (there can be hundreds of media) */
function VirtualQueue({
  items,
  isCompact,
}: {
  items: readonly DropQueueItem[]
  isCompact: boolean
}) {
  const rowHeight = isCompact ? ROW_HEIGHT.compact : ROW_HEIGHT.regular
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  // The list fills the space it is given, so its height is measured
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => {
      setViewportHeight(viewport.clientHeight)
    })
    observer.observe(viewport)
    return () => {
      observer.disconnect()
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    }
  }, [])

  const firstIndex = Math.max(
    0,
    Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS,
  )
  const lastIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN_ROWS,
  )

  return (
    // Fades the rows at the edges that can be scrolled to, like the main window's settings
    <ScrollShadow
      ref={viewportRef}
      size={24}
      hideScrollBar
      className={cn(
        'flex-1 min-h-0 overflow-y-auto',
        isCompact ? 'px-1.5' : 'px-1',
      )}
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
      <ul className="relative" style={{ height: items.length * rowHeight }}>
        {items.slice(firstIndex, lastIndex + 1).map((item, index) => (
          <QueueItem
            key={item.id}
            item={item}
            isCompact={isCompact}
            style={{ top: (firstIndex + index) * rowHeight, height: rowHeight }}
          />
        ))}
      </ul>
    </ScrollShadow>
  )
}

type DropQueueListProps = {
  items: readonly DropQueueItem[]
  /** The menu bar's smaller layout */
  isCompact?: boolean
  className?: string
}

/**
 * The drop zone's queue: the media compressed automatically, with its status. The same in the menu
 * bar & the main window.
 */
function DropQueueList({
  items,
  isCompact = false,
  className,
}: DropQueueListProps) {
  // Media is waiting or being compressed
  const isActive = items.some(
    (item) => item.status === 'waiting' || item.status === 'compressing',
  )

  const isPaused = useDropQueuePaused()
  const { t } = useTranslation()

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div
        className={cn(
          'flex items-center justify-between gap-2 pb-1',
          isCompact ? 'pl-3 pr-2 pt-2' : 'px-2 pt-1',
        )}
      >
        <p className={cn(isCompact ? 'text-xs' : 'text-sm')}>
          {getSummary(items, isPaused)}
        </p>
        <div className="flex items-center">
          {isActive ? (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              radius="md"
              className="min-w-6 w-6 h-6"
              aria-label={isPaused ? t('queue.resume') : t('queue.pause')}
              title={
                isPaused ? t('queue.resume') : t('queue.pauseAfterCurrent')
              }
              onPress={() => {
                setDropQueuePaused(!isPaused).catch(() => {})
              }}
            >
              <Icon name={isPaused ? 'play' : 'pause'} size={14} />
            </Button>
          ) : null}
          {/* Stop first (while compressing), then clear what is finished */}
          <Button
            isIconOnly
            size="sm"
            variant="light"
            radius="md"
            className={cn('min-w-6 w-6 h-6', isActive && 'text-danger')}
            aria-label={isActive ? t('queue.stop') : t('queue.clear')}
            title={
              isActive ? t('queue.stopAndCancel') : t('queue.clearFinished')
            }
            onPress={() => {
              ;(isActive ? cancelDropQueue() : clearFinishedDropQueue()).catch(
                () => {},
              )
            }}
          >
            <Icon name={isActive ? 'stop' : 'cross'} size={18} />
          </Button>
        </div>
      </div>
      <VirtualQueue items={items} isCompact={isCompact} />
    </div>
  )
}

export default DropQueueList
