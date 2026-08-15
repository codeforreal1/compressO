import { motion } from 'framer-motion'
import React, { useEffect, useMemo, useState } from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Code from '@/components/Code'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import { CircularProgress } from '@/components/Progress'
import Switch from '@/components/Switch'
import { Ripple } from '@/ui/Patterns/Ripple'
import { slideUpTransition, zoomInTransition } from '@/utils/animation'
import { formatDuration } from '@/utils/string'
import { cn } from '@/utils/tailwind'
import ImageInfo from './ImageInfo'
import MediaOutputCompareSlider from './MediaOutputCompareSlider'
import MediaThumbnail from './MediaThumbnail'
import styles from './styles.module.css'
import VideoInfo from './VideoInfo'
import { appProxy } from '../-state'

type PreviewSingleMediaProps = {
  mediaIndex: number
}

function PreviewSingleMedia({ mediaIndex }: PreviewSingleMediaProps) {
  if (mediaIndex < 0) return

  const {
    state: { media, isProcessCompleted, isCompressing, showMediaInfo },
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
  const { videoDuration, fps } =
    mediaFile?.type === 'video' ? (mediaFile ?? {}) : {}
  const { isVideoTransformEditMode, isVideoTrimEditMode } =
    mediaFile?.type === 'video' ? (mediaFile?.config ?? {}) : {}
  const { isImageTransformEditMode } =
    mediaFile?.type === 'image' ? (mediaFile?.config ?? {}) : {}

  const [compareOutput, setCompareOutput] = useState(true)

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

  useEffect(() => {
    if (isCompressing) {
      setCompareOutput(true)
    }
  }, [isCompressing])

  const singleFileNameDisplay =
    (isProcessCompleted
      ? mediaFile?.compressedFile?.fileNameToDisplay
      : mediaFile?.fileName) ?? ''

  const isMediaTransformEditMode =
    isVideoTransformEditMode || isImageTransformEditMode
  const isMediaTrimEditMode = isVideoTrimEditMode

  return !isCompressing ? (
    <motion.div
      className="w-full h-full flex flex-col justify-center"
      {...zoomInTransition}
    >
      {!(isMediaTransformEditMode || isMediaTrimEditMode) &&
      !isProcessCompleted ? (
        <Code
          size="sm"
          className="w-fit mx-auto mb-3 text-center rounded-xl px-4 text-xs"
        >
          {singleFileNameDisplay?.length > 50
            ? `${singleFileNameDisplay?.slice(0, 20)}...${singleFileNameDisplay?.slice(
                -10,
              )}`
            : singleFileNameDisplay}
        </Code>
      ) : null}

      {isProcessCompleted &&
      ((mediaFile?.type === 'video' && mediaFile?.previewMode === 'video') ||
        mediaFile?.type === 'image') ? (
        <div className="flex justify-center my-4">
          <Switch
            size="sm"
            isSelected={compareOutput}
            onValueChange={() => {
              setCompareOutput((s) => !s)
            }}
          >
            <div className="flex justify-center items-center">
              <span className="block mr-2 text-sm">对比</span>
              <Icon name="compare" />
            </div>
          </Switch>
        </div>
      ) : null}

      {mediaFile ? (
        isProcessCompleted &&
        compareOutput &&
        ((mediaFile?.type === 'video' && mediaFile?.previewMode === 'video') ||
          mediaFile?.type === 'image') ? (
          <MediaOutputCompareSlider mediaIndex={mediaIndex} />
        ) : (
          <MediaThumbnail mediaIndex={mediaIndex} />
        )
      ) : null}

      {!(isMediaTransformEditMode || isMediaTrimEditMode) ? (
        isProcessCompleted ? (
          <section className="animate-appearance-in">
            <div className="flex justify-center items-center mt-2">
              <p className="text-2xl font-bold mx-4">{mediaSize}</p>
              <Icon
                name="curvedArrow"
                className="text-black dark:text-white rotate-[-65deg] translate-y-[-8px]"
                size={100}
              />
              <p className="text-3xl  font-bold mx-4 text-primary">
                {compressedFile?.size}
              </p>
            </div>
            {!(compressedSizeDiff <= 0) ? (
              <p className="block text-5xl text-center text-green-500">
                {compressedSizeDiff.toFixed(2)?.endsWith('.00')
                  ? compressedSizeDiff.toFixed(2)?.slice(0, -3)
                  : compressedSizeDiff.toFixed(2)}
                %<span className="text-large block">更小</span>
              </p>
            ) : null}
          </section>
        ) : (
          <section className={cn(['my-4 mb-2', styles.videoMetadata])}>
            <>
              <div>
                <p className=" text-gray-600 dark:text-gray-400">大小</p>
                <span className="block font-black">{mediaSize}</span>
              </div>
              <Divider orientation="vertical" className="h-8" />
            </>
            <>
              <div>
                <p className=" text-gray-600 dark:text-gray-400">扩展名</p>
                <span className="block font-black">
                  {mediaExtension ?? '-'}
                </span>
              </div>
              <Divider orientation="vertical" className="h-8" />
            </>

            {videoDuration ? (
              <>
                <div>
                  <p className=" text-gray-600 dark:text-gray-400">时长</p>
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
                    <p className=" text-gray-600 dark:text-gray-400">尺寸</p>
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
                    <p className=" text-gray-600 dark:text-gray-400">帧率</p>
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
                  查看完整信息
                </Button>
              </div>
            </>
          </section>
        )
      ) : null}
      {showMediaInfo ? (
        <motion.div
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
          aria-label={`Progress-${compressionProgress}%`}
        />
        <Image
          alt="待压缩的视频"
          src={thumbnailPath as string}
          className="z-0 w-[400px] h-[400px] min-w-[400px] min-h-[400px] hlg:w-[450px] hlg:h-[450px] hlg:min-w-[450px] hlg:min-h-[450px] object-cover rounded-full flex-shrink-0"
        />
        <div className="flex flex-col justify-center absolute top-1/2 left-1/2  translate-x-[-50%] translate-y-[-50%] z-[11] text-white1">
          <p className=" text-sm mt-10 text-center animate-pulse">正在处理……</p>
          <p
            className={`text-2xl text-center font-bold my-2 opacity-${
              compressionProgress && compressionProgress > 0 ? 1 : 0
            }`}
          >
            {compressionProgress?.toFixed(2)}%
          </p>
        </div>
        <div className="bg-black/60 z-[10] absolute top-0 right-0 bottom-0 left-0 rounded-full" />
      </div>
    </motion.div>
  )
}

export default React.memo(PreviewSingleMedia)
