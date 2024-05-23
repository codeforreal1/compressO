'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { core } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import { useAtom } from 'jotai'
import { useResetAtom } from 'jotai/utils'

import Button from '@/components/Button'
import Image from '@/components/Image'
import VideoPicker from '@/tauri/components/VideoPicker'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import { formatBytes } from '@/utils/fs'
import {
  generateVideoThumbnail,
  getVideoDuration,
} from '@/tauri/commands/ffmpeg'
import { getFileMetadata } from '@/tauri/commands/fs'
import { extensions } from '@/types/compression'
import Tooltip from '@/components/Tooltip'
import { convertDurationToMilliseconds } from '@/utils/string'
import Drawer from '@/components/Drawer'
import Setting from './ui/Setting'
import DragAndDrop from './ui/DragAndDrop'
import { videoAtom } from './state'
import VideoConfig from './ui/VideoConfig'

function Root() {
  const [video, setVideo] = useAtom(videoAtom)
  const resetVideo = useResetAtom(videoAtom)

  const { isCompressing } = video

  const handleVideoSelected = React.useCallback(
    async (path: string) => {
      if (isCompressing) return
      try {
        if (!path) {
          toast.error('Invalid file selected.')
          return
        }
        const fileMetadata = await getFileMetadata(path)

        if (
          !fileMetadata ||
          (typeof fileMetadata?.size === 'number' && fileMetadata?.size <= 1000)
        ) {
          toast.error('Invalid file.')
          return
        }

        setVideo((state) => ({
          ...state,
          isFileSelected: true,
          pathRaw: path,
          path: core.convertFileSrc(path),
          fileName: fileMetadata?.fileName,
          mimeType: fileMetadata?.mimeType,
          sizeInBytes: fileMetadata?.size,
          size: formatBytes(fileMetadata?.size ?? 0),
          isThumbnailGenerating: true,
          extension: fileMetadata?.extension,
          ...(fileMetadata?.extension
            ? {
                config: {
                  ...state.config,
                  convertToExtension:
                    fileMetadata?.extension as keyof (typeof extensions)['video'],
                },
              }
            : {}),
        }))

        const thumbnail = await generateVideoThumbnail(path)

        setVideo((previousState) => ({
          ...previousState,
          isThumbnailGenerating: false,
        }))
        if (thumbnail) {
          setVideo((previousState) => ({
            ...previousState,
            id: thumbnail?.id,
            thumbnailPathRaw: thumbnail?.filePath,
            thumbnailPath: core.convertFileSrc(thumbnail?.filePath),
          }))
        }
        const duration = await getVideoDuration(path)
        const durationInMilliseconds = convertDurationToMilliseconds(
          duration as string,
        )
        if (durationInMilliseconds > 0) {
          setVideo((state) => ({
            ...state,
            videDurationRaw: duration,
            videoDurationMilliseconds: durationInMilliseconds,
          }))
        }
      } catch (error) {
        resetVideo()
        toast.error('File seems to be corrupted.')
      }
    },
    [isCompressing, resetVideo, setVideo],
  )

  return (
    <section className="w-full h-full relative">
      <div className="absolute top-4 left-4 flex justify-center items-center">
        <Image src="/logo.png" alt="logo" width={40} height={40} />
      </div>
      {!video?.isFileSelected ? (
        <Drawer
          renderTriggerer={({ open: openDrawer }) => (
            <div className="absolute bottom-4 left-4 p-0 z-[1]">
              <Tooltip
                content="Open Settings"
                aria-label="Open Settings"
                placement="right"
              >
                <Button onClick={openDrawer} isIconOnly size="sm">
                  <Icon name="setting" size={23} />
                </Button>
              </Tooltip>
            </div>
          )}
        >
          <Setting />
        </Drawer>
      ) : null}
      {video?.isFileSelected ? (
        <VideoConfig />
      ) : (
        <VideoPicker onSuccess={({ file }) => handleVideoSelected(file?.path)}>
          {({ onClick }) => (
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
              onClick={onClick}
              onKeyDown={(evt) => {
                if (evt?.key === 'Enter') {
                  onClick()
                }
              }}
            >
              <div className="flex flex-col justify-center items-center py-16 px-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl">
                <Icon name="videoFile" className="text-primary" size={60} />
                <p className="italic text-sm mt-4 text-gray-600 dark:text-gray-400 text-center">
                  Drag & Drop
                  <span className="block">Or</span>
                  Click anywhere to select a video
                </p>
              </div>
            </motion.div>
          )}
        </VideoPicker>
      )}
      <DragAndDrop
        disable={video?.isFileSelected}
        onFile={handleVideoSelected}
      />
    </section>
  )
}

export default dynamic(() => Promise.resolve(Root), { ssr: false })
