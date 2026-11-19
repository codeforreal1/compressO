import { core } from '@tauri-apps/api'
import merge from 'lodash/merge'
import { memo, useCallback, useId } from 'react'
import { ReactCompareSliderHandle } from 'react-compare-slider'
import { useTranslation } from 'react-i18next'
import { PhotoView } from 'react-photo-view'
import { useSnapshot } from 'valtio'

import CompareSlider from '@/components/CompareSlider'
import Icon from '@/components/Icon'
import ImageViewer from '@/components/ImageViewer'
import Tooltip from '@/components/Tooltip'
import VideoPlayer from '@/components/VideoPlayer'
import { useImagePreview } from '@/hooks/useImagePreview'
import { needsImagePreview } from '@/tauri/commands/image'
import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'
import { appProxy } from '../-state'

type MediaOutputCompareSliderProps = {
  mediaIndex: number
}

type renderImageDefaultType = {
  isOriginal?: boolean
  enableZoomViewer?: boolean
}

const renderImageDefaultOptions: renderImageDefaultType = {
  isOriginal: true,
  enableZoomViewer: true,
}

type renderVideoDefaultType = {
  isOriginal?: boolean
}

const renderVideoDefaultOptions: renderImageDefaultType = {
  isOriginal: true,
}

const SVG_MAX_RENDERING_SIZE_LIMIT = 5 * 1024 * 1024

const platform = getPlatform()

