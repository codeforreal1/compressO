import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import AnimatedNumber from '@/components/AnimatedNumber'
import Button from '@/components/Button'
import Code from '@/components/Code'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import ImpactPop from '@/components/ImpactPop'
import { CircularProgress } from '@/components/Progress'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import * as constants from '@/constants'
import { showItemInFileManager } from '@/tauri/commands/fs'
import { isAudioExtension } from '@/types/compression'
import { Ripple } from '@/ui/Patterns/Ripple'
import { slideUpTransition, zoomInTransition } from '@/utils/animation'
import { formatBytes } from '@/utils/fs'
import { isOverlayOpen, isTextEntryElement } from '@/utils/keyboard'
import { isOutputPreviewPending } from '@/utils/outputPreview'
import { formatDuration } from '@/utils/string'
import { cn } from '@/utils/tailwind'
import ExitMedia from './ExitMedia'
import ImageInfo from './ImageInfo'
import MediaOutputCompareSlider from './MediaOutputCompareSlider'
import MediaThumbnail from './MediaThumbnail'
import OutputOptions from './OutputOptions'
import styles from './styles.module.css'
import VideoInfo from './VideoInfo'
import { pickMediaToAdd } from '../-media'
import { appProxy } from '../-state'

type PreviewSingleMediaProps = {
  mediaIndex: number
  /**
   * Shown at the end of the header, also while editing (e.g. the Apply & Reset of a media
   * customized in a batch)
   */
  headerEnd?: React.ReactNode
}

/** How long the result's numbers count (in seconds) before they land */
const RESULT_COUNT_SECONDS = 0.3

/** A percentage as shown, e.g. `99.77` or `50` (without `.00`) */
const formatPercentage = (value: number) => {
  const text = value.toFixed(2)
  return text.endsWith('.00') ? text.slice(0, -3) : text
}

