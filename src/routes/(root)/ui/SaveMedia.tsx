import React, { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { copyFileToClipboard, showItemInFileManager } from '@/tauri/commands/fs'
import { saveCompressedMediaWithPrompt } from '../-save'
import { appProxy } from '../-state'

function SaveMedia() {
  const {
    state: { media, isSaving, isSaved, isCompressing },
  } = useSnapshot(appProxy)
  const mediaFile = media.length === 1 ? media[0] : null

  const handleCompressedMediaSave = useCallback(async () => {
    await saveCompressedMediaWithPrompt()
  }, [])

  const openInFileManager = async () => {
    const { media } = appProxy.state
    const mediaFile = media.length > 0 ? media[0] : null
    const { compressedFile } = mediaFile ?? {}

    const savedPath = appProxy.state.savedPath ?? compressedFile?.savedPath
    if (!savedPath) return
    try {
      await showItemInFileManager(savedPath)
    } catch {}
  }

  const copyToClipboard = async () => {
    const { media } = appProxy.state
    const mediaFile = media.length > 0 ? media[0] : null
    const { compressedFile } = mediaFile ?? {}

    const savedPath =
      appProxy.state.savedPath ??
      compressedFile?.savedPath ??
      compressedFile?.pathRaw
    if (!savedPath) return

    try {
      await copyFileToClipboard(savedPath)
      toast.success('Copied to clipboard.')
    } catch {}
  }

  return (
    <div className="flex items-center">
      <Button
        className="flex justify-center items-center"
        color="primary"
        onPress={handleCompressedMediaSave}
        isLoading={isSaving}
        isDisabled={isSaving || isSaved}
        fullWidth
        variant="solid"
      >
        {isSaving ? 'Saving...' : isSaved ? 'Saved' : `Save Media`}
        {!isSaving ? (
          <Icon name={isSaved ? 'tick' : 'download'} className="text-primary" />
        ) : null}
      </Button>
      {isSaved ? (
        <>
          <Tooltip
            content="Show in File Explorer"
            aria-label="Show in File Explorer"
          >
            <Button
              isIconOnly
              className="ml-2 text-primary"
              onPress={openInFileManager}
            >
              <Icon name="fileExplorer" />
            </Button>
          </Tooltip>
        </>
      ) : null}
      {!isCompressing &&
      mediaFile?.isProcessCompleted &&
      mediaFile?.compressedFile?.isSuccessful ? (
        <Tooltip
          content="Copy output to clipboard"
          aria-label="Copy output to clipboard"
        >
          <Button
            isIconOnly
            className="ml-2 text-primary"
            onPress={copyToClipboard}
          >
            <Icon name="copy" size={28} />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  )
}

export default React.memo(SaveMedia)
