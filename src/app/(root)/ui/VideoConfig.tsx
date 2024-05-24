'use client'

import React from 'react'
import { core } from '@tauri-apps/api'
import { SelectItem } from '@nextui-org/select'
import { motion } from 'framer-motion'
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
import { videoProxy } from '../state'
import Compressing from './Compressing'
import FileName from './FileName'
import Success from './Success'

const videoExtensions = Object.keys(extensions?.video)
const presets = Object.keys(compressionPresets)

function VideoConfig() {
  const {
    state: {
      isCompressing,
      config,
      pathRaw,
      id: videoId,
      isThumbnailGenerating,
      fileName,
      thumbnailPath,
      isCompressionSuccessful,
      size: videoSize,
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
        videoPath: pathRaw as string,
        convertToExtension: convertToExtension ?? 'mp4',
        presetName: !shouldDisableCompression ? presetName : null,
        videoId,
        shouldMuteVideo,
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

  const renderCompressButton = (
    size: 'md' | 'lg' = 'lg',
    className?: string,
  ) => (
    <Button
      size={size}
      color="primary"
      onClick={handleCompression}
      className={cn(['my-2', className ?? ''])}
    >
      Compress <Icon name="logo" size={size === 'md' ? 20 : 25} />
    </Button>
  )

  return (
    <div className="h-full w-full flex flex-col justify-center items-center">
      {!isThumbnailGenerating ? (
        <motion.div
          className="flex flex-col justify-center items-center"
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
        >
          {fileName && !isCompressing ? <FileName /> : null}

          {isCompressing ? (
            <Compressing />
          ) : (
            <Image
              alt="video to compress"
              src={thumbnailPath as string}
              className="max-w-[60vw] max-h-[40vh] object-contain border-8 rounded-3xl border-primary"
            />
          )}
          {!isCompressing ? (
            isCompressionSuccessful ? (
              <Success />
            ) : (
              <>
                <section className="my-4 hslg:my-6 flex items-center space-x-4 justify-center gap-4">
                  <div>
                    <p className="italic text-sm text-gray-600 dark:text-gray-400">
                      Size
                    </p>
                    <h1 className="text-2xl hslg:text-4xl font-black">
                      {videoSize}
                    </h1>
                  </div>
                  <Divider orientation="vertical" className="h-10" />
                  <div>
                    <p className="italic text-sm text-gray-600 dark:text-gray-400">
                      Extension
                    </p>
                    <h1 className="text-2xl hslg:text-4xl font-black">
                      {videoExtension ?? '-'}
                    </h1>
                  </div>
                </section>
                <Divider />
                <section className="my-2 hslg:my-4">
                  <div className="flex items-center my-2">
                    <Checkbox
                      isSelected={shouldMuteVideo}
                      onValueChange={() => {
                        videoProxy.state.config.shouldMuteVideo =
                          !shouldMuteVideo
                      }}
                      className="flex justify-center items-center "
                    >
                      <div className="flex justify-center items-center">
                        <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                          Mute Video
                        </span>
                      </div>
                    </Checkbox>
                  </div>
                  <div className="flex items-center mb-4 my-2">
                    <Checkbox
                      isSelected={shouldDisableCompression}
                      onValueChange={() => {
                        videoProxy.state.config.shouldDisableCompression =
                          !shouldDisableCompression
                      }}
                      className="flex justify-center items-center "
                    >
                      <div className="flex justify-center items-center">
                        <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
                          Disable Compression
                        </span>
                        <Tooltip
                          delay={0}
                          placement="right"
                          content={
                            <div className="max-w-[200px] p-2">
                              <p>
                                You can disable the compression if you just want
                                to change the extension of the video.
                              </p>
                            </div>
                          }
                          aria-label="You can disable the compression if you just
                              want to change the extension of the video"
                          className="flex justify-center items-center"
                        >
                          <button type="button">
                            <Icon name="question" className="block" />
                          </button>
                        </Tooltip>
                      </div>
                    </Checkbox>
                  </div>
                  <div className="flex justify-center items-center gap-4">
                    <Select
                      label="Compression preset:"
                      className="w-[300px] flex-shrink-0 rounded-2xl"
                      size="sm"
                      selectedKeys={[presetName]}
                      onChange={(evt) => {
                        videoProxy.state.config.presetName = evt?.target
                          ?.value as keyof typeof compressionPresets
                      }}
                      selectionMode="single"
                      disallowEmptySelection
                      isDisabled={shouldDisableCompression}
                    >
                      {presets?.map((preset) => (
                        // Right now if we use SelectItem it breaks the code so opting for SelectItem from NextUI directly
                        <SelectItem
                          key={preset}
                          value={preset}
                          className="flex justify-center items-center"
                          endContent={
                            preset === compressionPresets.ironclad ? (
                              <Tooltip
                                content="Recommended"
                                aria-label="Recommended"
                              >
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
                    <Divider orientation="vertical" className="h-10" />
                    <Select
                      label="Convert to:"
                      className="w-[300px] flex-shrink-0 rounded-2xl"
                      size="sm"
                      value={convertToExtension}
                      selectedKeys={[convertToExtension]}
                      onChange={(evt) => {
                        videoProxy.state.config.convertToExtension = evt?.target
                          ?.value as keyof typeof extensions.video
                      }}
                      selectionMode="single"
                      disallowEmptySelection
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
                </section>
                {renderCompressButton('md', 'hslg:hidden')}
                {renderCompressButton('lg', 'hidden hslg:flex hslg:mt-2')}
              </>
            )
          ) : null}
        </motion.div>
      ) : (
        <Spinner size="lg" />
      )}
    </div>
  )
}

export default React.memo(VideoConfig)