function PreviewSingleMedia({
  mediaIndex,
  headerEnd,
}: PreviewSingleMediaProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return

  const {
    state: {
      media,
      isProcessCompleted,
      isCompressing,
      isSaving,
      showMediaInfo,
      isLoadingMediaFiles,
      isWaitingForDropZone,
      isEstimatingSize,
    },
  } = useSnapshot(appProxy)
  const mediaFile = media.length > 0 ? media[mediaIndex] : null
  const {
    size: mediaSize,
    sizeInBytes,
    dimensions,
    extension: mediaExtension,
    compressionProgress,
    compressedFile,
    thumbnailPath,
  } = mediaFile ?? {}
  const estimatedOutputSize =
    mediaFile?.type === 'video' ? mediaFile.estimatedOutputSize : null
  const { videoDuration, fps } =
    mediaFile?.type === 'video' ? (mediaFile ?? {}) : {}
  const { isVideoTransformEditMode, isVideoTrimEditMode } =
    mediaFile?.type === 'video' ? (mediaFile?.config ?? {}) : {}
  const { isImageTransformEditMode } =
    mediaFile?.type === 'image' ? (mediaFile?.config ?? {}) : {}

  // With a transform (crop, rotation, flip), the preview shows the edited media; this switch shows
  // the original instead, to compare
  const hasTransformPreview =
    mediaFile?.type === 'image'
      ? !!mediaFile.config.shouldTransformImage &&
        !!mediaFile.config.transformImageConfig?.transformHistory?.length
      : mediaFile?.type === 'video'
        ? !!mediaFile.config.shouldTransformVideo &&
          !!mediaFile.config.transformVideoConfig?.transformHistory?.length
        : false
  // On by default; remembers the user's last choice, like Compare
  const [showOriginal, setShowOriginal] = useState(
    () => localStorage.getItem(constants.showEdits) === 'false',
  )
  // Back to the edited preview when editing again
  useEffect(() => {
    if (isVideoTransformEditMode || isImageTransformEditMode) {
      setShowOriginal(false)
    }
  }, [isVideoTransformEditMode, isImageTransformEditMode])

  // Off by default; remembers the user's last choice
  const [compareOutput, setCompareOutput] = useState(
    () => localStorage.getItem(constants.compareOutput) === 'true',
  )
  const outputPreviewPending = isOutputPreviewPending(mediaFile, {
    isCompressing,
    isSaving,
  })
  // The original & the output side by side, for a video (in its video preview) or an image
  const canCompare =
    isProcessCompleted &&
    !outputPreviewPending &&
    !isAudioExtension(mediaFile?.compressedFile?.extension) &&
    ((mediaFile?.type === 'video' && mediaFile?.previewMode === 'video') ||
      mediaFile?.type === 'image')

  const compressedSizeDiff: number = useMemo(
    () =>
      typeof compressedFile?.sizeInBytes === 'number' &&
      typeof sizeInBytes === 'number' &&
      !Number.isNaN(sizeInBytes)
        ? (((sizeInBytes ?? 0) - (compressedFile?.sizeInBytes ?? 0)) * 100) /
          sizeInBytes
        : 0,
    [compressedFile?.sizeInBytes, sizeInBytes],
  )
  // Only a smaller output is counted down (a larger one is shown as it is)
  const isSmaller = compressedSizeDiff > 0

  const singleFileNameDisplay =
    (isProcessCompleted
      ? mediaFile?.compressedFile?.fileNameToDisplay
      : mediaFile?.fileName) ?? ''

  const isMediaTransformEditMode =
    isVideoTransformEditMode || isImageTransformEditMode
  const isMediaTrimEditMode = isVideoTrimEditMode
  const isEditing = !!(isMediaTransformEditMode || isMediaTrimEditMode)

  // Escape saves the crop & trim editors, like their Save buttons (the edits are kept as they are
  // made), back to the preview
  useEffect(() => {
    if (!isEditing) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.repeat ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        isTextEntryElement(e.target as HTMLElement | null) ||
        isOverlayOpen()
      ) {
        return
      }
      const targetMedia = appProxy.state.media[mediaIndex]
      if (!targetMedia) return
      e.preventDefault()
      if (targetMedia.type === 'video') {
        targetMedia.config.isVideoTransformEditMode = false
        targetMedia.config.isVideoTrimEditMode = false
      } else {
        targetMedia.config.isImageTransformEditMode = false
      }
    }
    // Capture phase, before the Escape of a media customized in a batch (its Apply)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isEditing, mediaIndex])

  return !isCompressing ? (
    <motion.div
      className="relative w-full h-full flex flex-col justify-center"
      {...zoomInTransition}
    >
      {!isEditing || headerEnd ? (
        // Pinned to the top of the preview: exit & the file on the left, its actions on the right
        <div className="absolute top-0 left-0 right-0 z-[1] flex justify-between items-center gap-2">
          {/* The editors take the whole preview */}
          <div
            className={cn([
              'flex items-center gap-1 min-w-0',
              isEditing && 'invisible',
            ])}
          >
            {/* A media of a batch is closed with the batch's exit instead */}
            {media.length === 1 ? <ExitMedia /> : null}
            <Code size="sm" className="w-fit rounded-xl px-4 text-xs truncate">
              {singleFileNameDisplay?.length > 50
                ? `${singleFileNameDisplay?.slice(0, 20)}...${singleFileNameDisplay?.slice(
                    -10,
                  )}`
                : singleFileNameDisplay}
            </Code>
            {mediaFile?.pathRaw ? (
              <Tooltip
                content={t('common.showInFileManager')}
                aria-label={t('common.showInFileManager')}
              >
                <Button
                  size="sm"
                  variant="light"
                  isIconOnly
                  onPress={() => {
                    if (mediaFile.pathRaw) {
                      showItemInFileManager(mediaFile.pathRaw).catch(() => {
                        toast.error(t('preview.showFailed'))
                      })
                    }
                  }}
                  className="h-7 w-7 min-w-7"
                >
                  <Icon name="fileExplorer" size={14} />
                </Button>
              </Tooltip>
            ) : null}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* The preview's switches, together at the top right: Compare after compression, Show
                edits before */}
            {canCompare && !isEditing ? (
              <Switch
                size="xs"
                isSelected={compareOutput}
                onValueChange={(isSelected) => {
                  setCompareOutput(isSelected)
                  localStorage.setItem(
                    constants.compareOutput,
                    String(isSelected),
                  )
                }}
                aria-label={t('preview.compare')}
              >
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {t('preview.compare')}
                </span>
              </Switch>
            ) : null}
            {hasTransformPreview && !isProcessCompleted && !isEditing ? (
              <Switch
                size="xs"
                isSelected={!showOriginal}
                onValueChange={(isSelected) => {
                  setShowOriginal(!isSelected)
                  localStorage.setItem(constants.showEdits, String(isSelected))
                }}
                aria-label={t('preview.showEdits')}
              >
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {t('preview.showEdits')}
                </span>
              </Switch>
            ) : null}
            {/* Not when customizing a media of a batch, which has its own "Add more" card */}
            {media.length === 1 && !isProcessCompleted && !isEditing ? (
              <Tooltip
                content={t('batch.addMoreMedia')}
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
            ) : null}
            {headerEnd}
          </div>
        </div>
      ) : null}

      {mediaFile ? (
        canCompare && compareOutput ? (
          <MediaOutputCompareSlider mediaIndex={mediaIndex} />
        ) : (
          <MediaThumbnail
            mediaIndex={mediaIndex}
            showOriginal={hasTransformPreview && showOriginal}
          />
        )
      ) : null}

      {!(isMediaTransformEditMode || isMediaTrimEditMode) ? (
        isProcessCompleted ? (
          <section className="animate-appearance-in">
            <div className="flex justify-center items-center mt-2">
              <p className="text-2xl font-bold mx-4">{mediaSize}</p>
              <motion.div
                initial={isSmaller ? { opacity: 0, x: -12 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <Icon
                  name="curvedArrow"
                  className="text-black dark:text-white rotate-[-65deg] translate-y-[-8px]"
                  size={100}
                />
              </motion.div>
              <p className="text-3xl  font-bold mx-4 text-primary">
                {/* A smaller output shrinks from the original's size to its own, & lands with a hit */}
                <ImpactPop
                  trigger={compressedFile?.sizeInBytes}
                  delay={RESULT_COUNT_SECONDS}
                  isDisabled={!isSmaller}
                >
                  <AnimatedNumber
                    value={compressedFile?.sizeInBytes ?? 0}
                    from={sizeInBytes ?? 0}
                    format={formatBytes}
                    duration={RESULT_COUNT_SECONDS}
                    isStatic={!isSmaller}
                  />
                </ImpactPop>
              </p>
            </div>
            {isSmaller ? (
              <p className="block text-5xl text-center text-primary">
                <AnimatedNumber
                  value={compressedSizeDiff}
                  from={0}
                  format={formatPercentage}
                  duration={RESULT_COUNT_SECONDS}
                />
                %
                <motion.span
                  className="text-large block"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.2,
                    delay: RESULT_COUNT_SECONDS * 0.75,
                    ease: 'easeOut',
                  }}
                >
                  {t('preview.smaller')}
                </motion.span>
              </p>
            ) : null}
            <OutputOptions mediaIndex={mediaIndex} />
          </section>
        ) : (
          <section className={cn(['my-4 mb-2', styles.videoMetadata])}>
            <>
              <div>
                <p className=" text-gray-600 dark:text-gray-400">
                  {t('preview.size')}
                </p>
                <span className="block font-black">{mediaSize}</span>
              </div>
              <Divider orientation="vertical" className="h-8" />
            </>
            <>
              <div>
                <p className=" text-gray-600 dark:text-gray-400">
                  {t('batch.extension')}
                </p>
                <span className="block font-black">
                  {mediaExtension ?? '-'}
                </span>
              </div>
              <Divider orientation="vertical" className="h-8" />
            </>

            {videoDuration ? (
              <>
                <div>
                  <p className=" text-gray-600 dark:text-gray-400">
                    {t('batch.duration')}
                  </p>
                  <span className="block font-black">
                    {formatDuration(videoDuration) ?? '-'}
                  </span>
                </div>
                <Divider orientation="vertical" className="h-8" />{' '}
              </>
            ) : null}
            <>
              {dimensions ? (
                <>
                  <div>
                    <p className=" text-gray-600 dark:text-gray-400">
                      {t('batch.dimensions')}
                    </p>
                    <span className="block font-black">
                      {dimensions.width ?? '-'} x {dimensions.height ?? '-'}
                    </span>
                  </div>
                  <Divider orientation="vertical" className="h-8" />{' '}
                </>
              ) : null}
            </>
            <>
              {fps ? (
                <>
                  <div>
                    <p className=" text-gray-600 dark:text-gray-400">
                      {t('preview.fps')}
                    </p>
                    <span className="block font-black">{fps ?? '-'}</span>
                  </div>
                  <Divider orientation="vertical" className="h-8" />{' '}
                </>
              ) : null}
            </>
            <>
              <div>
                <Button
                  onPress={() => {
                    appProxy.state.showMediaInfo = true
                  }}
                  size="sm"
                >
                  {t('preview.viewFullInfo')}
                </Button>
              </div>
            </>
          </section>
        )
      ) : null}
      {showMediaInfo ? (
        <motion.div
          data-tint-overlay=""
          className="absolute right-0 bottom-0 left-0 top-0 w-full h-full z-[10] bg-white1 dark:bg-black1 p-6 rounded-xl"
          {...slideUpTransition}
        >
          <div className="2xl:max-w-[50vw] mx-auto">
            {mediaFile?.type === 'video' ? (
              <VideoInfo
                mediaIndex={mediaIndex}
                onClose={() => {
                  appProxy.state.showMediaInfo = false
                }}
              />
            ) : mediaFile?.type === 'image' ? (
              <ImageInfo
                mediaIndex={mediaIndex}
                onClose={() => {
                  appProxy.state.showMediaInfo = false
                }}
              />
            ) : null}
          </div>
          <div className="absolute top-4 right-4">
            <Button
              size="sm"
              isIconOnly
              radius="full"
              onPress={() => {
                appProxy.state.showMediaInfo = false
              }}
            >
              <Icon name="cross" />
            </Button>
          </div>
        </motion.div>
      ) : null}
    </motion.div>
  ) : (
    <motion.div
      className="relative w-full h-full flex flex-col justify-center items-center flex-shrink-0"
      initial={{ scale: 0.9 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', duration: 0.6 }}
    >
      <div className="relative">
        <div className="block xl:hidden">
          <Ripple
            mainCircleOpacity={0.18}
            mainCircleSize={300}
            className="absolute top-1/2 left-1/2 translate-x-[-50%] translate-y-[-50%]"
          />
        </div>
        <div className="hidden xl:block">
          <Ripple
            mainCircleOpacity={0.2}
            mainCircleSize={380}
            className="absolute top-1/2 left-1/2 translate-x-[-50%] translate-y-[-50%]"
          />
        </div>
        <CircularProgress
          {...(videoDuration == null
            ? { isIndeterminate: true }
            : { value: compressionProgress })}
          classNames={{
            base: 'absolute top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]',
            svg: 'w-[480px] h-[480px] hlg:w-[540px] hlg:h-[540px] drop-shadow-md',
            indicator: 'stroke-primary stroke-1',
            track: 'stroke-transparent stroke-1',
            value: 'text-3xl font-semibold text-primary',
          }}
          strokeWidth={2}
          aria-label={t('preview.progress', {
            value: compressionProgress?.toFixed(0) ?? 0,
          })}
        />
        <Image
          alt={t('preview.mediaToCompress')}
          src={thumbnailPath as string}
          className="z-0 w-[400px] h-[400px] min-w-[400px] min-h-[400px] hlg:w-[450px] hlg:h-[450px] hlg:min-w-[450px] hlg:min-h-[450px] object-cover rounded-full flex-shrink-0"
        />
        <div className="flex flex-col justify-center absolute top-1/2 left-1/2  translate-x-[-50%] translate-y-[-50%] z-[11] text-white1">
          <p className=" text-sm mt-10 text-center animate-pulse">
            {isWaitingForDropZone
              ? t('preview.waitingForDropZone')
              : isEstimatingSize
                ? t('preview.estimatingSize')
                : t('preview.processing')}
          </p>
          <p
            className={`text-2xl text-center font-bold my-2 opacity-${
              compressionProgress && compressionProgress > 0 ? 1 : 0
            }`}
          >
            {compressionProgress?.toFixed(2)}%
          </p>
          {/* Its estimated size (compressing to a target size), faded in once known; its line is
              kept so the text above does not move */}
          <div className="h-5">
            <AnimatePresence>
              {estimatedOutputSize && !isEstimatingSize ? (
                <motion.p
                  className="text-center text-sm text-white/80"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                >
                  {t(
                    estimatedOutputSize.isUpTo
                      ? 'preview.estimatedSizeUpTo'
                      : 'preview.estimatedSize',
                    { size: formatBytes(estimatedOutputSize.sizeInBytes) },
                  )}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
        <div className="bg-black/60 z-[10] absolute top-0 right-0 bottom-0 left-0 rounded-full" />
      </div>
    </motion.div>
  )
}

export default React.memo(PreviewSingleMedia)
