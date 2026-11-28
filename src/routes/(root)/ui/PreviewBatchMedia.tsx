import { AnimatePresence, motion } from 'framer-motion'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Card from '@/components/Card'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import Progress, { CircularProgress } from '@/components/Progress'
import ScrollShadow from '@/components/ScrollShadow'
import Spinner from '@/components/Spinner'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import {
  copyFilesToClipboard,
  showItemInFileManager,
} from '@/tauri/commands/fs'
import type { MediaTab } from '@/types/app'
import { zoomInStaggerAnimation } from '@/utils/animation'
import { formatBytes } from '@/utils/fs'
import { formatDuration } from '@/utils/string'
import { cn } from '@/utils/tailwind'
import { getCompressionLane, type MediaFile } from '../-compression'
import { pickMediaToAdd } from '../-media'
import { getOutputClipboardFiles } from '../-save'
import { appProxy } from '../-state'

type MediaKind = { type: 'video' | 'image'; isAudioFile?: boolean }

const ROW_GAP_PX = 16
const OVERSCAN_ROWS = 2
const STAGGER_ITEM_LIMIT = 24

function getGridColumns(viewportWidth: number) {
  if (viewportWidth >= 1660) return 4
  if (viewportWidth >= 1440) return 3
  if (viewportWidth >= 768) return 2
  return 1
}

function getDefaultRowHeight(viewportHeight: number) {
  return viewportHeight >= 992 ? 328 : 288
}

/** Whether a media is shown with a filter tab ("Videos" leaves out audio files) */
function isInTab(mediaFile: MediaKind, tab: MediaTab) {
  switch (tab) {
    case 'videos':
      return mediaFile.type === 'video' && !mediaFile.isAudioFile
    case 'audio':
      return mediaFile.type === 'video' && !!mediaFile.isAudioFile
    case 'images':
      return mediaFile.type === 'image'
    default:
      return true
  }
}

type BatchMediaCardProps = {
  mediaIndex: number
  isPast: boolean
  isCompressing: boolean
  isProcessCompleted: boolean
  isBatchPaused: boolean
  isLoadingMediaFiles: boolean
  shouldAnimate: boolean
  onRemove: (index: number) => void
  onOpenInFileManager: (savedPath: string) => void
  onCopyToClipboard: (mediaFile: MediaFile) => void
}

/**
 * Isolated batch card subscribed only to its own `media[mediaIndex]` entry so progress updates on
 * one file do not re-render every other card in the batch.
 */
