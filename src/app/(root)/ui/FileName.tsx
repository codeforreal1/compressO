'use client'

import React from 'react'
import { useDisclosure } from '@nextui-org/modal'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Code from '@/components/Code'
import Icon from '@/components/Icon'
import AlertDialog, { AlertDialogButton } from '@/ui/Dialogs/AlertDialog'
import Tooltip from '@/components/Tooltip'
import { deleteFile } from '@/tauri/commands/fs'
import { videoProxy } from '../state'

function FileName() {
  const {
    state: {
      isCompressionSuccessful,
      compressedVideo,
      thumbnailPathRaw,
      fileName,
      isFileSelected,
    },
    resetProxy,
  } = useSnapshot(videoProxy)

  const alertDiscloser = useDisclosure()

  const handleDiscard = async ({ closeModal }: { closeModal: () => void }) => {
    try {
      await Promise.allSettled([
        deleteFile(compressedVideo?.pathRaw as string),
        deleteFile(thumbnailPathRaw as string),
      ])
      closeModal?.()
      resetProxy()
    } catch {
      //
    }
  }

  const handleCancelCompression = () => {
    const videoSnapshot = snapshot(videoProxy)
    if (
      videoSnapshot.state.isCompressionSuccessful &&
      !videoSnapshot.state.compressedVideo?.isSaved
    ) {
      alertDiscloser.onOpen()
    } else {
      resetProxy()
    }
  }

  const handleReconfigure = () => {
    videoProxy.timeTravel('beforeCompressionStarted')
  }

  const fileNameDisplay =
    (isCompressionSuccessful ? compressedVideo?.fileNameToDisplay : fileName) ??
    ''

  return isFileSelected ? (
    <>
      <div className="mx-auto w-fit flex justify-center items-center mb-2 gap-1">
        <Code className="ml-auto mr-auto text-center rounded-xl px-4 text-xs xl:text-sm">
          {fileNameDisplay?.length > 50
            ? `${fileNameDisplay?.slice(0, 20)}...${fileNameDisplay?.slice(
                -10,
              )}`
            : fileNameDisplay}
        </Code>
        {isCompressionSuccessful ? (
          <Tooltip content="Reconfigure" aria-label="Reconfigure">
            <Button
              isIconOnly
              size="sm"
              onClick={handleReconfigure}
              className="bg-transparent"
            >
              <Icon name="redo" size={22} />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content="Cancel compression" aria-label="Cancel compression">
          <Button
            isIconOnly
            size="sm"
            onClick={handleCancelCompression}
            className="bg-transparent"
          >
            <Icon name="cross" size={22} />
          </Button>
        </Tooltip>
      </div>
      <AlertDialog
        title="Video not saved!"
        discloser={alertDiscloser}
        description="Your compressed video is not yet saved. Are you sure you want to discard it?"
        renderFooter={({ closeModal }) => (
          <>
            <AlertDialogButton onClick={closeModal}>Go Back</AlertDialogButton>
            <AlertDialogButton
              color="danger"
              onClick={() => handleDiscard({ closeModal })}
            >
              Yes
            </AlertDialogButton>
          </>
        )}
      />
    </>
  ) : null
}

export default React.memo(FileName)
