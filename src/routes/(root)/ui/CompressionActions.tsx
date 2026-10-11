import { UseDisclosureProps, useDisclosure } from '@heroui/react'
import { memo, useEffect, useRef } from 'react'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { deleteFile } from '@/tauri/commands/fs'
import AlertDialog, { AlertDialogButton } from '@/ui/Dialogs/AlertDialog'
import { isOverlayOpen, isTextEntryElement } from '@/utils/keyboard'
import { appProxy } from '../-state'

function CompressionActions() {
  const {
    state: { media, isProcessCompleted, isLoadingMediaFiles, isSaving },
    resetProxy,
  } = useSnapshot(appProxy)

  const alertDisclosure = useDisclosure()

  const handleDiscard = async ({
    closeModal,
  }: {
    closeModal: UseDisclosureProps['onClose']
  }) => {
    try {
      const deletePromises = media
        .flatMap((media) => [
          media.compressedFile?.pathRaw
            ? deleteFile(media.compressedFile.pathRaw)
            : null,
          media.type === 'video' && media.thumbnailPathRaw
            ? deleteFile(media.thumbnailPathRaw)
            : null,
        ])
        .filter(Boolean)

      await Promise.allSettled(deletePromises)
      closeModal?.()
      resetProxy()
    } catch {}
  }

  const handleCancelCompression = () => {
    const appSnapshot = snapshot(appProxy)
    if (appSnapshot.state.isProcessCompleted && !appSnapshot.state.isSaved) {
      alertDisclosure.onOpen()
    } else {
      resetProxy()
    }
  }

  // Escape acts like the Exit button: back to the home screen, after a confirmation when the
  // compressed media is not saved yet
  const handleExitRef = useRef(handleCancelCompression)
  handleExitRef.current = handleCancelCompression
  useEffect(() => {
    // Capture phase, so it runs before the Escape handlers of what is open on top (e.g. the full
    // media info), which are skipped below
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.repeat ||
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        isTextEntryElement(e.target as HTMLElement | null) ||
        isOverlayOpen()
      ) {
        return
      }
      const { state } = snapshot(appProxy)
      if (
        !state.media.length ||
        state.isLoadingMediaFiles ||
        state.isCompressing ||
        state.isSaving ||
        state.showMediaInfo ||
        state.selectedMediaIndexForCustomization > -1
      ) {
        return
      }
      e.preventDefault()
      handleExitRef.current()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [])

  const handleReconfigure = () => {
    appProxy.timeTravel('beforeCompressionStarted')
  }

  return media.length && !isLoadingMediaFiles ? (
    <>
      <div className="w-fit flex justify-center items-center z-[10]">
        {isProcessCompleted ? (
          <Tooltip content="Reconfigure" aria-label="Reset">
            <Button
              size="sm"
              onPress={handleReconfigure}
              variant="light"
              radius="full"
              className="gap-1"
              isDisabled={isSaving}
              isIconOnly
            >
              <Icon name="redo" size={22} />{' '}
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content="Exit" aria-label="Exit">
          <Button
            size="sm"
            onPress={handleCancelCompression}
            variant={'light'}
            radius="full"
            className="gap-1"
            isDisabled={isSaving}
            isIconOnly
          >
            <Icon name="cross" size={22} />
          </Button>
        </Tooltip>
      </div>
      <AlertDialog
        title={`Media not saved`}
        disclosure={alertDisclosure}
        description={`Your compressed media${media.length > 1 ? 'are' : ' is'} not yet saved. Are you sure you want to discard it?`}
        renderFooter={({ closeModal }) => (
          <>
            <AlertDialogButton onPress={closeModal}>Go Back</AlertDialogButton>
            <AlertDialogButton
              color="danger"
              onPress={() => handleDiscard({ closeModal })}
            >
              Yes
            </AlertDialogButton>
          </>
        )}
      />
    </>
  ) : null
}

export default memo(CompressionActions)