const BatchMediaCard = memo(function BatchMediaCard({
  mediaIndex,
  isPast,
  isCompressing,
  isProcessCompleted,
  isBatchPaused,
  isLoadingMediaFiles,
  shouldAnimate,
  onRemove,
  onOpenInFileManager,
  onCopyToClipboard,
}: BatchMediaCardProps) {
  const { t } = useTranslation()
  const snap = useSnapshot(appProxy)
  const mediaFile = snap.state.media[mediaIndex]
  if (!mediaFile) return null

  const isMediaCompressing =
    isCompressing && !!mediaFile.isCompressing && !isPast
  const compressedSizeDiff =
    typeof mediaFile?.compressedFile?.sizeInBytes === 'number' &&
    typeof mediaFile?.sizeInBytes === 'number' &&
    !Number.isNaN(mediaFile?.sizeInBytes) &&
    mediaFile.sizeInBytes > 0
      ? ((mediaFile.sizeInBytes - mediaFile.compressedFile.sizeInBytes) * 100) /
        mediaFile.sizeInBytes
      : 0

  const handleDoubleClick = () => {
    if (isCompressing || isLoadingMediaFiles) return
    if (
      !mediaFile.isProcessCompleted ||
      mediaFile.compressedFile?.isSuccessful
    ) {
      appProxy.state.selectedMediaIndexForCustomization = mediaIndex
    }
  }

  const cardBody = (
    <Card
      className="bg-zinc-100/5 dark:bg-zinc-900 rounded-none overflow-hidden"
      radius="lg"
    >
      <div className="relative w-full overflow-hidden">
        {mediaFile.thumbnailPath ? (
          <>
            <Image
              src={mediaFile.thumbnailPath}
              alt={mediaFile.fileName ?? ''}
              loading="lazy"
              decoding="async"
              className="w-full max-w-[unset] h-[180px] hlg:h-[220px] object-cover drop-shadow-xl rounded-xl"
              removeWrapper
            />
            {mediaFile.type === 'video' ? (
              <Icon
                name={mediaFile.isAudioFile ? 'music' : 'video'}
                size={40}
                className="text-zinc-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10]"
              />
            ) : null}
          </>
        ) : (
          <div className="w-full h-[180px] hlg:h-[220px] rounded-xl bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
            <Icon
              name={
                mediaFile.type === 'video' && mediaFile.isAudioFile
                  ? 'music'
                  : 'video'
              }
              size={40}
              className="text-zinc-400"
            />
          </div>
        )}
        <div
          className="absolute top-2 left-2 z-10 flex gap-2 items-center"
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {!mediaFile?.isCompressing &&
          mediaFile?.isProcessCompleted &&
          mediaFile?.compressedFile?.isSuccessful ? (
            <Tooltip
              content={t('batch.copyOutput')}
              aria-label={t('batch.copyOutput')}
            >
              <Button
                size="sm"
                isIconOnly
                onPress={() => onCopyToClipboard(mediaFile as MediaFile)}
                className="rounded-full text-white"
              >
                <Icon name="copy" size={28} className="text-primary" />
              </Button>
            </Tooltip>
          ) : null}
          {mediaFile.isProcessCompleted &&
          mediaFile?.compressedFile?.isSaved &&
          mediaFile?.compressedFile?.savedPath ? (
            <div>
              <Tooltip
                content={t('common.showInFileManager')}
                aria-label={t('common.showInFileManager')}
              >
                <Button
                  size="sm"
                  isIconOnly
                  onPress={() =>
                    onOpenInFileManager(mediaFile.compressedFile!.savedPath!)
                  }
                  className="p-2 rounded-full text-white"
                >
                  <Icon
                    name="fileExplorer"
                    size={20}
                    className="text-primary"
                  />
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </div>
        {!isCompressing && !isProcessCompleted && !isLoadingMediaFiles ? (
          <>
            <Button
              size="sm"
              isIconOnly
              onPress={() => onRemove(mediaIndex)}
              onDoubleClick={(event) => event.stopPropagation()}
              className="absolute top-2 right-2 z-10 p-2 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 transition-colors"
            >
              <Icon name="cross" size={18} />
            </Button>
            <Button
              size="sm"
              isIconOnly
              onPress={() => {
                appProxy.state.selectedMediaIndexForCustomization = mediaIndex
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              className={cn(
                'absolute bottom-2 left-2 z-10 rounded-full text-white hover:bg-zinc-700 transition-colors',
                mediaFile.isConfigDirty ? 'bg-primary' : 'bg-zinc-800/80',
              )}
            >
              <Icon name="pencil" size={20} />
            </Button>
          </>
        ) : null}
        {isMediaCompressing ? (
          <>
            {mediaFile?.type === 'video' ? (
              <CircularProgress
                showValueLabel
                className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2"
                value={mediaFile.compressionProgress}
                strokeWidth={2.5}
                classNames={{
                  svg: 'w-14 h-14 drop-shadow-md',
                  track: 'dark:stroke-white/50',
                  value: 'text-[12px] text-white1',
                }}
                aria-label={t('batch.processing')}
              />
            ) : (
              <Spinner className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" />
            )}
            <div className="absolute inset-0 bg-black/70 z-10 rounded-lg" />
          </>
        ) : null}
        <AnimatePresence>
          {isMediaCompressing &&
          mediaFile.type === 'video' &&
          mediaFile.targetSizeRound ? (
            <motion.div
              key={mediaFile.targetSizeRound.round}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white"
            >
              {t('targetSize.round', {
                round: mediaFile.targetSizeRound.round,
              })}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <AnimatePresence>
          {isCompressing && !isPast && !isMediaCompressing ? (
            <motion.div
              key={isBatchPaused ? 'paused' : 'waiting'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-2 left-2 z-20 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white"
            >
              <Icon name={isBatchPaused ? 'pause' : 'clock'} size={12} />
              {isBatchPaused ? t('batch.paused') : t('queue.status.waiting')}
            </motion.div>
          ) : null}
        </AnimatePresence>
        {mediaFile.type === 'video' &&
        mediaFile.compressedFile?.clips?.length ? (
          <div className="absolute bottom-2 left-2 z-20 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {t('clips.count', {
              count: mediaFile.compressedFile.clips.length,
            })}
          </div>
        ) : null}
      </div>
      <section className="px-3 py-2 mt-1">
        <p className="font-medium text-sm truncate block">
          {mediaFile.fileName ?? ''}
        </p>
        <Divider className="mt-2" />
        <section
          className={cn(
            'flex items-center text-[12px] h-[55px] whitespace-nowrap overflow-hidden',
            mediaFile.type === 'video' &&
              !mediaFile?.compressedFile?.isSuccessful
              ? 'justify-between gap-2'
              : 'gap-4',
          )}
        >
          {mediaFile.isProcessCompleted &&
          mediaFile?.compressedFile?.isSuccessful ? (
            <section className="animate-appearance-in w-full flex items-center justify-center gap-4">
              <div className="flex justify-center items-center">
                <p className="text-[16px] font-bold">{mediaFile.size ?? ''}</p>
                <Icon
                  name="curvedArrow"
                  className="text-black dark:text-white rotate-[-65deg] translate-y-[-2px] mx-2"
                  size={40}
                />
                <p className="text-[16px] font-bold text-primary">
                  {mediaFile?.compressedFile?.size ?? ''}
                </p>
              </div>
              {!(compressedSizeDiff <= 0) ? (
                <>
                  <Divider orientation="vertical" className="h-5" />
                  <p className="block text-center text-[16px] text-primary">
                    {t('queue.status.smaller', {
                      value: compressedSizeDiff.toFixed(2)?.endsWith('.00')
                        ? compressedSizeDiff.toFixed(2)?.slice(0, -3)
                        : compressedSizeDiff.toFixed(2),
                    })}
                  </p>
                </>
              ) : null}
            </section>
          ) : (
            <>
              <div className="text-[11px] xl:text-[12px] xxl:text-[12px] 3xl:text-[12.5px]">
                <p className="text-gray-600 dark:text-gray-400 mb-1">
                  {t('batch.inputSize')}
                </p>
                <span className="block font-black">{mediaFile.size}</span>
              </div>
              <Divider orientation="vertical" className="h-5" />
              <div className="text-[11px] xxl:text-[12px] 3xl:text-[12.5px]">
                <p className="text-gray-600 dark:text-gray-400 mb-1">
                  {t('batch.extension')}
                </p>
                <span className="block font-black">
                  {mediaFile.extension ?? '-'}
                </span>
              </div>
              {mediaFile.type === 'video' && mediaFile.videoDuration ? (
                <>
                  <Divider orientation="vertical" className="h-5" />
                  <div className="text-[11px] xxl:text-[12px] 3xl:text-[12.5px]">
                    <p className="text-gray-600 dark:text-gray-400 mb-1">
                      {t('batch.duration')}
                    </p>
                    <span className="block font-black">
                      {formatDuration(mediaFile.videoDuration) ?? '-'}
                    </span>
                  </div>
                </>
              ) : null}
              {mediaFile.dimensions ? (
                <>
                  <Divider orientation="vertical" className="h-5" />
                  <div className="text-[11px] xxl:text-[12px] 3xl:text-[12.5px]">
                    <p className="text-gray-600 dark:text-gray-400 mb-1">
                      {t('batch.dimensions')}
                    </p>
                    <span className="block font-black">
                      {mediaFile.dimensions.width ?? '-'} x{' '}
                      {mediaFile.dimensions.height ?? '-'}
                    </span>
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>
      </section>
    </Card>
  )

  const cardClassName = cn([
    'relative rounded-xl border-1 overflow-hidden',
    isPast ? 'border-primary' : 'border-zinc-200 dark:border-zinc-900',
  ])

  if (!shouldAnimate) {
    return (
      <div onDoubleClick={handleDoubleClick} className={cardClassName}>
        {cardBody}
      </div>
    )
  }

  return (
    <motion.div
      layout
      variants={zoomInStaggerAnimation.item}
      onDoubleClick={handleDoubleClick}
      className={cardClassName}
    >
      {cardBody}
    </motion.div>
  )
})

/**
 * Single-pass batch summary footer isolated from the grid so progress updates re-render only the
 * counters and ring without touching cards.
 */
const BatchSummaryFooter = memo(function BatchSummaryFooter() {
  const { t } = useTranslation()
  const {
    state: {
      activeTab,
      media,
      isCompressing,
      isProcessCompleted,
      totalSelectedMediaCount,
      isLoadingMediaFiles,
      isBatchCompressionCancelled,
    },
  } = useSnapshot(appProxy)

  const stats = useMemo(() => {
    let filteredCount = 0
    let completedCount = 0
    let displayTotalSize = 0
    let outputSize = 0
    let originalSizeOfSmaller = 0
    let compressedSizeOfSmaller = 0
    let progressSum = 0

    let videosTotal = 0
    let videosCompleted = 0
    let audioTotal = 0
    let audioCompleted = 0
    let imagesTotal = 0
    let imagesCompleted = 0

    for (const m of media) {
      if (!isInTab(m, activeTab)) continue
      filteredCount++

      const isVideo = m.type === 'video' && !m.isAudioFile
      const isAudio = m.type === 'video' && !!m.isAudioFile
      const isImage = m.type === 'image'

      if (isVideo) videosTotal++
      else if (isAudio) audioTotal++
      else if (isImage) imagesTotal++

      const origSize = m.sizeInBytes ?? 0
      const compSize = m.compressedFile?.sizeInBytes
      const hasCompletedOutput = !!m.isProcessCompleted && !!compSize

      if (hasCompletedOutput && compSize != null) {
        completedCount++
        if (isVideo) videosCompleted++
        else if (isAudio) audioCompleted++
        else if (isImage) imagesCompleted++

        outputSize += compSize
        if (compSize < origSize) {
          originalSizeOfSmaller += origSize
          compressedSizeOfSmaller += compSize
        }
        if (isBatchCompressionCancelled) {
          displayTotalSize += origSize
        }
      }

      if (!isBatchCompressionCancelled) {
        displayTotalSize += origSize
      }
      progressSum += m?.compressionProgress ?? 0
    }

    const sizeSaved = originalSizeOfSmaller - compressedSizeOfSmaller
    const percentageSaved =
      originalSizeOfSmaller > 0 ? (sizeSaved / originalSizeOfSmaller) * 100 : 0
    const totalProgress = filteredCount > 0 ? progressSum / filteredCount : 0

    const label =
      activeTab === 'videos' || activeTab === 'audio' || activeTab === 'images'
        ? activeTab
        : ('media' as const)

    let count: number
    let cancelledCount = 0
    if (activeTab === 'videos') {
      count = isBatchCompressionCancelled ? videosCompleted : videosTotal
      if (isBatchCompressionCancelled) {
        cancelledCount = videosTotal - videosCompleted
      }
    } else if (activeTab === 'audio') {
      count = isBatchCompressionCancelled ? audioCompleted : audioTotal
      if (isBatchCompressionCancelled) {
        cancelledCount = audioTotal - audioCompleted
      }
    } else if (activeTab === 'images') {
      count = isBatchCompressionCancelled ? imagesCompleted : imagesTotal
      if (isBatchCompressionCancelled) {
        cancelledCount = imagesTotal - imagesCompleted
      }
    } else {
      count = isBatchCompressionCancelled ? completedCount : filteredCount
      if (isBatchCompressionCancelled) {
        cancelledCount = filteredCount - completedCount
      }
    }

    return {
      label,
      count,
      cancelledCount,
      filteredCount,
      completedCount,
      displayTotalSize,
      outputSize,
      sizeSaved,
      percentageSaved,
      totalProgress,
    }
  }, [media, activeTab, isBatchCompressionCancelled])

  return (
    <section className="relative px-4 py-6 flex flex-col items-center">
      {isLoadingMediaFiles ? (
        <Progress
          size="sm"
          aria-label={t('batch.processing')}
          isIndeterminate={totalSelectedMediaCount == null}
          className="w-[100px] mb-2 absolute top-2 right-1/2 translate-x-1/2"
          value={(stats.filteredCount * 100) / (totalSelectedMediaCount || 1)}
        />
      ) : null}
      <div className="max-w-7xl mx-auto">
        {isCompressing ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('batch.compressed', { context: stats.label })}
                </p>
                <p className="font-black text-lg">
                  {stats.completedCount ?? 0} / {stats.filteredCount}
                </p>
              </div>
              <Divider orientation="vertical" className="h-8" />
              <div>
                <p className="text-gray-600 dark:text-gray-400">
                  {t('batch.sizeSaved')}
                </p>
                <p className="font-black text-lg text-primary">
                  {formatBytes(stats.sizeSaved ?? 0) || '...'}
                  {stats.percentageSaved
                    ? `(${(stats.percentageSaved ?? 0).toFixed(0)}%)`
                    : null}
                </p>
              </div>
            </div>
            <Divider orientation="vertical" className="h-8" />
            <div className="flex-1">
              <CircularProgress
                showValueLabel
                size="lg"
                value={stats.totalProgress ?? 0}
                strokeWidth={3}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <div>
              <p className="text-gray-600 dark:text-gray-400">
                {t('batch.label', { context: stats.label })}
              </p>
              <p
                className={cn(
                  'font-black text-lg',
                  isLoadingMediaFiles ? 'animate-pulse' : '',
                )}
              >
                {stats.count}
                {stats.cancelledCount > 0 ? (
                  <span className="text-xs text-warning-400 ml-2">
                    (
                    {t('queue.summary.cancelled', {
                      count: stats.cancelledCount,
                    })}
                    )
                  </span>
                ) : null}
              </p>
            </div>
            <Divider orientation="vertical" className="h-8" />
            <div>
              <p className="text-gray-600 dark:text-gray-400">
                {t('batch.inputSize')}
              </p>
              <p
                className={cn(
                  'font-black text-lg',
                  isLoadingMediaFiles ? 'animate-pulse' : '',
                )}
              >
                {formatBytes(stats.displayTotalSize)}
              </p>
            </div>
            {isProcessCompleted ? (
              <>
                <Divider orientation="vertical" className="h-8" />
                <div>
                  <p className="text-gray-600 dark:text-gray-400">
                    {t('batch.outputSize')}
                  </p>
                  <p className="font-black text-lg">
                    {formatBytes(stats.outputSize ?? 0) || '-'}
                  </p>
                </div>
                <Divider orientation="vertical" className="h-8" />
                <div>
                  <p className="text-gray-600 dark:text-gray-400">
                    {t('batch.sizeSaved')}
                  </p>
                  <p
                    className={cn(
                      'font-black text-lg',
                      (stats.sizeSaved ?? 0) > 0 ? 'text-primary' : '',
                    )}
                  >
                    {formatBytes(stats.sizeSaved ?? 0) || '-'} (
                    {(stats.percentageSaved ?? 0).toFixed(
                      (stats.sizeSaved ?? 0) > 0 ? 2 : 0,
                    )}
                    %)
                  </p>
                </div>
              </>
            ) : (
              <>
                <Divider orientation="vertical" className="h-8" />
                <Tooltip
                  content={t('batch.addMoreTooltip')}
                  aria-label={t('batch.addMoreMedia')}
                >
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={pickMediaToAdd}
                    isDisabled={isLoadingMediaFiles}
                    className="h-7 min-w-[unset] px-3 text-xs"
                  >
                    <Icon name="addMedia" size={14} />
                    {t('batch.addMore')}
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
})

function PreviewBatchMedia() {
  const { t } = useTranslation()
  const {
    state: {
      activeTab,
      media,
      isCompressing,
      isProcessCompleted,
      isBatchPaused,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)

  const handleRemoveMedia = useCallback(
    (index: number) => {
      if (isCompressing) return
      appProxy.state.media = appProxy.state.media.filter((_, i) => i !== index)
    },
    [isCompressing],
  )

  const handleOpenInFileManager = useCallback(async (savedPath: string) => {
    try {
      await showItemInFileManager(savedPath)
    } catch {}
  }, [])

  const handleCopyToClipboard = useCallback(
    async (mediaFile: MediaFile) => {
      const files = getOutputClipboardFiles(mediaFile)
      if (!files.length) return
      try {
        await copyFilesToClipboard(files)
        toast.success(t('common.copied'))
      } catch {}
    },
    [t],
  )

  // Only read structural fields (`id`, `type`, `isAudioFile`, `isCompressing`, `isProcessCompleted`)
  // here so progress ticks (`compressionProgress`) do not invalidate the grid layout.
  const visibleCards = useMemo(() => {
    const lastStartedIndexes = new Map<
      ReturnType<typeof getCompressionLane>,
      number
    >()
    media.forEach((m, index) => {
      if (m.isCompressing || m.isProcessCompleted) {
        lastStartedIndexes.set(getCompressionLane(m as MediaFile), index)
      }
    })

    const cards: Array<{ id: string; originalIndex: number; isPast: boolean }> =
      []
    media.forEach((m, index) => {
      if (!isInTab(m, activeTab)) return
      const lane = getCompressionLane(m as MediaFile)
      const isPast =
        !!m.isProcessCompleted ||
        (!m.isCompressing && index < (lastStartedIndexes.get(lane) ?? -1))
      cards.push({
        id: m.id ?? String(index),
        originalIndex: index,
        isPast,
      })
    })
    return cards
  }, [media, activeTab])

  const shouldAnimate = visibleCards.length <= STAGGER_ITEM_LIMIT
  const useVirtualGrid = visibleCards.length > STAGGER_ITEM_LIMIT

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sampleRowRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [columns, setColumns] = useState(() =>
    typeof window !== 'undefined' ? getGridColumns(window.innerWidth) : 2,
  )
  const [rowHeight, setRowHeight] = useState(() =>
    typeof window !== 'undefined'
      ? getDefaultRowHeight(window.innerHeight)
      : 300,
  )

  useEffect(() => {
    const onResize = () => {
      setColumns(getGridColumns(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const syncHeight = () => {
      if (el.clientHeight > 0) {
        setViewportHeight((prev) =>
          el.clientHeight !== prev ? el.clientHeight : prev,
        )
      }
    }
    syncHeight()
    const observer = new ResizeObserver(syncHeight)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Measure the rendered virtual row asynchronously outside React's commit phase so
  // changing heights can never trigger a synchronous nested update loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-measure when grid geometry changes
  useEffect(() => {
    if (!useVirtualGrid) return
    const frameId = requestAnimationFrame(() => {
      const measured = sampleRowRef.current?.clientHeight ?? 0
      if (measured > 0) {
        setRowHeight((prev) =>
          Math.abs(measured - prev) > 1 ? measured : prev,
        )
      }
    })
    return () => cancelAnimationFrame(frameId)
  }, [useVirtualGrid, columns, viewportHeight])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset scroll when active tab changes
  useEffect(() => {
    setScrollTop(0)
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [activeTab])

  const rowStride = rowHeight + ROW_GAP_PX
  const totalRows = Math.ceil(visibleCards.length / columns)
  const firstRowIndex = Math.max(
    0,
    Math.min(
      Math.max(0, totalRows - 1),
      Math.floor(scrollTop / rowStride) - OVERSCAN_ROWS,
    ),
  )
  const lastRowIndex = Math.min(
    totalRows,
    Math.max(
      firstRowIndex,
      Math.ceil((scrollTop + viewportHeight) / rowStride) + OVERSCAN_ROWS,
    ),
  )

  return (
    <>
      <ScrollShadow
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="h-[75vh] hlg:h-[80vh] overflow-hidden overflow-y-auto"
        hideScrollBar
      >
        {useVirtualGrid ? (
          <div
            className="relative"
            style={{
              height: Math.max(0, totalRows * rowStride - ROW_GAP_PX),
            }}
          >
            {Array.from(
              { length: Math.max(0, lastRowIndex - firstRowIndex) },
              (_, offset) => {
                const rowIndex = firstRowIndex + offset
                const start = rowIndex * columns
                const rowCards = visibleCards.slice(start, start + columns)
                return (
                  <div
                    key={rowIndex}
                    ref={offset === 0 ? sampleRowRef : undefined}
                    className="absolute left-0 right-0 grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-4"
                    style={{ top: rowIndex * rowStride }}
                  >
                    {rowCards.map((card) => (
                      <BatchMediaCard
                        key={card.id}
                        mediaIndex={card.originalIndex}
                        isPast={card.isPast}
                        isCompressing={isCompressing}
                        isProcessCompleted={isProcessCompleted}
                        isBatchPaused={!!isBatchPaused}
                        isLoadingMediaFiles={isLoadingMediaFiles}
                        shouldAnimate={false}
                        onRemove={handleRemoveMedia}
                        onOpenInFileManager={handleOpenInFileManager}
                        onCopyToClipboard={handleCopyToClipboard}
                      />
                    ))}
                  </div>
                )
              },
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              variants={zoomInStaggerAnimation.container}
              initial="hidden"
              animate="show"
              exit="hidden"
              className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-4"
            >
              {visibleCards.map((card) => (
                <BatchMediaCard
                  key={card.id}
                  mediaIndex={card.originalIndex}
                  isPast={card.isPast}
                  isCompressing={isCompressing}
                  isProcessCompleted={isProcessCompleted}
                  isBatchPaused={!!isBatchPaused}
                  isLoadingMediaFiles={isLoadingMediaFiles}
                  shouldAnimate={shouldAnimate}
                  onRemove={handleRemoveMedia}
                  onOpenInFileManager={handleOpenInFileManager}
                  onCopyToClipboard={handleCopyToClipboard}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </ScrollShadow>
      <BatchSummaryFooter />
    </>
  )
}

export default memo(PreviewBatchMedia)
