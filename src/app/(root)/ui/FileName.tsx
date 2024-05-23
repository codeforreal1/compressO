'use client'

import React from 'react'
import dynamic from 'next/dynamic'
import { useDisclosure } from '@nextui-org/modal'
import { useAtomValue } from 'jotai'
import { useResetAtom } from 'jotai/utils'

import Button from '@/components/Button'
import Code from '@/components/Code'
import Icon from '@/components/Icon'
import AlertDialog, { AlertDialogButton } from '@/ui/Dialogs/AlertDialog'
import Tooltip from '@/components/Tooltip'
import { deleteFile } from '@/tauri/commands/fs'
import { videoAtom } from '../state'

function FileName() {
  const video = useAtomValue(videoAtom)
  const resetVideo = useResetAtom(videoAtom)

  const alertDiscloser = useDisclosure()

  const handleDiscard = async ({ closeModal }: { closeModal: () => void }) => {
    try {
      await Promise.allSettled([
        deleteFile(video?.compressedVideo?.pathRaw as string),
        deleteFile(video?.thumbnailPathRaw as string),
      ])
      closeModal?.()
      resetVideo()
    } catch {
      //
    }
  }

  const fileNameDisplay =
    (video?.isCompressionSuccessful
      ? video?.compressedVideo?.fileNameToDisplay
      : video?.fileName) ?? ''

  return video?.isFileSelected ? (
    <>
      <div className="flex justify-center items-center mb-2 gap-1">
        <Code className="ml-auto mr-auto text-center rounded-xl">
          {fileNameDisplay?.length > 50
            ? `${fileNameDisplay?.slice(0, 20)}...${fileNameDisplay?.slice(
                -10,
              )}`
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
              alertDiscloser.onOpen()
            } else {
              resetVideo()
            }
          }}
          className="bg-transparent"
        >
          <Tooltip content="Cancel compression" aria-label="Cancel compression">
            <Icon name="cross" size={22} />
          </Tooltip>
        </Button>
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

export default dynamic(() => Promise.resolve(FileName), { ssr: false })
