import { AnimatePresence, motion } from 'framer-motion'
import { memo, useCallback, useMemo } from 'react'
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
import { copyFileToClipboard, showItemInFileManager } from '@/tauri/commands/fs'
import { zoomInStaggerAnimation } from '@/utils/animation'
import { formatBytes } from '@/utils/fs'
import { formatDuration } from '@/utils/string'
import { cn } from '@/utils/tailwind'
import { appProxy } from '../-state'

function PreviewBatchMedia() {
  const {
    state: {
      activeTab,
      media,
      isCompressing,
      isProcessCompleted,
      currentMediaIndex,
      totalSelectedMediaCount,
      isLoadingMediaFiles,
      isBatchCompressionCancelled,
    },
  } = useSnapshot(appProxy)

  const compressionStats = useMemo(() => {
    const filteredMediaForStats =
      activeTab === 'videos'
        ? media.filter((m) => m.type === 'video')
        : activeTab === 'images'
          ? media.filter((m) => m.type === 'image')
          : media

    const totalMedia = filteredMediaForStats.length
    const totalVideos = filteredMediaForStats.filter(
      (m) => m.type === 'video',
    ).length
    const totalImages = filteredMediaForStats.filter(
      (m) => m.type === 'image',
    ).length
    const totalSize = filteredMediaForStats.reduce(
      (sum, m) => sum + (m.sizeInBytes ?? 0),
      0,
    )

    const completedMedia = filteredMediaForStats.filter(
      (m) => m.isProcessCompleted && m.compressedFile?.sizeInBytes,
    )
    const compressedMediaCount = completedMedia.length
    const cancelledMediaCount = isBatchCompressionCancelled
      ? totalMedia - compressedMediaCount
      : 0
    const cancelledVideosCount = isBatchCompressionCancelled
      ? totalVideos - completedMedia.filter((m) => m.type === 'video').length
      : 0
    const cancelledImagesCount = isBatchCompressionCancelled
      ? totalImages - completedMedia.filter((m) => m.type === 'image').length
      : 0

    const originalSizeOfCompressedOnly = completedMedia.reduce((sum, m) => {
      const cs = m.compressedFile?.sizeInBytes
      const os = m.sizeInBytes ?? 0

      return sum + (cs != null && cs < os ? os : 0)
    }, 0)
    const outputSize = completedMedia.reduce((sum, v) => {
      const cs = v.compressedFile?.sizeInBytes
      return sum + (cs != null ? cs : 0)
    }, 0)
    const compressedSize = completedMedia.reduce((sum, v) => {
      const cs = v.compressedFile?.sizeInBytes
      const os = v.sizeInBytes ?? 0

      return sum + (cs != null && cs < os ? cs : 0)
    }, 0)
    const sizeSaved = originalSizeOfCompressedOnly - compressedSize
    const percentageSaved =
      originalSizeOfCompressedOnly > 0
        ? (sizeSaved / originalSizeOfCompressedOnly) * 100
        : 0

    const totalProgress = filteredMediaForStats.reduce(
      (a, c) =>
        a + (c?.compressionProgress ?? 0) / filteredMediaForStats.length,
      0,
    )

    const displayTotalMedia = isBatchCompressionCancelled
      ? compressedMediaCount
      : totalMedia
    const displayTotalVideos = isBatchCompressionCancelled
      ? completedMedia.filter((m) => m.type === 'video').length
      : totalVideos
    const displayTotalImages = isBatchCompressionCancelled
      ? completedMedia.filter((m) => m.type === 'image').length
      : totalImages
    const displayTotalSize = isBatchCompressionCancelled
      ? completedMedia.reduce((sum, v) => sum + (v.sizeInBytes ?? 0), 0)
      : totalSize

    return {
      totalMedia,
      totalVideos,
      totalImages,
      totalSize,
      compressedMediaCount,
      compressedSize,
      outputSize,
      sizeSaved,
      percentageSaved,
      totalProgress,
      cancelledMediaCount,
      cancelledVideosCount,
      cancelledImagesCount,
      displayTotalMedia,
      displayTotalVideos,
      displayTotalImages,
      displayTotalSize,
    }
  }, [media, isBatchCompressionCancelled, activeTab])

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

  const handleCopyToClipboard = useCallback(async (savedPath: string) => {
    try {
      await copyFileToClipboard(savedPath)
      toast.success('已复制到剪贴板。')
    } catch {}
  }, [])

  const filteredMedia = useMemo(() => {
    if (activeTab === 'videos') {
      return media.filter((m) => m.type === 'video')
    } else if (activeTab === 'images') {
      return media.filter((m) => m.type === 'image')
    }
    return media
  }, [media, activeTab])

  const getDisplayStats = useMemo(() => {
    const totalMedia = filteredMedia.length

    const completedMedia = filteredMedia.filter(
      (m) => m.isProcessCompleted && m.compressedFile?.sizeInBytes,
    )
    const compressedMediaCount = completedMedia.length

    const displayTotalSize = filteredMedia.reduce(
      (sum: number, m) => sum + (m.sizeInBytes ?? 0),
      0,
    )

    const outputSize = completedMedia.reduce(
      (sum: number, m) => sum + (m.compressedFile?.sizeInBytes ?? 0),
      0,
    )

    const originalSizeOfCompressedOnly = completedMedia.reduce(
      (sum: number, m) => {
        const cs = m.compressedFile?.sizeInBytes
        const os = m.sizeInBytes ?? 0
        return sum + (cs != null && cs < os ? os : 0)
      },
      0,
    )

    const compressedSize = completedMedia.reduce((sum: number, m) => {
      const cs = m.compressedFile?.sizeInBytes
      const os = m.sizeInBytes ?? 0
      return sum + (cs != null && cs < os ? cs : 0)
    }, 0)

    const sizeSaved = originalSizeOfCompressedOnly - compressedSize
    const percentageSaved =
      originalSizeOfCompressedOnly > 0
        ? (sizeSaved / originalSizeOfCompressedOnly) * 100
        : 0

    const totalProgress = filteredMedia.reduce(
      (sum: number, m) =>
        sum + (m?.compressionProgress ?? 0) / filteredMedia.length,
      0,
    )

    if (activeTab === 'videos') {
      return {
        label: '视频',
        count: compressionStats.displayTotalVideos,
        cancelledCount: compressionStats.cancelledVideosCount,
        totalMedia,
        compressedMediaCount,
        displayTotalSize,
        outputSize,
        sizeSaved,
        percentageSaved,
        totalProgress,
      }
    } else if (activeTab === 'images') {
      return {
        label: '图片',
        count: compressionStats.displayTotalImages,
        cancelledCount: compressionStats.cancelledImagesCount,
        totalMedia,
        compressedMediaCount,
        displayTotalSize,
        outputSize,
        sizeSaved,
        percentageSaved,
        totalProgress,
      }
    }
    return {
      label: '媒体',
      count: compressionStats.displayTotalMedia,
      cancelledCount: compressionStats.cancelledMediaCount,
      totalMedia,
      compressedMediaCount,
      displayTotalSize,
      outputSize,
      sizeSaved,
      percentageSaved,
      totalProgress,
    }
  }, [activeTab, compressionStats, filteredMedia])

  return (
    <>
      <ScrollShadow
        className="h-[75vh] hlg:h-[80vh] overflow-hidden overflow-y-auto"
        hideScrollBar
      >
        <AnimatePresence mode="wait">
          <motion.div
            variants={zoomInStaggerAnimation.container}
            initial="hidden"
            animate="show"
            exit="hidden"
            className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4 gap-4"
          >
            {filteredMedia.map((mediaFile, filteredIndex) => {
              const originalIndex = media.findIndex(
                (m) => m.id === mediaFile.id,
              )

              const compressedSizeDiff =
                typeof mediaFile?.compressedFile?.sizeInBytes === 'number' &&
                typeof mediaFile?.sizeInBytes === 'number' &&
                !Number.isNaN(mediaFile?.sizeInBytes)
                  ? (((mediaFile?.sizeInBytes ?? 0) -
                      (mediaFile?.compressedFile?.sizeInBytes ?? 0)) *
                      100) /
                    mediaFile?.sizeInBytes
                  : 0

              return (
                <motion.div
                  key={mediaFile.id}
                  layout
                  variants={zoomInStaggerAnimation.item}
                  className={cn([
                    'relative rounded-xl border-2 overflow-hidden',
                    currentMediaIndex > originalIndex ||
                    mediaFile.isProcessCompleted
                      ? 'border-green-400'
                      : 'border-zinc-200 dark:border-zinc-900',
                  ])}
                >
                  <Card
                    className={cn(
                      'bg-zinc-100/5 dark:bg-zinc-900 rounded-none overflow-hidden',
                    )}
                    radius="lg"
                  >
                    <div className="relative w-full overflow-hidden">
                      {mediaFile.thumbnailPath ? (
                        <>
                          <Image
                            src={mediaFile.thumbnailPath}
                            alt={mediaFile.fileName ?? ''}
                            className="w-full max-w-[unset] h-[180px] hlg:h-[220px] object-cover drop-shadow-xl rounded-xl"
                            removeWrapper
                          />
                          {mediaFile.type === 'video' ? (
                            <Icon
                              name="video"
                              size={40}
                              className="text-zinc-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[10]"
                            />
                          ) : null}
                        </>
                      ) : (
                        <div className="w-full aspect-video bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                          <Icon
                            name="video"
                            size={40}
                            className="text-zinc-400"
                          />
                        </div>
                      )}
                      <div className="absolute top-2 left-2 z-10 flex gap-2 items-center">
                        {!mediaFile?.isCompressing &&
                        mediaFile?.isProcessCompleted &&
                        mediaFile?.compressedFile?.isSuccessful ? (
                          <>
                            {/* Can copy to output immediately after it's process is completed. no need to wait for other processes */}
                            <Tooltip
                              content="复制输出文件到剪贴板"
                              aria-label="复制输出文件到剪贴板"
                            >
                              <Button
                                size="sm"
                                isIconOnly
                                onPress={() =>
                                  handleCopyToClipboard(
                                    (mediaFile?.compressedFile?.savedPath ??
                                      mediaFile?.compressedFile
                                        ?.pathRaw) as string,
                                  )
                                }
                                className="rounded-full text-white"
                              >
                                <Icon
                                  name="copy"
                                  size={28}
                                  className="text-green-400"
                                />
                              </Button>
                            </Tooltip>
                            {!isCompressing ? (
                              <Tooltip
                                content="对比输出结果"
                                aria-label="对比输出结果"
                              >
                                <Button
                                  size="sm"
                                  isIconOnly
                                  onPress={() => {
                                    appProxy.state.selectedMediaIndexForCustomization =
                                      originalIndex
                                  }}
                                  className={cn(
                                    'rounded-full text-white hover:bg-zinc-700 transition-colors',
                                  )}
                                >
                                  <Icon
                                    name="compare"
                                    size={20}
                                    className="text-green-400"
                                  />
                                </Button>
                              </Tooltip>
                            ) : null}
                          </>
                        ) : null}
                        {mediaFile.isProcessCompleted &&
                        mediaFile?.compressedFile?.isSaved &&
                        mediaFile?.compressedFile?.savedPath ? (
                          <div>
                            <Tooltip
                              content="在文件管理器中显示"
                              aria-label="在文件管理器中显示"
                            >
                              <Button
                                size="sm"
                                isIconOnly
                                onPress={() =>
                                  handleOpenInFileManager(
                                    mediaFile.compressedFile!.savedPath!,
                                  )
                                }
                                className="p-2 rounded-full text-white"
                              >
                                <Icon
                                  name="fileExplorer"
                                  size={20}
                                  className="text-green-400"
                                />
                              </Button>
                            </Tooltip>
                          </div>
                        ) : null}
                      </div>
                      {!isCompressing &&
                      !isProcessCompleted &&
                      !isLoadingMediaFiles ? (
                        <>
                          <Button
                            size="sm"
                            isIconOnly
                            onPress={() => handleRemoveMedia(originalIndex)}
                            className="absolute top-2 right-2 z-10 p-2 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 transition-colors"
                          >
                            <Icon name="cross" size={18} />
                          </Button>
                          <Button
                            size="sm"
                            isIconOnly
                            onPress={() => {
                              appProxy.state.selectedMediaIndexForCustomization =
                                originalIndex
                            }}
                            className={cn(
                              'absolute bottom-2 left-2 z-10 rounded-full text-white hover:bg-zinc-700 transition-colors',
                              mediaFile.isConfigDirty
                                ? 'bg-primary'
                                : 'bg-zinc-800/80',
                            )}
                          >
                            <Icon name="pencil" size={20} />
                          </Button>
                        </>
                      ) : null}
                      {isCompressing && currentMediaIndex === originalIndex ? (
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
                              aria-label="正在处理"
                            />
                          ) : (
                            <Spinner className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2" />
                          )}
                          <div className="absolute inset-0 bg-black/70 z-10 rounded-lg"></div>
                        </>
                      ) : null}
                    </div>
                    <section className="px-3 py-2 mt-1">
                      <p className={cn(['font-medium text-sm truncate block'])}>
                        {mediaFile.fileName ?? ''}
                      </p>
                      <Divider className="mt-2" />
                      <section
                        className={cn(
                          'flex items-center text-[12px] min-h-[55px]',
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
                              <p className="text-[16px] font-bold">
                                {mediaFile.size ?? ''}
                              </p>
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
                                <Divider
                                  orientation="vertical"
                                  className="h-5"
                                />
                                <p className="block text-center text-[16px] text-green-500">
                                  {compressedSizeDiff
                                    .toFixed(2)
                                    ?.endsWith('.00')
                                    ? compressedSizeDiff
                                        .toFixed(2)
                                        ?.slice(0, -3)
                                    : compressedSizeDiff.toFixed(2)}
                                  %<span> 更小</span>
                                </p>
                              </>
                            ) : null}
                          </section>
                        ) : (
                          <>
                            <div className="text-[11px] xl:text-[12px] xxl:text-[12px] 3xl:text-[12.5px]">
                              <p className=" text-gray-600 dark:text-gray-400 mb-1">
                                输入大小
                              </p>
                              <span className="block font-black">
                                {mediaFile.size}
                              </span>
                            </div>
                            <Divider orientation="vertical" className="h-5" />
                            <div className="text-[11px] xxl:text-[12px] 3xl:text-[12.5px]">
                              <p className=" text-gray-600 dark:text-gray-400 mb-1">
                                扩展名
                              </p>
                              <span className="block font-black">
                                {mediaFile.extension ?? '-'}
                              </span>
                            </div>
                            {mediaFile.type === 'video' &&
                            mediaFile.videoDuration ? (
                              <>
                                <Divider
                                  orientation="vertical"
                                  className="h-5"
                                />
                                <div className="text-[11px] xxl:text-[12px] 3xl:text-[12.5px]">
                                  <p className=" text-gray-600 dark:text-gray-400 mb-1">
                                    时长
                                  </p>
                                  <span className="block font-black">
                                    {formatDuration(mediaFile.videoDuration) ??
                                      '-'}
                                  </span>
                                </div>
                              </>
                            ) : null}
                            {mediaFile.dimensions ? (
                              <>
                                <Divider
                                  orientation="vertical"
                                  className="h-5"
                                />
                                <div className="text-[11px] xxl:text-[12px] 3xl:text-[12.5px]">
                                  <p className=" text-gray-600 dark:text-gray-400 mb-1">
                                    尺寸
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
                </motion.div>
              )
            })}
          </motion.div>
        </AnimatePresence>
      </ScrollShadow>
      <section className="relative px-4 py-6 flex flex-col items-center">
        {isLoadingMediaFiles ? (
          <Progress
            size="sm"
            isIndeterminate={totalSelectedMediaCount == null}
            className="w-[100px] mb-2 absolute top-2 right-1/2 translate-x-1/2"
            value={
              (filteredMedia.length * 100) / (totalSelectedMediaCount || 1)
            }
          />
        ) : null}
        <div className="max-w-7xl mx-auto">
          {isCompressing ? (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <p className=" text-gray-600 dark:text-gray-400">
                    已处理 {getDisplayStats.label}
                  </p>
                  <p className="font-black text-lg">
                    {getDisplayStats.compressedMediaCount ?? 0} /{' '}
                    {getDisplayStats.totalMedia}
                  </p>
                </div>
                <Divider orientation="vertical" className="h-8" />
                <div>
                  <p className=" text-gray-600 dark:text-gray-400">节省空间</p>
                  <p className="font-black text-lg text-green-600 dark:text-green-400">
                    {formatBytes(getDisplayStats.sizeSaved ?? 0) || '...'}
                    {getDisplayStats.percentageSaved
                      ? `(${(getDisplayStats.percentageSaved ?? 0).toFixed(0)}%)`
                      : null}
                  </p>
                </div>
              </div>
              <Divider orientation="vertical" className="h-8" />
              <div className="flex-1">
                <CircularProgress
                  showValueLabel
                  size="lg"
                  value={getDisplayStats.totalProgress ?? 0}
                  strokeWidth={3}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div>
                <p className=" text-gray-600 dark:text-gray-400">
                  {getDisplayStats.label}
                </p>
                <p
                  className={cn(
                    'font-black text-lg',
                    isLoadingMediaFiles ? 'animate-pulse' : '',
                  )}
                >
                  {getDisplayStats.count}
                  {getDisplayStats.cancelledCount > 0 ? (
                    <span className="text-xs  text-warning-400 ml-2">
                      （{getDisplayStats.cancelledCount} 个已取消）
                    </span>
                  ) : null}
                </p>
              </div>
              <Divider orientation="vertical" className="h-8" />
              <div>
                <p className=" text-gray-600 dark:text-gray-400">输入大小</p>
                <p
                  className={cn(
                    'font-black text-lg',
                    isLoadingMediaFiles ? 'animate-pulse' : '',
                  )}
                >
                  {formatBytes(getDisplayStats.displayTotalSize)}
                </p>
              </div>
              {isProcessCompleted ? (
                <>
                  <Divider orientation="vertical" className="h-8" />
                  <div>
                    <p className=" text-gray-600 dark:text-gray-400">
                      输出大小
                    </p>
                    <p className={cn('font-black text-lg')}>
                      {formatBytes(getDisplayStats.outputSize ?? 0) || '-'}
                    </p>
                  </div>
                  <Divider orientation="vertical" className="h-8" />
                  <div>
                    <p className=" text-gray-600 dark:text-gray-400">
                      节省空间
                    </p>
                    <p
                      className={cn(
                        'font-black text-lg',
                        (getDisplayStats.sizeSaved ?? 0) > 0
                          ? 'text-green-600 dark:text-green-400'
                          : '',
                      )}
                    >
                      {formatBytes(getDisplayStats.sizeSaved ?? 0) || '-'} (
                      {(getDisplayStats.percentageSaved ?? 0).toFixed(
                        (getDisplayStats.sizeSaved ?? 0) > 0 ? 2 : 0,
                      )}
                      %)
                    </p>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </>
  )
}

export default memo(PreviewBatchMedia)
