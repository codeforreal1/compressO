'use client'

import { SelectItem } from '@heroui/select'
import { core } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Divider from '@/components/Divider'
import Icon from '@/components/Icon'
import Layout from '@/components/Layout'
import Select from '@/components/Select'
import Spinner from '@/components/Spinner'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import { compressVideo } from '@/tauri/commands/ffmpeg'
import { getFileMetadata } from '@/tauri/commands/fs'
import { extensions } from '@/types/compression'
import { zoomInTransition } from '@/utils/animation'
import { formatBytes } from '@/utils/fs'
import { cn } from '@/utils/tailwind'
import { videoProxy } from '../-state'
import CancelCompression from './CancelCompression'
import Compressing from './Compressing'
import CompressionPreset from './CompressionPreset'
import CompressionQuality from './CompressionQuality'
import FileName from './FileName'
import SaveVideo from './SaveVideo'
import Success from './Success'
import TransformVideo from './TransformVideo'
import VideoDimensions from './VideoDimensions'
import VideoFPS from './VideoFPS'
import VideoThumbnail from './VideoThumbnail'
import styles from './styles.module.css'

const videoExtensions = Object.keys(extensions?.video)

function VideoConfig() {
  const {
    state: {
      isCompressing,
      config,
      id: videoId,
      isThumbnailGenerating,
      fileName,
      isCompressionSuccessful,
      size: videoSize,
      videDurationRaw,
      extension: videoExtension,
      dimensions,
      fps,
    },
  } = useSnapshot(videoProxy)

  const {
    convertToExtension,
    presetName,
    shouldMuteVideo,
    shouldEnableCustomDimensions,
    customDimensions,
    shouldEnableCustomFPS,
    customFPS,
  } = config

  const handleCompression = async () => {
    const videoSnapshot = snapshot(videoProxy)
    if (videoSnapshot.state.isCompressing) return
    try {
      videoProxy.takeSnapshot('beforeCompressionStarted')
      videoProxy.state.isCompressing = true

      const result = await compressVideo({
        videoPath: videoSnapshot.state.pathRaw as string,
        convertToExtension:
          videoSnapshot.state?.config?.convertToExtension ?? 'mp4',
        presetName: !videoSnapshot?.state?.config?.shouldDisableCompression
          ? presetName
          : null,
        videoId,
        shouldMuteVideo,
        ...(videoSnapshot?.state?.config?.shouldEnableQuality
          ? { quality: videoSnapshot.state?.config?.quality as number }
          : {}),
        ...(shouldEnableCustomDimensions
          ? { dimensions: customDimensions }
          : {}),
        ...(shouldEnableCustomFPS ? { fps: customFPS?.toString?.() } : {}),
      })
      if (!result) {
        throw new Error()
      }
      const compressedVideoMetadata = await getFileMetadata(result?.filePath)
      if (!compressedVideoMetadata) {
        throw new Error()
      }
      videoProxy.state.isCompressing = false
      videoProxy.state.isCompressionSuccessful = true

      const videoSnapshot2 = snapshot(videoProxy.state)
      videoProxy.state.compressedVideo = {
        fileName: compressedVideoMetadata?.fileName,
        fileNameToDisplay: `${videoSnapshot2?.fileName?.slice(
          0,
          -((videoSnapshot2?.extension?.length ?? 0) + 1),
        )}.${compressedVideoMetadata?.extension}`,
        pathRaw: compressedVideoMetadata?.path,
        path: core.convertFileSrc(compressedVideoMetadata?.path ?? ''),
        mimeType: compressedVideoMetadata?.mimeType,
        sizeInBytes: compressedVideoMetadata?.size,
        size: formatBytes(compressedVideoMetadata?.size ?? 0),
        extension: compressedVideoMetadata?.extension,
      }
    } catch (error) {
      if (error !== 'CANCELLED') {
        toast.error('Something went wrong during compression.')
        videoProxy.state.isCompressing = false
        videoProxy.state.isCompressionSuccessful = false
      }
    }
  }

  return (
    <Layout
      childrenProps={{
        className: cn(isThumbnailGenerating ? 'm-auto' : 'h-full'),
      }}
      hideLogo
    >
      {!isThumbnailGenerating ? (
        <div className={cn(['h-full p-6', styles.videoConfigContainer])}>
          <AnimatePresence>
            <section className="px-4 py-6 hlg:py-10 flex flex-col justify-center items-center rounded-xl border-2 border-zinc-200 dark:border-zinc-800">
              {fileName && !isCompressing ? <FileName /> : null}
              {isCompressing ? (
                <Compressing />
              ) : isCompressionSuccessful ? (
                <>
                  <VideoThumbnail />
                  <Success />
                </>
              ) : (
                <motion.div
                  className="flex flex-col justify-center items-center"
                  {...zoomInTransition}
                >
                  <VideoThumbnail />
                  <section className={cn(['my-4', styles.videoMetadata])}>
                    <>
                      <div>
                        <p className="italic text-gray-600 dark:text-gray-400">
                          Size
                        </p>
                        <span className="block font-black">{videoSize}</span>
                      </div>
                      <Divider orientation="vertical" className="h-10" />
                    </>
                    <>
                      <div>
                        <p className="italic text-gray-600 dark:text-gray-400">
                          Extension
                        </p>
                        <span className="block font-black">
                          {videoExtension ?? '-'}
                        </span>
                      </div>
                      <Divider orientation="vertical" className="h-10" />
                    </>

                    <>
                      <div>
                        <p className="italic text-gray-600 dark:text-gray-400">
                          Duration
                        </p>
                        <span className="block font-black">
                          {videDurationRaw ?? '-'}
                        </span>
                      </div>
                    </>
                    <>
                      {dimensions ? (
                        <>
                          <Divider orientation="vertical" className="h-10" />{' '}
                          <div>
                            <p className="italic text-gray-600 dark:text-gray-400">
                              Dimensions
                            </p>
                            <span className="block font-black">
                              {dimensions.width ?? '-'} x{' '}
                              {dimensions.height ?? '-'}
                            </span>
                          </div>
                        </>
                      ) : null}
                    </>
                    <>
                      {fps ? (
                        <>
                          <Divider orientation="vertical" className="h-10" />{' '}
                          <div>
                            <p className="italic text-gray-600 dark:text-gray-400">
                              FPS
                            </p>
                            <span className="block font-black">
                              {fps ?? '-'}
                            </span>
                          </div>
                        </>
                      ) : null}
                    </>
                  </section>
                </motion.div>
              )}
            </section>
          </AnimatePresence>
          <section
            className="px-4 py-6 hlg:py-10 rounded-xl border-2 border-zinc-200 dark:border-zinc-800"
            {...zoomInTransition}
          >
            <p className="text-xl mb-6 font-bold">Output Settings</p>
            <>
              <CompressionPreset />
              <Divider className="my-3" />
            </>
            <>
              <div className="flex items-center my-2">
                <Switch
                  isSelected={shouldMuteVideo}
                  onValueChange={() => {
                    videoProxy.state.config.shouldMuteVideo = !shouldMuteVideo
                  }}
                  className="flex justify-center items-center"
                  isDisabled={isCompressing}
                >
                  <div className="flex justify-center items-center">
                    <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                      Mute Audio
                    </span>
                  </div>
                </Switch>
              </div>
              <Divider className="my-3" />
            </>

            <>
              <CompressionQuality />
              <Divider className="my-3" />
            </>
            {dimensions ? (
              <>
                <VideoDimensions />
                <Divider className="my-3" />
                <TransformVideo />
                <Divider className="my-3" />
              </>
            ) : null}
            {fps ? (
              <>
                <VideoFPS />
                <Divider className="my-3" />
              </>
            ) : null}
            <>
              <div className="mt-8">
                <Select
                  fullWidth
                  label="Extension:"
                  className="block flex-shrink-0 rounded-2xl"
                  size="sm"
                  value={convertToExtension}
                  selectedKeys={[convertToExtension]}
                  onChange={(evt) => {
                    const value = evt?.target
                      ?.value as keyof typeof extensions.video
                    if (value?.length > 0) {
                      videoProxy.state.config.convertToExtension = value
                    }
                  }}
                  selectionMode="single"
                  isDisabled={isCompressing}
                  classNames={{
                    label: '!text-gray-600 dark:!text-gray-400 text-sm',
                  }}
                >
                  {videoExtensions?.map((ext) => (
                    <SelectItem
                      key={ext}
                      value={ext}
                      className="flex justify-center items-center"
                    >
                      {ext}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </>
            <div className="mt-4">
              {isCompressing ? (
                <CancelCompression />
              ) : isCompressionSuccessful ? (
                <SaveVideo />
              ) : (
                <Button
                  as={motion.button}
                  color="primary"
                  onPress={handleCompression}
                  fullWidth
                  className="text-primary"
                >
                  Compress <Icon name="logo" size={25} />
                </Button>
              )}
            </div>
          </section>
        </div>
      ) : (
        <Spinner size="lg" />
      )}
    </Layout>
  )
}

export default React.memo(VideoConfig)
