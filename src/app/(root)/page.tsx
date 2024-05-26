'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { core } from '@tauri-apps/api'
import { motion } from 'framer-motion'
import { useSnapshot } from 'valtio'

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
import { convertDurationToMilliseconds } from '@/utils/string'
import Layout from '@/components/Layout'
import Setting from './ui/Setting'
import DragAndDrop from './ui/DragAndDrop'
import { videoProxy } from './state'
import VideoConfig from './ui/VideoConfig'

function Root() {
  const { state, resetProxy } = useSnapshot(videoProxy)

  const { isFileSelected, isCompressing } = state

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
        videoProxy.state.isFileSelected = true
        videoProxy.state.pathRaw = path
        videoProxy.state.path = core.convertFileSrc(path)
        videoProxy.state.fileName = fileMetadata?.fileName
        videoProxy.state.mimeType = fileMetadata?.mimeType
        videoProxy.state.sizeInBytes = fileMetadata?.size
        videoProxy.state.size = formatBytes(fileMetadata?.size ?? 0)
        videoProxy.state.isThumbnailGenerating = true
        videoProxy.state.extension = fileMetadata?.extension

        if (fileMetadata?.extension) {
          videoProxy.state.config.convertToExtension =
            fileMetadata?.extension as keyof (typeof extensions)['video']
        }

        const thumbnail = await generateVideoThumbnail(path)

        videoProxy.state.isThumbnailGenerating = false
        if (thumbnail) {
          videoProxy.state.id = thumbnail?.id
          videoProxy.state.thumbnailPathRaw = thumbnail?.filePath
          videoProxy.state.thumbnailPath = core.convertFileSrc(
            thumbnail?.filePath,
          )
        }

        const duration = await getVideoDuration(path)
        const durationInMilliseconds = convertDurationToMilliseconds(
          duration as string,
        )
        if (durationInMilliseconds > 0) {
          videoProxy.state.videDurationRaw = duration
          videoProxy.state.videoDurationMilliseconds = durationInMilliseconds
        }
      } catch (error) {
        resetProxy()
        toast.error('File seems to be corrupted.')
      }
    },
    [isCompressing, resetProxy],
  )

  return isFileSelected ? (
    <VideoConfig />
  ) : (
    <Layout
      containerProps={{ className: 'relative' }}
      childrenProps={{ className: 'm-auto' }}
    >
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
      <DragAndDrop disable={isFileSelected} onFile={handleVideoSelected} />
      <Setting />
    </Layout>
  )
}

export default dynamic(() => Promise.resolve(Root), { ssr: false })
