'use client'

import React from 'react'
import { core } from '@tauri-apps/api'
import { SelectItem } from '@nextui-org/select'
import { AnimatePresence, motion } from 'framer-motion'
import { useSnapshot, snapshot } from 'valtio'

import Button from '@/components/Button'
import Select from '@/components/Select'
import Spinner from '@/components/Spinner'
import Divider from '@/components/Divider'
import Image from '@/components/Image'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import { formatBytes } from '@/utils/fs'
import { compressVideo } from '@/tauri/commands/ffmpeg'
import { getFileMetadata } from '@/tauri/commands/fs'
import { compressionPresets, extensions } from '@/types/compression'
import Tooltip from '@/components/Tooltip'
import Checkbox from '@/components/Checkbox'
import { cn } from '@/utils/tailwind'
import { zoomInTransition } from '@/utils/animation'
import Layout from '@/components/Layout'
import { videoProxy } from '../state'
import Compressing from './Compressing'
import FileName from './FileName'
import Success from './Success'
import CancelCompression from './CancelCompression'
import SaveVideo from './SaveVideo'
import CompressionQuality from './CompressionQuality'
import styles from './styles.module.css'

const videoExtensions = Object.keys(extensions?.video)
const presets = Object.keys(compressionPresets)

function VideoConfig() {
  const {
    state: {
      isCompressing,
      config,
      id: videoId,
      isThumbnailGenerating,
      fileName,
      thumbnailPath,
      isCompressionSuccessful,
      size: videoSize,
      videDurationRaw,
      extension: videoExtension,
    },
  } = useSnapshot(videoProxy)

  const {
    convertToExtension,
    presetName,
    shouldDisableCompression,
    shouldMuteVideo,
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

  const renderThumbnail = React.useMemo(
    () => (
      <Image
        alt="video to compress"
        src={thumbnailPath as string}
        className="max-w-[50vw] xxl:max-w-[60vw] max-h-[60vh] object-contain border-8 rounded-3xl border-primary"
      />
    ),
    [thumbnailPath],
  )

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
                  {renderThumbnail}
                  <Success />
                </>
              ) : (
                <motion.div
                  className="flex flex-col justify-center items-center"
                  {...zoomInTransition}
                >
                  {renderThumbnail}
                  <section className={cn(['my-4', styles.videoMetadata])}>
                    <div>
                      <p className="italic text-gray-600 dark:text-gray-400">
                        Size
                      </p>
                      <span className="block font-black">{videoSize}</span>
                    </div>
                    <Divider orientation="vertical" className="h-10" />
                    <div>
                      <p className="italic text-gray-600 dark:text-gray-400">
                        Extension
                      </p>
                      <span className="block font-black">
                        {videoExtension ?? '-'}
                      </span>
                    </div>
                    <Divider orientation="vertical" className="h-10" />{' '}
                    <div>
                      <p className="italic text-gray-600 dark:text-gray-400">
                        Duration
                      </p>
                      <span className="block font-black">
                        {videDurationRaw ?? '-'}
                      </span>
                    </div>
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
            <div className="flex items-center my-2">
              <Checkbox
                isSelected={shouldMuteVideo}
                onValueChange={() => {
                  videoProxy.state.config.shouldMuteVideo = !shouldMuteVideo
                }}
                className="flex justify-center items-center"
                isDisabled={isCompressing}
              >
                <div className="flex justify-center items-center">
                  <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                    Mute Video
                  </span>
                </div>
              </Checkbox>
            </div>
            <Divider className="my-3" />
            <div className="flex items-center mb-4 my-2">
              <Checkbox
                isSelected={shouldDisableCompression}
                onValueChange={() => {
                  videoProxy.state.config.shouldDisableCompression =
                    !shouldDisableCompression
                }}
                className="flex justify-center items-center"
                isDisabled={isCompressing}
              >
                <div className="flex justify-center items-center">
                  <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                    Disable Compression
                  </span>
                  <Tooltip
                    delay={0}
                    content={
                      <div className="max-w-[10rem] p-2">
                        <p>
                          You can disable the compression if you just want to
                          change the extension of the video.
                        </p>
                      </div>
                    }
                    aria-label="You can disable the compression if you just
                              want to change the extension of the video"
                    className="flex justify-center items-center"
                  >
                    <Icon name="question" className="block" />
                  </Tooltip>
                </div>
              </Checkbox>
            </div>
            <Divider className="my-3" />
            <Select
              fullWidth
              label="Compression preset:"
              className="block flex-shrink-0 rounded-2xl"
              size="sm"
              selectedKeys={[presetName]}
              onChange={(evt) => {
                const value = evt?.target
                  ?.value as keyof typeof compressionPresets
                if (value?.length > 0) {
                  videoProxy.state.config.presetName = value
                }
              }}
              selectionMode="single"
              isDisabled={shouldDisableCompression || isCompressing}
            >
              {presets?.map((preset) => (
                // Right now if we use SelectItem it breaks the code so opting for SelectItem from NextUI directly
                <SelectItem
                  key={preset}
                  value={preset}
                  className="flex justify-center items-center"
                  endContent={
                    preset === compressionPresets.ironclad ? (
                      <Tooltip content="Recommended" aria-label="Recommended">
                        <Icon
                          name="star"
                          className="inline-block ml-1 text-yellow-500"
                          size={15}
                        />
                      </Tooltip>
                    ) : null
                  }
                >
                  {preset}
                </SelectItem>
              ))}
            </Select>
            <Divider className="my-3" />
            <CompressionQuality />
            <Divider className="my-3" />
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

            <div className="mt-4">
              {isCompressing ? (
                <CancelCompression />
              ) : isCompressionSuccessful ? (
                <SaveVideo />
              ) : (
                <Button
                  as={motion.button}
                  color="primary"
                  onClick={handleCompression}
                  fullWidth
                  size="lg"
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
