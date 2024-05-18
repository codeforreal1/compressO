'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { core, event } from '@tauri-apps/api'
import { SelectItem } from '@nextui-org/select'
import { FileResponse, save } from '@tauri-apps/plugin-dialog'
import { useDisclosure } from '@nextui-org/modal'
import { motion } from 'framer-motion'

import Modal, {
  ModalHeader,
  ModalBody,
  ModalContent,
  ModalFooter,
} from '@/components/Modal'
import Progress from '@/components/Progress'
import Button from '@/components/Button'
import Select from '@/components/Select'
import Code from '@/components/Code'
import Spinner from '@/components/Spinner'
import Divider from '@/components/Divider'
import Image from '@/components/Image'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import VideoPicker from '@/tauri/components/VideoPicker'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import { formatBytes } from '@/utils/fs'
import {
  compressVideo,
  generateVideoThumbnail,
  getVideoDuration,
} from '@/tauri/commands/ffmpeg'
import {
  deleteFile,
  getFileMetadata,
  getImageDimension,
  moveFile,
  showItemInFileManager,
} from '@/tauri/commands/fs'
import {
  CustomEvents,
  VideoCompressionProgress,
  compressionPresets,
  extensions,
} from '@/types/compression'
import Tooltip from '@/components/Tooltip'
import { convertDurationToMilliseconds } from '@/utils/string'
import DotPattern from '@/ui/Patterns/DotPattern'
import Drawer from '@/components/Drawer'
import About from './About'

type Video = {
  id?: string | null
  isFileSelected: boolean
  pathRaw?: string | null
  path?: string | null
  fileName?: string | null
  mimeType?: string | null
  sizeInBytes?: number | null
  size?: string | null
  extension?: null | string
  thumbnailPathRaw?: string | null
  thumbnailPath?: string | null
  isThumbnailGenerating?: boolean
  videoDurationMilliseconds?: number | null
  videDurationRaw?: string | null
  isCompressing?: boolean
  isCompressionSuccessful?: boolean
  compressedVideo?: {
    pathRaw?: string | null
    path?: string | null
    fileName?: string | null
    mimeType?: string | null
    sizeInBytes?: number | null
    size?: string | null
    extension?: null | string
    isSaved?: boolean
    isSaving?: boolean
    savedPath?: string
  } | null
}

const initialState: Video = {
  id: null,
  isFileSelected: false,
  pathRaw: null,
  path: null,
  fileName: null,
  mimeType: null,
  sizeInBytes: null,
  size: null,
  extension: null,
  thumbnailPathRaw: null,
  thumbnailPath: null,
  isThumbnailGenerating: false,
  videoDurationMilliseconds: null,
  videDurationRaw: null,
  isCompressing: false,
  isCompressionSuccessful: false,
  compressedVideo: null,
}

const videoExtensions = Object.keys(extensions?.video)
const presets = Object.keys(compressionPresets)

