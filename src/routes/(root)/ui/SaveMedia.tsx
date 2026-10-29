import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import {
  copyFilesToClipboard,
  showItemInFileManager,
} from '@/tauri/commands/fs'
import { getOutputClipboardFile, saveCompressedMediaWithPrompt } from '../-save'
import { appProxy } from '../-state'

type SaveMediaProps = {
  /** One media of a batch, from its own view; without it, the single media or the whole batch */
  mediaIndex?: number
}

function SaveMedia({ mediaIndex }: SaveMediaProps) {
  const { t } = useTranslation()
  const {
    state: { media, isSaving: isAllSaving, isSaved: isAllSaved, isCompressing },
  } = useSnapshot(appProxy)
  // One media of a batch: saved, shown & copied on its own
  const isOneOfBatch = mediaIndex != null && media.length > 1
  const index = isOneOfBatch ? mediaIndex : 0
  const mediaFile = isOneOfBatch || media.length === 1 ? media[index] : null
  const isSaving = isOneOfBatch
    ? !!mediaFile?.compressedFile?.isSaving
    : isAllSaving
  const isSaved = isOneOfBatch
    ? !!mediaFile?.compressedFile?.isSaved
    : isAllSaved

  const handleCompressedMediaSave = useCallback(async () => {
    await saveCompressedMediaWithPrompt(isOneOfBatch ? index : undefined)
  }, [isOneOfBatch, index])

  // Where it was saved: the media's own, or the single media's
  const getSavedPath = () => {
    const { compressedFile } = appProxy.state.media[index] ?? {}
    return isOneOfBatch
      ? compressedFile?.savedPath
      : (appProxy.state.savedPath ?? compressedFile?.savedPath)
  }

  const openInFileManager = async () => {
    const savedPath = getSavedPath()
    if (!savedPath) return
    try {
      await showItemInFileManager(savedPath)
    } catch {}
  }

  const copyToClipboard = async () => {
    const savedPath = getSavedPath()
    const mediaFile = appProxy.state.media[index]
    // Not saved yet: pasted under the name it would be saved with, not its cache name
    const file = savedPath
      ? { path: savedPath }
      : mediaFile && getOutputClipboardFile(mediaFile)
    if (!file) return

    try {
      await copyFilesToClipboard([file])
      toast.success(t('common.copied'))
    } catch {}
  }

  return (
    <div className="flex items-center">
      <Button
        className="flex justify-center items-center"
        color="primary"
        onPress={handleCompressedMediaSave}
        isLoading={isSaving}
        isDisabled={
          isSaving ||
          isSaved ||
          (isOneOfBatch && !mediaFile?.compressedFile?.isSuccessful)
        }
        fullWidth
        variant="solid"
      >
        {isSaving
          ? t('save.saving')
          : isSaved
            ? t('save.saved')
            : isOneOfBatch
              ? t('save.saveThisFile')
              : t('save.saveMedia')}
        {!isSaving ? (
          <Icon name={isSaved ? 'tick' : 'download'} className="text-primary" />
        ) : null}
      </Button>
      {isSaved ? (
        <>
          <Tooltip
            content={t('common.showInFileManager')}
            aria-label={t('common.showInFileManager')}
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
          content={t('batch.copyOutput')}
          aria-label={t('batch.copyOutput')}
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
