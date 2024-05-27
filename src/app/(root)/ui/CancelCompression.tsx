'use client'

import React from 'react'
import { event } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import { snapshot, useSnapshot } from 'valtio'
import { emitTo } from '@tauri-apps/api/event'

import { CustomEvents, VideoCompressionProgress } from '@/types/compression'
import { convertDurationToMilliseconds } from '@/utils/string'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { videoProxy } from '../state'

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
    } catch (error) {
      toast.error('Cannot cancel compression at this point.')
    }
    setConfirmCancellation(false)
  }

  return isCompressing ? (
    <AnimatePresence mode="wait">
      <motion.div
        layout="preserve-aspect"
        className="flex items-center"
        transition={{
          type: 'spring',
          bounce: 0.2,
          duration: 0.4,
        }}
      >
        <Button
          color="danger"
          size="lg"
          variant={confirmCancellation ? 'solid' : 'flat'}
          onClick={() => {
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
          <motion.div layout="preserve-aspect">
            {confirmCancellation && !isCancelling
              ? 'Confirm Cancel'
              : isCancelling
                ? 'Cancelling...'
                : 'Cancel'}
          </motion.div>
        </Button>
      </motion.div>
    </AnimatePresence>
  ) : null
}

export default React.memo(CancelCompression)
