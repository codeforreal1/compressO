import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { copyFileToClipboard, showItemInFileManager } from '@/tauri/commands/fs'
import { saveCompressedMediaWithPrompt } from '../-save'
import { appProxy } from '../-state'

function SaveMedia() {
  const { t } = useTranslation()
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
        isDisabled={isSaving || isSaved}
        fullWidth
        variant="solid"
      >
        {isSaving
          ? t('save.saving')
          : isSaved
            ? t('save.saved')
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
