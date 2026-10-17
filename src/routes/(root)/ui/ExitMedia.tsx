import { UseDisclosureProps, useDisclosure } from '@heroui/react'
import { memo, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { deleteFile } from '@/tauri/commands/fs'
import AlertDialog, { AlertDialogButton } from '@/ui/Dialogs/AlertDialog'
import { isOverlayOpen, isTextEntryElement } from '@/utils/keyboard'
import { cn } from '@/utils/tailwind'
import { appProxy } from '../-state'

type ExitMediaProps = {
  className?: string
}

/**
 * Exit button: back to the home screen, after a confirmation when the compressed media is not saved
 * yet. Escape does the same. Neither works while media is being added (it would keep being added
 * after exiting) or compressed.
 */
function ExitMedia({ className }: ExitMediaProps) {
  const { t } = useTranslation()
  const {
    state: { media, isSaving, isLoadingMediaFiles },
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

  const handleExit = () => {
    const appSnapshot = snapshot(appProxy)
    if (appSnapshot.state.isProcessCompleted && !appSnapshot.state.isSaved) {
      alertDisclosure.onOpen()
    } else {
      resetProxy()
    }
  }

  // Escape acts like the Exit button
  const handleExitRef = useRef(handleExit)
  handleExitRef.current = handleExit
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
      // Escape saves an open crop or trim editor instead (see `PreviewSingleMedia`)
      const isEditing = state.media.some(
        (mediaFile) =>
          (mediaFile.type === 'video' &&
            (mediaFile.config.isVideoTransformEditMode ||
              mediaFile.config.isVideoTrimEditMode)) ||
          (mediaFile.type === 'image' &&
            mediaFile.config.isImageTransformEditMode),
      )
      if (
        isEditing ||
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

  return (
    <>
      {/* Hidden while media is being added; the dialog stays mounted */}
      {isLoadingMediaFiles ? null : (
        <Tooltip
          content={`${t('exit.title')} (Esc)`}
          aria-label={t('exit.title')}
        >
          <Button
            size="sm"
            onPress={handleExit}
            variant="light"
            radius="full"
            className={cn(['h-7 w-7 min-w-7', className])}
            isDisabled={isSaving}
            isIconOnly
            aria-label={t('exit.title')}
          >
            <Icon name="cross" size={20} />
          </Button>
        </Tooltip>
      )}
      <AlertDialog
        title={t('exit.notSaved')}
        disclosure={alertDisclosure}
        description={t('exit.discardConfirm', { count: media.length })}
        renderFooter={({ closeModal }) => (
          <>
            <AlertDialogButton onPress={closeModal}>
              {t('exit.goBack')}
            </AlertDialogButton>
            <AlertDialogButton
              color="danger"
              onPress={() => handleDiscard({ closeModal })}
            >
              {t('common.yes')}
            </AlertDialogButton>
          </>
        )}
      />
    </>
  )
}

export default memo(ExitMedia)