function MediaOutputCompareSlider({
  mediaIndex,
}: MediaOutputCompareSliderProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return

  const {
    state: { media },
  } = useSnapshot(appProxy)
  const mediaFile = media[mediaIndex]

  const outputPreview = useImagePreview(
    mediaFile?.type === 'image'
      ? (mediaFile.compressedFile?.savedPath ??
          mediaFile.compressedFile?.pathRaw)
      : undefined,
    mediaFile?.compressedFile,
    mediaFile?.thumbnailPath,
  )
  const id = useId()
  // The source dimensions can be unknown for unusual files; 16:9 keeps the preview in a sane box
  const videoWidth =
    mediaFile?.type === 'video' ? mediaFile.dimensions?.width : undefined
  const videoHeight =
    mediaFile?.type === 'video' ? mediaFile.dimensions?.height : undefined
  const videoAspectRatio =
    videoWidth && videoHeight ? videoWidth / videoHeight : 16 / 9

  const renderImage = useCallback(
    (src: string, options?: renderImageDefaultType) => {
      options = merge({}, renderImageDefaultOptions, options ?? {})
      return (
        <div
          className="relative w-full h-full bg-white1 dark:bg-black1"
          id={`image-comparison-${options?.isOriginal ? 0 : 1}`}
          key={`image-comparison-${options?.isOriginal ? 0 : 1}`}
        >
          <img
            src={src}
            alt={options?.isOriginal ? t('compare.input') : t('compare.output')}
            className="w-full h-full max-h-[60vh] object-contain"
          />
          {options?.enableZoomViewer ? (
            <div
              className={cn(
                'absolute bottom-4 bg-zinc-900/10 dark:bg-zinc-900/40 min-h-[25px] px-2 rounded-2xl flex items-center',
                options?.isOriginal ? 'left-4' : 'right-4',
              )}
            >
              <ImageViewer
                // @ts-ignore
                providerProps={
                  mediaFile?.isProcessCompleted &&
                  mediaFile?.config?.convertToExtension === 'svg'
                    ? { photoWrapClassName: 'bg-zinc-800' }
                    : {}
                }
              >
                <PhotoView src={src!}>
                  <div>
                    <Tooltip
                      content={
                        options?.isOriginal
                          ? t('compare.enlargeInput')
                          : t('compare.enlargeOutput')
                      }
                    >
                      <Icon name="zoom" size={18} className="cursor-pointer" />
                    </Tooltip>
                  </div>
                </PhotoView>
              </ImageViewer>
            </div>
          ) : null}
        </div>
      )
    },
    [mediaFile?.isProcessCompleted, mediaFile?.config?.convertToExtension, t],
  )

  const renderVideo = useCallback(
    (src: string, options?: renderVideoDefaultType) => {
      options = merge({}, renderVideoDefaultOptions, options ?? {})

      return (
        <div
          className="w-full h-full relative bg-white1 dark:bg-black1"
          id={`video-comparison-${options?.isOriginal ? 0 : 1}`}
          key={`video-comparison-${options?.isOriginal ? 0 : 1}`}
        >
          <VideoPlayer
            url={src}
            autoPlay
            loop
            controls={false}
            playPauseOnSpaceKeydown={false}
            disableClosedCaptions
            disablePlayPauseControlAtCenter
            disablePlayPauseViaContainerClick
            containerClassName="w-full h-full"
            mediaContainerClassName="mx-auto overflow-hidden"
            mediaContainerStyle={{
              width: `min(100%, calc(60vh * ${videoAspectRatio}))`,
              height: '60vh',
            }}
            style={{
              maxHeight: '60vh',
            }}
            config={{
              file: {
                attributes: {
                  // ReactPlayer replaces the video's default style with these attributes, so
                  // the size must be repeated alongside the fit.
                  style: {
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  },
                },
              },
            }}
            muted={options?.isOriginal}
          />
        </div>
      )
    },
    [videoAspectRatio],
  )

  // Saving moves the output out of the cache, so a saved output is loaded from where it was saved
  // (with its size, as another output of a target size can replace it there, see
  // `chooseOutputOption`)
  // Another output looked at while the saved one stays on disk (see `previewOutputOption`)
  const previewOption =
    mediaFile?.type === 'video' ? mediaFile.compressedFile?.previewOption : null
  const outputPath =
    outputPreview ??
    (previewOption ? core.convertFileSrc(previewOption.pathRaw) : null) ??
    (mediaFile?.compressedFile?.isSaved && mediaFile.compressedFile.savedPath
      ? `${core.convertFileSrc(mediaFile.compressedFile.savedPath)}?v=${mediaFile.compressedFile.sizeInBytes ?? 0}`
      : mediaFile?.compressedFile?.path)
  const imageOutputPath = outputPath
    ? `${outputPath}${outputPath.includes('?') ? '&' : '?'}id=${id}`
    : ''

  return (
    <div id={id} className="rounded-3xl overflow-hidden px-4">
      {mediaFile?.type === 'image' &&
      ((mediaFile?.compressedFile?.extension === 'svg' &&
        (mediaFile?.compressedFile?.sizeInBytes ?? 0) >=
          SVG_MAX_RENDERING_SIZE_LIMIT) ||
        (mediaFile?.extension === 'svg' &&
          (mediaFile?.sizeInBytes ?? 0) >= SVG_MAX_RENDERING_SIZE_LIMIT)) ? (
        <p className="text-xs mb-2 flex justify-center items-center gap-1 text-warning-400">
          <Icon name="warning" />
          {t('compare.svgTooLarge')}
        </p>
      ) : null}
      <div className="border-1 border-zinc-200 dark:border-zinc-900 overflow-hidden">
        <CompareSlider
          onlyHandleDraggable
          itemOne={
            mediaFile?.type === 'video'
              ? renderVideo(mediaFile?.path!)
              : renderImage(
                  mediaFile?.pathRaw &&
                    needsImagePreview(mediaFile.pathRaw) &&
                    mediaFile.thumbnailPathRaw
                    ? core.convertFileSrc(mediaFile.thumbnailPathRaw)
                    : mediaFile?.path!,
                )
          }
          itemTwo={
            mediaFile?.type === 'video'
              ? mediaFile?.compressedFile?.extension === 'gif'
                ? renderImage(`${outputPath!}?id={${id}}`, {
                    isOriginal: false,
                  })
                : renderVideo(
                    platform.isLinux
                      ? outputPath! // On Linux, video is played over tcp so we need to pass the exact url
                      : `${outputPath!}?id={${id}}`,
                    {
                      isOriginal: false,
                    },
                  )
              : renderImage(imageOutputPath, {
                  isOriginal: false,
                })
          }
          handle={<ReactCompareSliderHandle />}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}

export default memo(MediaOutputCompareSlider)
