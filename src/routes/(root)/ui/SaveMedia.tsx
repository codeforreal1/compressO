import { path } from '@tauri-apps/api'
import { open, save } from '@tauri-apps/plugin-dialog'
import React, { useCallback, useEffect } from 'react'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import {
    copyFileToClipboard,
    moveFile,
    showItemInFileManager,
} from '@/tauri/commands/fs'
import { appProxy } from '../-state'

// Cross-platform path joining utility
const joinPath = (...parts: string[]): string => {
  return parts.filter(Boolean).join('/')
}

function SaveMedia() {
  const {
    state: { media, isSaving, isSaved, isCompressing, autoSaveEnabled, isProcessCompleted },
  } = useSnapshot(appProxy)
  const mediaFile = media.length === 1 ? media[0] : null

  const performAutoSave = useCallback(async (isAutoSave: boolean = false) => {
    if (appProxy.state.media.length) {
      const { media } = appProxy.state
      const isBatch = media.length > 1
      const mediaFile = media.length > 0 ? media[0] : null
      const { compressedFile, fileName } = mediaFile ?? {}

      try {
        let pathToSave: string | string[] | null = null

        if (isBatch) {
          if (isAutoSave) {
            // For auto-save in batch mode, use custom path or default Downloads folder
            const customPath = appProxy.state.autoSavePath
            const directory = customPath || (await path.downloadDir())
            pathToSave = directory
          } else {
            const selectedDirectory = await open({
              directory: true,
              title: 'Choose directory to save the compressed media.',
            })
            if (selectedDirectory) {
              pathToSave = selectedDirectory as string
              appProxy.state.autoSavePath = pathToSave
            }
          }
        } else {
          if (isAutoSave) {
            // For auto-save in single file mode, use custom path or default Downloads folder
            const customPath = appProxy.state.autoSavePath
            const defaultDir = customPath || (await path.downloadDir())
            const filename = `compressO-${compressedFile?.fileNameToDisplay ?? fileName ?? 'media'}`
            pathToSave = joinPath(defaultDir, filename)
          } else {
            pathToSave = await save({
              title: 'Choose location to save the compressed media.',
              defaultPath: `compressO-${compressedFile?.fileNameToDisplay ?? fileName ?? ''}`,
            })
          }
        }

        if (pathToSave) {
          appProxy.state.isSaving = true
          appProxy.state.isSaved = false
          appProxy.state.savedPath = pathToSave

          if (isBatch) {
            const directory = pathToSave as string

            for (let i = 0; i < media.length; i++) {
              const mediaFile = media[i]
              if (mediaFile.compressedFile?.pathRaw) {
                appProxy.state.media[i].compressedFile = {
                  ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
                  isSaving: true,
                  isSaved: false,
                }

                const destinationPath = joinPath(directory, `compressO-${mediaFile?.compressedFile?.fileNameToDisplay || mediaFile?.fileName}`)

                await moveFile(
                  mediaFile.compressedFile.pathRaw,
                  destinationPath,
                )
                appProxy.state.media[i].compressedFile = {
                  ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
                  savedPath: destinationPath,
                  isSaving: false,
                  isSaved: true,
                }
              }
            }
            appProxy.state.isSaved = true
          } else {
            appProxy.state.media[0].compressedFile = {
              ...(snapshot(appProxy).state.media[0].compressedFile ?? {}),
              isSaving: true,
              isSaved: false,
            }
            await moveFile(
              compressedFile?.pathRaw as string,
              pathToSave as string,
            )
            appProxy.state.media[0].compressedFile = {
              ...(snapshot(appProxy).state.media[0].compressedFile ?? {}),
              savedPath: pathToSave as string,
              isSaving: false,
              isSaved: true,
            }
            appProxy.state.isSaved = true
          }

          if (isAutoSave) {
            toast.success('Compression complete! File saved automatically.')
          }
        }
      } catch (_) {
        if (!isAutoSave) {
          toast.error('Could not save media to the given path.')
        }
        for (let i = 0; i < media.length; i++) {
          appProxy.state.media[i].compressedFile = {
            ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
            isSaving: false,
            isSaved: false,
          }
        }
      }
      appProxy.state.isSaving = false
    }
  }, [])

  // Auto-save when compression completes and auto-save is enabled
  useEffect(() => {
    if (
      autoSaveEnabled &&
      isProcessCompleted &&
      !isSaving &&
      !isSaved &&
      media.length > 0 &&
      media.every((m) => m.compressedFile?.isSuccessful !== false)
    ) {
      performAutoSave(true)
    }
  }, [autoSaveEnabled, isProcessCompleted, isSaving, isSaved, media, performAutoSave])

  const handleCompressedMediaSave = useCallback(async () => {
    await performAutoSave(false)
  }, [performAutoSave])

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
        color="success"
        onPress={handleCompressedMediaSave}
        isLoading={isSaving}
        isDisabled={isSaving || isSaved}
        fullWidth
      >
        {isSaving ? 'Saving...' : isSaved ? 'Saved' : `Save Media`}
        {!isSaving ? (
          <Icon
            name={isSaved ? 'tick' : 'download'}
            className="text-green-300"
          />
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
              className="ml-2 text-green-500"
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
            className="ml-2 text-green-500"
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
