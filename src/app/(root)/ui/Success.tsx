'use client'

import React from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'

import { moveFile, showItemInFileManager } from '@/tauri/commands/fs'
import Tooltip from '@/components/Tooltip'
import { videoProxy } from '../state'

function Success() {
  const {
    state: {
      sizeInBytes,
      compressedVideo,
      isCompressionSuccessful,
      fileName,
      size: videoSize,
    },
  } = useSnapshot(videoProxy)

  const sizeDiff: number = React.useMemo(
    () =>
      typeof compressedVideo?.sizeInBytes === 'number' &&
      typeof sizeInBytes === 'number' &&
      !Number.isNaN(sizeInBytes)
        ? (((sizeInBytes ?? 0) - (compressedVideo?.sizeInBytes ?? 0)) * 100) /
          sizeInBytes
        : 0,
    [compressedVideo?.sizeInBytes, sizeInBytes],
  )

  const fileNameDisplay =
    (isCompressionSuccessful ? compressedVideo?.fileNameToDisplay : fileName) ??
    ''

  const handleCompressedVideoSave = async () => {
    try {
      const pathToSave = await save({
        title: 'Choose location to save the compressed video.',
        defaultPath: `compressO-${fileNameDisplay}`,
      })
      if (pathToSave) {
        videoProxy.state.compressedVideo = {
          ...(snapshot(videoProxy).state.compressedVideo ?? {}),
          isSaving: true,
          isSaved: false,
        }
        await moveFile(compressedVideo?.pathRaw as string, pathToSave)
        videoProxy.state.compressedVideo = {
          ...(snapshot(videoProxy).state.compressedVideo ?? {}),
          savedPath: pathToSave,
          isSaving: false,
          isSaved: true,
        }
      }
    } catch (_) {
      toast.error('Could not save video to the given path.')
      videoProxy.state.compressedVideo = {
        ...(snapshot(videoProxy).state.compressedVideo ?? {}),
        isSaving: false,
        isSaved: false,
      }
    }
  }

  const openInFileManager = async () => {
    if (!compressedVideo?.savedPath) return
    try {
      await showItemInFileManager(compressedVideo?.savedPath)
    } catch {
      //
    }
  }

  return (
    <section className="animate-appearance-in">
      <div className="flex justify-center items-center mt-3 hslg:mt-6">
        <p className="text-2xl hslg:text-4xl font-bold mx-4">{videoSize}</p>
        <Icon
          name="curvedArrow"
          className="text-black dark:text-white rotate-[-65deg] translate-y-[-8px]"
          size={100}
        />
        <p className="text-3xl hslg:text-4xl font-bold mx-4 text-primary">
          {compressedVideo?.size}
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
          isLoading={compressedVideo?.isSaving}
          isDisabled={compressedVideo?.isSaving || compressedVideo?.isSaved}
        >
          {compressedVideo?.isSaved ? 'Saved' : 'Save Video'}
          <Icon
            name={compressedVideo?.isSaved ? 'tick' : 'save'}
            className="text-green-300"
          />
        </Button>
        {compressedVideo?.isSaved && compressedVideo?.savedPath ? (
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

export default React.memo(Success)