function Root() {
  const [video, setVideo] = React.useState<Video>(initialState)
  const [convertToExtension, setConvertToExtension] =
    React.useState<keyof typeof extensions.video>('mp4')
  const [presetName, setPresetName] =
    React.useState<keyof typeof compressionPresets>('ironclad')
  const [progress, setProgress] = React.useState<number>(0)

  const { isOpen, onOpenChange, onOpen } = useDisclosure()

  const { videoDurationMilliseconds, id: videoId } = video
  React.useEffect(() => {
    let unListen: event.UnlistenFn
    if (videoDurationMilliseconds) {
      ;(async function iife() {
        unListen = await event.listen<VideoCompressionProgress>(
          CustomEvents.VideoCompressionProgress,
          (evt) => {
            const payload = evt?.payload
            if (videoId === payload?.videoId) {
              const currentDurationInMilliseconds =
                convertDurationToMilliseconds(payload?.currentDuration)
              if (
                currentDurationInMilliseconds > 0 &&
                videoDurationMilliseconds >= currentDurationInMilliseconds
              ) {
                setProgress(
                  (currentDurationInMilliseconds * 100) /
                    videoDurationMilliseconds,
                )
              }
            }
          },
        )
      })()
    }

    return () => {
      unListen?.()
    }
  }, [videoDurationMilliseconds, videoId])

  const handleVideoSelected = async ({ file }: { file: FileResponse }) => {
    if (video?.isCompressing) return
    try {
      if (!file) {
        toast.error('Invalid file selected.')
        return
      }

      const fileMetadata = await getFileMetadata(file?.path)

      if (
        !fileMetadata ||
        (typeof fileMetadata?.size === 'number' && fileMetadata?.size <= 1000)
      ) {
        toast.error('Invalid file.')
        return
      }

      setVideo({
        isFileSelected: true,
        pathRaw: file?.path,
        path: core.convertFileSrc(file?.path),
        fileName: fileMetadata?.fileName,
        mimeType: fileMetadata?.mimeType,
        sizeInBytes: fileMetadata?.size,
        size: formatBytes(fileMetadata?.size ?? 0),
        isThumbnailGenerating: true,
        extension: fileMetadata?.extension,
      })
      if (fileMetadata?.extension) {
        setConvertToExtension(
          fileMetadata?.extension as keyof (typeof extensions)['video'],
        )
      }

      const thumbnail = await generateVideoThumbnail(file?.path)

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
        const thumbnailDimension = await getImageDimension(thumbnail?.filePath)
        if (
          Array.isArray(thumbnailDimension) &&
          thumbnailDimension?.length === 2
        ) {
          setVideo((previousState) => ({
            ...previousState,
            thumbnailDimension,
          }))
        }
      }
      const duration = await getVideoDuration(file?.path)
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
      reset()
      toast.error('File seems to be corrupted.')
    }
  }

  const handleCompression = async () => {
    if (video?.isCompressing) return
    setVideo((previousState) => ({
      ...previousState,
      isCompressing: true,
    }))
    try {
      const result = await compressVideo({
        videoPath: video?.pathRaw as string,
        convertToExtension: convertToExtension ?? 'mp4',
        presetName,
        videoId: video?.id,
      })
      if (!result) {
        throw new Error()
      }
      const compressedVideoMetadata = await getFileMetadata(result?.filePath)
      if (!compressedVideoMetadata) {
        throw new Error()
      }
      setVideo((previousState) => ({
        ...previousState,
        isCompressing: false,
        isCompressionSuccessful: true,
        compressedVideo: {
          fileName: compressedVideoMetadata?.fileName,
          pathRaw: compressedVideoMetadata?.path,
          path: core.convertFileSrc(compressedVideoMetadata?.path ?? ''),
          mimeType: compressedVideoMetadata?.mimeType,
          sizeInBytes: compressedVideoMetadata?.size,
          size: formatBytes(compressedVideoMetadata?.size ?? 0),
          extension: compressedVideoMetadata?.extension,
        },
      }))
    } catch (error) {
      toast.error('Something went wrong during compression.')
      setVideo((previousState) => ({
        ...previousState,
        isCompressing: false,
        isCompressionSuccessful: false,
      }))
    }
  }

  const reset = () => {
    setVideo(initialState)
    setProgress(0)
  }

  const sizeDiff: number = React.useMemo(
    () =>
      typeof video?.compressedVideo?.sizeInBytes === 'number' &&
      typeof video?.sizeInBytes === 'number' &&
      !Number.isNaN(video?.sizeInBytes)
        ? (((video?.sizeInBytes ?? 0) -
            (video?.compressedVideo?.sizeInBytes ?? 0)) *
            100) /
          video.sizeInBytes
        : 0,
    [video],
  )

  const fileNameDisplay =
    (video?.isCompressionSuccessful
      ? `${video?.fileName?.slice(0, -((video?.extension?.length ?? 0) + 1))}.${
          video?.compressedVideo?.extension
        }`
      : video?.fileName) ?? ''

  const handleCompressedVideoSave = async () => {
    try {
      const pathToSave = await save({
        title: 'Choose location to save the compressed video.',
        defaultPath: `compressO-${fileNameDisplay}`,
      })
      if (pathToSave) {
        setVideo((previousState) => ({
          ...previousState,
          compressedVideo: {
            ...(previousState?.compressedVideo ?? {}),
            isSaving: true,
            isSaved: false,
          },
        }))
        await moveFile(video?.compressedVideo?.pathRaw as string, pathToSave)
        setVideo((previousState) => ({
          ...previousState,
          compressedVideo: {
            ...(previousState?.compressedVideo ?? {}),
            savedPath: pathToSave,
            isSaving: false,
            isSaved: true,
          },
        }))
      }
    } catch (_) {
      toast.error('Could not save video to the given path.')
      setVideo((previousState) => ({
        ...previousState,
        compressedVideo: {
          ...(previousState?.compressedVideo ?? {}),
          isSaving: false,
          isSaved: false,
        },
      }))
    }
  }

  const handleFileOpen = async () => {
    if (!video?.compressedVideo?.savedPath) return
    try {
      await showItemInFileManager(video?.compressedVideo?.savedPath)
    } catch {
      //
    }
  }

  const handleDiscard = async ({ closeModal }: { closeModal: () => void }) => {
    try {
      await Promise.allSettled([
        deleteFile(video?.compressedVideo?.pathRaw as string),
        deleteFile(video?.thumbnailPathRaw as string),
      ])
      closeModal?.()
      reset()
    } catch {
      //
    }
  }

  return (
    <section className="w-full h-full relative">
      {!video?.isFileSelected ? <DotPattern className="opacity-40" /> : null}
      <div className="absolute top-4 left-4 z-10 flex justify-center items-center">
        <Image src="/logo.png" alt="logo" width={30} height={30} />
      </div>
      <div className="absolute bottom-4 left-4 z-10">
        <ThemeSwitcher />
      </div>
      <Drawer
        renderTriggerer={({ open: openDrawer }) => (
          <div className="absolute bottom-4 right-4 z-10 p-0">
            <Tooltip content="Info" aria-label="info" placement="left">
              <Button onClick={openDrawer} isIconOnly size="sm">
                <Icon name="info" size={23} />
              </Button>
            </Tooltip>
          </div>
        )}
      >
        <About />
      </Drawer>
      {video?.isFileSelected ? (
        <div className="h-full w-full flex flex-col justify-center items-center">
          {!video?.isThumbnailGenerating ? (
            <div className="flex flex-col justify-center items-center">
              {video?.fileName && !video?.isCompressing ? (
                <div className="flex justify-center items-center mb-2 gap-1">
                  <Code className="ml-auto mr-auto text-center rounded-lg">
                    {fileNameDisplay?.length > 50
                      ? `${fileNameDisplay?.slice(0, 20)}...${fileNameDisplay?.slice(-10)}`
                      : fileNameDisplay}
                  </Code>
                  <Button
                    isIconOnly
                    size="sm"
                    onClick={() => {
                      if (
                        video?.isCompressionSuccessful &&
                        !video?.compressedVideo?.isSaved
                      ) {
                        onOpen()
                      } else {
                        reset()
                      }
                    }}
                    className="bg-transparent"
                  >
                    <Tooltip
                      content="Cancel compression"
                      aria-label="Cancel compression"
                    >
                      <Icon name="cross" size={22} />
                    </Tooltip>
                  </Button>
                </div>
              ) : null}

              {video?.isCompressing ? (
                <motion.div
                  className="relative flex-shrink-0 w-[500px] h-[500px]"
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', duration: 0.6 }}
                >
                  <Progress
                    {...(video?.videDurationRaw == null
                      ? { isIndeterminate: true }
                      : { value: progress })}
                    classNames={{
                      base: 'absolute top-0 left-0 translate-x-[-25px] translate-y-[-25px]',
                      svg: 'w-[500px] h-[500px] drop-shadow-md',
                      indicator: 'stroke-primary stroke-1',
                      track: 'stroke-transparent stroke-1',
                      value: 'text-3xl font-semibold text-primary',
                    }}
                    strokeWidth={2}
                    aria-label={`Progress-${progress}%`}
                  />
                  <Image
                    alt="video to compress"
                    src={video?.thumbnailPath as string}
                    className="max-w-[60vw] max-h-[40vh] object-cover rounded-3xl"
                    style={{
                      width: '450px',
                      height: '450px',
                      minWidth: '450px',
                      minHeight: '450px',
                      borderRadius: '50%',
                      transform: 'scale(0.92)',
                      flexShrink: 0,
                    }}
                  />
                  <p className="italic text-sm mt-4 text-gray-600 dark:text-gray-400 text-center animate-pulse">
                    Compressing...
                    {convertToExtension === 'webm' ? (
                      <span className="block">
                        webm conversion takes longer than the other formats.
                      </span>
                    ) : null}
                  </p>
                  <p
                    className={`not-italic text-xl text-center font-bold text-primary my-1 opacity-${
                      progress > 0 ? 1 : 0
                    }`}
                  >
                    {progress?.toFixed(2)}%
                  </p>
                </motion.div>
              ) : (
                <Image
                  alt="video to compress"
                  src={video?.thumbnailPath as string}
                  className="max-w-[60vw] max-h-[40vh] object-contain border-8 rounded-3xl border-primary"
                />
              )}
              {!video?.isCompressing ? (
                video?.isCompressionSuccessful ? (
                  <section className="animate-appearance-in">
                    <div className="flex justify-center items-center mt-6">
                      <p className="text-4xl font-bold mx-4">{video?.size}</p>
                      <Icon
                        name="curvedArrow"
                        className="text-white dark:text-black rotate-[-65deg] translate-y-[-8px]"
                        size={100}
                      />
                      <p className="text-4xl font-bold mx-4 text-primary">
                        {video?.compressedVideo?.size}
                      </p>
                    </div>
                    {!(sizeDiff <= 0) ? (
                      <p className="block text-7xl text-center text-green-500 mt-5">
                        {sizeDiff.toFixed(2)?.endsWith('.00')
                          ? sizeDiff.toFixed(2)?.slice(0, -3)
                          : sizeDiff.toFixed(2)}
                        %<span className="text-large block">smaller</span>
                      </p>
                    ) : null}
                    <div className="flex justify-center mt-10">
                      <Button
                        className="flex justify-center items-center"
                        color="success"
                        onClick={handleCompressedVideoSave}
                        isLoading={video?.compressedVideo?.isSaving}
                        isDisabled={
                          video?.compressedVideo?.isSaving ||
                          video?.compressedVideo?.isSaved
                        }
                      >
                        {video?.compressedVideo?.isSaved
                          ? 'Saved'
                          : 'Save Video'}
                        <Icon
                          name={
                            video?.compressedVideo?.isSaved ? 'tick' : 'save'
                          }
                          className="text-green-300"
                        />
                      </Button>
                      {video?.compressedVideo?.isSaved &&
                      video?.compressedVideo?.savedPath ? (
                        <Tooltip
                          content="Show in File Explorer"
                          aria-label="Show in File Explorer"
                        >
                          <Button
                            isIconOnly
                            className="ml-2 text-green-500"
                            onClick={handleFileOpen}
                          >
                            <Icon name="fileExplorer" />
                          </Button>
                        </Tooltip>
                      ) : null}
                    </div>
                  </section>
                ) : (
                  <>
                    <section className="my-6 flex items-center space-x-4 justify-center gap-4">
                      <div>
                        <p className="italic text-sm text-gray-600 dark:text-gray-400">
                          Size
                        </p>
                        <h1 className="text-4xl font-black">{video?.size}</h1>
                      </div>
                      <Divider orientation="vertical" className="h-10" />
                      <div>
                        <p className="italic text-sm text-gray-600 dark:text-gray-400">
                          Extension
                        </p>
                        <h1 className="text-4xl font-black">
                          {video?.extension ?? '-'}
                        </h1>
                      </div>
                    </section>
                    <Divider />
                    <section className="my-8 flex justify-center items-center gap-4">
                      <Select
                        label="Compression preset:"
                        className="w-[300px] flex-shrink-0 rounded-2xl"
                        size="sm"
                        selectedKeys={[presetName]}
                        onChange={(evt) =>
                          setPresetName(
                            evt?.target
                              ?.value as keyof typeof compressionPresets,
                          )
                        }
                        radius="lg"
                        selectionMode="single"
                        disallowEmptySelection
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
                        onChange={(evt) =>
                          setConvertToExtension(
                            evt?.target?.value as keyof typeof extensions.video,
                          )
                        }
                        radius="lg"
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
                    </section>
                    <Button
                      size="lg"
                      color="primary"
                      onClick={handleCompression}
                    >
                      Compress <Icon name="logo" size={25} />
                    </Button>
                  </>
                )
              ) : null}
            </div>
          ) : (
            <Spinner size="lg" />
          )}
        </div>
      ) : (
        <VideoPicker onSuccess={handleVideoSelected}>
          {({ onClick }) => (
            <div
              role="button"
              tabIndex={0}
              className="h-full w-full flex justify-center items-center z-0 flex-col animate-appearance-in"
              onClick={onClick}
              onKeyDown={(evt) => {
                if (evt?.key === 'Enter') {
                  onClick()
                }
              }}
            >
              <Icon name="videoFile" className="text-primary" size={70} />
              <p className="italic text-sm mt-4 text-gray-600 dark:text-gray-400 text-center">
                Click anywhere to select a video
              </p>
            </div>
          )}
        </VideoPicker>
      )}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent className="max-w-[500px]">
          {(closeModal) => (
            <>
              <ModalHeader>Video not saved</ModalHeader>
              <ModalBody className="gap-0">
                <div className="mb-4">
                  Your compressed video is not yet saved.
                  <span className="block">
                    Are you sure you want to discard it?
                  </span>
                </div>
                <ModalFooter>
                  <Button onClick={closeModal}>Go Back</Button>
                  <Button
                    color="danger"
                    onClick={() => handleDiscard({ closeModal })}
                  >
                    Yes
                  </Button>
                </ModalFooter>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </section>
  )
}

export default dynamic(() => Promise.resolve(Root), { ssr: false })
