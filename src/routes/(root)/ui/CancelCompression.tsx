import { event } from '@tauri-apps/api'
import { emitTo } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { snapshot, useSnapshot } from 'valtio'

import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { CustomEvents, VideoCompressionProgress } from '@/types/compression'
import { convertDurationToMilliseconds } from '@/utils/string'
import { videoProxy } from '../-state'

function CancelCompression() {
  const {
    state: { isCompressing, videoDurationMilliseconds, id: videoId },
  } = useSnapshot(videoProxy)

  const [confirmCancellation, setConfirmCancellation] = React.useState(false)
  const [isCancelling, setIsCancelling] = React.useState(false)

  const compressionProgressRef = React.useRef<event.UnlistenFn>()

  React.useEffect(() => {
    if (videoDurationMilliseconds) {
      ;(async function iife() {
        if (compressionProgressRef.current) {
          compressionProgressRef.current?.()
        }
        compressionProgressRef.current =
          await event.listen<VideoCompressionProgress>(
            CustomEvents.VideoCompressionProgress,
            (evt) => {
              const payload = evt?.payload
              if (videoId === payload?.videoId) {
                const currentDurationInMilliseconds =
                  convertDurationToMilliseconds(payload?.currentDuration)
                if (
                  currentDurationInMilliseconds > 0 &&
                  videoDurationMilliseconds >= currentDurationInMilliseconds
                ) {
                  videoProxy.state.compressionProgress =
                    (currentDurationInMilliseconds * 100) /
                    videoDurationMilliseconds
                }
              }
            },
          )
      })()
    }

    return () => {
      compressionProgressRef.current?.()
    }
  }, [videoDurationMilliseconds, videoId])

  React.useEffect(() => {
    if (isCancelling) {
      compressionProgressRef.current?.()
    }
  }, [isCancelling])

  const cancelOngoingCompression = async () => {
    try {
      setIsCancelling(true)
      await emitTo('main', CustomEvents.CancelInProgressCompression, {
        videoId: snapshot(videoProxy).state.id,
      })
      videoProxy.timeTravel('beforeCompressionStarted')
    } catch {
      toast.error('Cannot cancel compression at this point.')
    }
    setConfirmCancellation(false)
  }

  return isCompressing ? (
    <Button
      color="danger"
      size="lg"
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
            ? 'Confirm Cancel'
            : isCancelling
              ? 'Cancelling...'
              : 'Cancel'}
        </motion.div>
      </AnimatePresence>
    </Button>
  ) : null
}

export default React.memo(CancelCompression)
