import { emitTo } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { CustomEvents } from '@/types/compression'
import { appProxy } from '../-state'

function CancelCompression() {
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
      if (
        appProxy.state.media.length > 1 &&
        appProxy.state.currentMediaIndex > 0
      ) {
        appProxy.timeTravel('batchCompressionStep')
        appProxy.state.isProcessCompleted = true
        appProxy.state.isCompressing = false
        appProxy.state.totalProgress = 100
        appProxy.state.isBatchCompressionCancelled = true
      } else {
        appProxy.timeTravel('beforeCompressionStarted')
      }
    } catch {
      toast.error('当前无法取消压缩。')
    }
    setConfirmCancellation(false)
  }

  return isCompressing ? (
    <Button
      color="danger"
      variant={confirmCancellation ? 'solid' : 'flat'}
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
      <AnimatePresence mode="wait">
        <motion.div layout="preserve-aspect">
          {confirmCancellation && !isCancelling
            ? '确认取消'
            : isCancelling
              ? '正在取消……'
              : '取消'}
        </motion.div>
      </AnimatePresence>
    </Button>
  ) : null
}

export default React.memo(CancelCompression)
