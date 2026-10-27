import { emitTo } from '@tauri-apps/api/event'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { snapshot, useSnapshot } from 'valtio'

import AnimatedLabel from '@/components/AnimatedLabel'
import Button from '@/components/Button'
import ShortcutHint from '@/components/ShortcutHint'
import { toast } from '@/components/Toast'
import { useCommandEnterShortcut } from '@/hooks/useCommandEnterShortcut'
import { useCommandKeyHeld } from '@/hooks/useCommandKeyHeld'
import { CustomEvents } from '@/types/compression'
import {
  autoCopyCompressedMediaToClipboard,
  autoSaveCompressedMedia,
} from '../-save'
import { appProxy } from '../-state'

function CancelCompression() {
  const { t } = useTranslation()
  const {
    state: { isCompressing },
  } = useSnapshot(appProxy)

  const [confirmCancellation, setConfirmCancellation] = React.useState(false)
  const [isCancelling, setIsCancelling] = React.useState(false)
  const confirmTimeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  React.useEffect(() => {
    if (confirmCancellation) {
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmCancellation(false)
      }, 5000)
    }

    return () => {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current)
        confirmTimeoutRef.current = null
      }
    }
  }, [confirmCancellation])

  const cancelOngoingCompression = async () => {
    try {
      const appSnapShot = snapshot(appProxy)
      setIsCancelling(true)
      await emitTo('main', CustomEvents.CancelInProgressCompression, {
        ids: [
          appSnapShot.state.media[0]?.id, // for single-media mode
          appSnapShot.state.batchId,
        ],
      })
      // Media done before the cancellation, in any lane (see `compress_media_batch`)
      if (
        appProxy.state.media.length > 1 &&
        appProxy.state.media.some((mediaFile) => mediaFile.isProcessCompleted)
      ) {
        appProxy.timeTravel('batchCompressionStep')
        appProxy.state.isProcessCompleted = true
        appProxy.state.isCompressing = false
        appProxy.state.totalProgress = 100
        appProxy.state.isBatchCompressionCancelled = true
        // Save the media that finished before the cancellation, like a completed batch would be;
        // unfinished media has no output and is skipped
        await autoSaveCompressedMedia()
        await autoCopyCompressedMediaToClipboard()
      } else {
        appProxy.timeTravel('beforeCompressionStarted')
      }
    } catch {
      toast.error(t('compression.cannotCancel'))
    }
    setConfirmCancellation(false)
  }

  // ⌘+Shift+Enter acts like the Cancel button: the first press asks for confirmation, the second
  // cancels
  useCommandEnterShortcut(isCompressing && !isCancelling, () => {
    if (!confirmCancellation) {
      setConfirmCancellation(true)
    } else {
      cancelOngoingCompression()
    }
  })
  // Holding ⌘ (Ctrl) reveals the shortcut on the button
  const isCommandKeyHeld = useCommandKeyHeld(isCompressing && !isCancelling)

  return isCompressing ? (
    // Frosted glass like the controls beside it, in red; solid red (with the same finish) once it
    // asks to confirm
    <Button
      color={confirmCancellation ? 'danger' : 'default'}
      variant={confirmCancellation ? 'solid' : 'flat'}
      className={confirmCancellation ? undefined : 'text-danger'}
      onPress={() => {
        if (!confirmCancellation) {
          setConfirmCancellation(true)
        } else {
          cancelOngoingCompression()
        }
      }}
      isLoading={isCancelling}
      isDisabled={isCancelling}
      fullWidth
    >
      <AnimatedLabel>
        {confirmCancellation && !isCancelling
          ? t('compression.confirmCancel')
          : isCancelling
            ? t('compression.cancelling')
            : t('common.cancel')}
      </AnimatedLabel>
      <ShortcutHint isVisible={isCommandKeyHeld && !isCancelling} />
    </Button>
  ) : null
}

export default React.memo(CancelCompression)
