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
    state: { compressedVideo, isCompressionSuccessful, fileName },
  } = useSnapshot(videoProxy)

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
    <div className="flex items-center">
      <Button
        className="flex justify-center items-center"
        color="success"
        onClick={handleCompressedVideoSave}
        isLoading={compressedVideo?.isSaving}
        isDisabled={compressedVideo?.isSaving || compressedVideo?.isSaved}
        fullWidth
        size="lg"
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
  )
}

export default React.memo(Success)
