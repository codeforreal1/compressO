import { createFileRoute } from '@tanstack/react-router'
import { core } from '@tauri-apps/api'
import { open } from '@tauri-apps/plugin-dialog'
import { motion } from 'framer-motion'
import cloneDeep from 'lodash/cloneDeep'
import React, { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Layout from '@/components/Layout'
import Spinner from '@/components/Spinner'
import { toast } from '@/components/Toast'
import { generateVideoThumbnail } from '@/tauri/commands/ffmpeg'
import { getVideoBasicInfo } from '@/tauri/commands/ffprobe'
import {
  getFileMetadata,
  getImageDimension,
  getSvgDimension,
} from '@/tauri/commands/fs'
import { convertSvgToPng } from '@/tauri/commands/image'
import { extensions } from '@/types/compression'
import { formatBytes } from '@/utils/fs'
import {
  appProxy,
  imageConfigInitialState,
  videoConfigInitialState,
} from './-state'
import Setting from './ui/app-settings/Setting'
import DragAndDropFiles from './ui/DragAndDropFiles'
import MediaConfig from './ui/MediaConfig'
import OpenWithApp from './ui/OpenWithApp'
import ReadFilesFromClipboard from './ui/ReadFilesFromClipboard'
import { Image, Video } from '../../types/app'

export const Route = createFileRoute('/(root)/')({
  component: Root,
})

async function getSvgDimensionSilently(
  path: string,
): Promise<[number, number] | null> {
  try {
    const dimension = await getSvgDimension(path)
    return dimension
  } catch {
    return null
  }
}

function Root() {
  const { state, resetProxy } = useSnapshot(appProxy)

  const { media, isLoadingMediaFiles, totalSelectedMediaCount } = state

  const handleMediaSelection = React.useCallback(
    async (path: string | string[]) => {
      if (appProxy.state.isCompressing) return

      const videoExtensions = Object.keys(extensions.video)
      const imageExtensions = Object.keys(extensions.image)

      const rawPaths = Array.isArray(path) ? path : [path]
      const mediaPaths = rawPaths.filter((filePath) => {
        const ext = filePath.split('.').pop()?.toLowerCase()
        return (
          ext &&
          (videoExtensions.includes(ext) || imageExtensions.includes(ext))
        )
      })

      if (mediaPaths.length === 0) {
        toast.error('未找到有效的媒体文件。')
        return
      }

      appProxy.state.isLoadingMediaFiles = true
      appProxy.state.totalSelectedMediaCount = mediaPaths.length

      let corruptedFilesCount = 0
      for (const index in mediaPaths) {
        const path = mediaPaths[index]
        try {
          const fileMetadata = await getFileMetadata(path)
          const mediaType = fileMetadata.mimeType.startsWith('video')
            ? 'video'
            : 'image'

          if (
            !fileMetadata ||
            (typeof fileMetadata?.size === 'number' && mediaType === 'video'
              ? fileMetadata?.size <= 1000
              : fileMetadata?.size < 100)
          ) {
            corruptedFilesCount++
            continue
          }

          if (mediaType === 'video') {
            const [videoInfo, videoThumbnail] = await Promise.all([
              getVideoBasicInfo(path),
              generateVideoThumbnail(path),
            ])

            const videoState: Video & { type: 'video' } = {
              type: 'video',
              id: videoThumbnail?.id ?? `${index}-${+new Date()}`,
              pathRaw: path,
              path: core.convertFileSrc(path),
              fileName: fileMetadata?.fileName,
              mimeType: fileMetadata?.mimeType,
              sizeInBytes: fileMetadata?.size,
              size: formatBytes(fileMetadata?.size ?? 0),
              extension: fileMetadata?.extension?.toLowerCase?.(),
              config: cloneDeep(videoConfigInitialState),
              previewMode: 'video',
            }

            if (fileMetadata?.extension) {
              videoState.config.convertToExtension =
                fileMetadata?.extension as keyof (typeof extensions)['video']
            }

            if (videoInfo) {
              const dimensions = videoInfo.dimensions
              if (
                !Number.isNaN(videoInfo.dimensions?.[0]) &&
                !Number.isNaN(videoInfo.dimensions?.[1])
              ) {
                videoState.dimensions = {
                  width: dimensions[0],
                  height: dimensions[1],
                }
              }

              if (videoInfo.duration) {
                videoState.videoDuration = videoInfo.duration
              }

              if (videoInfo.fps) {
                videoState.fps = Math.ceil(videoInfo.fps)
              }
            }

            if (videoThumbnail) {
              videoState.id = videoThumbnail?.id
              videoState.thumbnailPathRaw = videoThumbnail?.filePath
              videoState.thumbnailPath = core.convertFileSrc(
                videoThumbnail?.filePath,
              )
            }
            appProxy.state.media.push(videoState)
          } else if (mediaType === 'image') {
            const imageDimension = await (path.endsWith('.svg')
              ? getSvgDimensionSilently(path)
              : getImageDimension(path))
            const imageState: Image & { type: 'image' } = {
              type: 'image',
              id: `${index}-${+new Date()}`,
              pathRaw: path,
              path: core.convertFileSrc(path),
              thumbnailPathRaw: path,
              thumbnailPath: core.convertFileSrc(path),
              fileName: fileMetadata?.fileName,
              mimeType: fileMetadata?.mimeType,
              sizeInBytes: fileMetadata?.size,
              size: formatBytes(fileMetadata?.size ?? 0),
              extension: fileMetadata?.extension?.toLowerCase?.(),
              config: cloneDeep(imageConfigInitialState),
              dimensions: {
                width: imageDimension?.[0] ?? 0,
                height: imageDimension?.[1] ?? 0,
              },
            }

            // create a static image thumbnail for gif due to performance reason
            if (path.endsWith('.gif')) {
              try {
                const gifThumbnail = await generateVideoThumbnail(path)
                imageState.thumbnailPathRaw = gifThumbnail.filePath
                imageState.thumbnailPath = core.convertFileSrc(
                  gifThumbnail.filePath,
                )
              } catch {}
            }

            // create a static image thumbnail for large svg due to performance reason
            if (
              path.endsWith('.svg') &&
              fileMetadata?.size >= 0.5 * 1024 * 1024
            ) {
              try {
                const outputPngPath = await convertSvgToPng(
                  path,
                  imageState.id!,
                )
                imageState.thumbnailPathRaw = outputPngPath
                imageState.thumbnailPath = core.convertFileSrc(outputPngPath)
              } catch {}
            }
            appProxy.state.media.push(imageState)
          } else {
            throw new Error('Invalid media type.')
          }
        } catch {
          corruptedFilesCount++
        }
      }
      appProxy.state.isLoadingMediaFiles = false
      if (corruptedFilesCount > 0) {
        toast.error(
          mediaPaths.length > 1
            ? '部分文件似乎已损坏或无效，已将其过滤。'
            : '文件似乎已损坏或无效。',
        )
        if (corruptedFilesCount === mediaPaths.length) {
          resetProxy()
        }
      }
    },
    [resetProxy],
  )

  const pickMediaToCompress = useCallback(async () => {
    try {
      const filePath = await open({
        directory: false,
        multiple: true,
        title: '选择要压缩的图片或视频。',
        filters: [
          { name: 'video', extensions: Object.keys(extensions?.video) },
          { name: 'image', extensions: Object.keys(extensions?.image) },
        ],
      })
      if (filePath == null) {
        const message = 'File selection config is invalid.'
        // biome-ignore lint/suspicious/noConsole: <>
        console.warn(message)
        return
      }
      handleMediaSelection(filePath)
    } catch (error: any) {
      toast.error(error?.message ?? '无法选择媒体文件。')
    }
  }, [handleMediaSelection])

  return isLoadingMediaFiles ? (
    !media.length || (totalSelectedMediaCount > 1 && media.length === 1) ? (
      <div className="w-full h-full flex justify-center items-center">
        <Spinner />
      </div>
    ) : (
      <MediaConfig />
    )
  ) : media.length ? (
    <MediaConfig />
  ) : (
    <Layout
      containerProps={{ className: 'relative' }}
      childrenProps={{ className: 'm-auto' }}
    >
      <motion.div
        role="button"
        tabIndex={0}
        className="h-full w-full flex flex-col justify-center items-center z-0"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{
          scale: 1,
          opacity: 1,
          transition: {
            duration: 0.6,
            bounce: 0.3,
            type: 'spring',
          },
        }}
        onClick={pickMediaToCompress}
        onKeyDown={(evt) => {
          if (evt?.key === 'Enter') {
            pickMediaToCompress()
          }
        }}
      >
        <div className="flex flex-col justify-center items-center py-16 px-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
          <Icon name="addMedia" className="text-primary" size={60} />
          <p className="text-sm mt-4 text-gray-600 dark:text-gray-400 text-center">
            拖放文件
            <span className="block text-xs">或</span>
            点击选择媒体文件
          </p>
        </div>
      </motion.div>
      <DragAndDropFiles
        multiple
        disable={media.length > 0}
        onFile={handleMediaSelection}
      />
      <OpenWithApp onFiles={handleMediaSelection} />
      <ReadFilesFromClipboard onFiles={handleMediaSelection} />
      <Setting />
    </Layout>
  )
}

export default Root
