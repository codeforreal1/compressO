'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { save } from '@tauri-apps/plugin-dialog'
import { useAtom } from 'jotai'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'

import { moveFile, showItemInFileManager } from '@/tauri/commands/fs'
import Tooltip from '@/components/Tooltip'
import { videoAtom } from '../state'

function VideoConfig() {
  const [video, setVideo] = useAtom(videoAtom)

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
      ? video?.compressedVideo?.fileNameToDisplay
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

  const openInFileManager = async () => {
    if (!video?.compressedVideo?.savedPath) return
    try {
      await showItemInFileManager(video?.compressedVideo?.savedPath)
    } catch {
      //
    }
  }

  return (
    <section className="animate-appearance-in">
      <div className="flex justify-center items-center mt-3 hslg:mt-6">
        <p className="text-2xl hslg:text-4xl font-bold mx-4">{video?.size}</p>
        <Icon
          name="curvedArrow"
          className="text-black dark:text-white rotate-[-65deg] translate-y-[-8px]"
          size={100}
        />
        <p className="text-3xl hslg:text-4xl font-bold mx-4 text-primary">
          {video?.compressedVideo?.size}
        </p>
      </div>
      {!(sizeDiff <= 0) ? (
        <p className="block text-5xl hslg:text-7xl text-center text-green-500 hslg:mt-5">
          {sizeDiff.toFixed(2)?.endsWith('.00')
            ? sizeDiff.toFixed(2)?.slice(0, -3)
            : sizeDiff.toFixed(2)}
          %<span className="text-large block">smaller</span>
        </p>
      ) : null}
      <div className="flex justify-center mt-5 hslg:mt-10">
        <Button
          className="flex justify-center items-center"
          color="success"
          onClick={handleCompressedVideoSave}
          isLoading={video?.compressedVideo?.isSaving}
          isDisabled={
            video?.compressedVideo?.isSaving || video?.compressedVideo?.isSaved
          }
        >
          {video?.compressedVideo?.isSaved ? 'Saved' : 'Save Video'}
          <Icon
            name={video?.compressedVideo?.isSaved ? 'tick' : 'save'}
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
              onClick={openInFileManager}
            >
              <Icon name="fileExplorer" />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    </section>
  )
}

export default dynamic(() => Promise.resolve(VideoConfig), { ssr: false })
