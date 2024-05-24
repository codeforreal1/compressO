'use client'

import React from 'react'
import { event } from '@tauri-apps/api'
import { AnimatePresence, motion } from 'framer-motion'
import { snapshot, useSnapshot } from 'valtio'
import { emitTo } from '@tauri-apps/api/event'

import Progress from '@/components/Progress'
import Image from '@/components/Image'
import { CustomEvents, VideoCompressionProgress } from '@/types/compression'
import { convertDurationToMilliseconds } from '@/utils/string'
import Button from '@/components/Button'
import { toast } from '@/components/Toast'
import { videoProxy } from '../state'

function Compressing() {
  const {
    state: {
      isCompressing,
      videDurationRaw,
      thumbnailPath,
      config,
      videoDurationMilliseconds,
      compressionProgress,
      id: videoId,
    },
  } = useSnapshot(videoProxy)
  const { convertToExtension, shouldDisableCompression } = config

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
    setIsCancelling(false)
    setConfirmCancellation(false)
  }

  return isCompressing ? (
    <motion.div
      className="relative flex-shrink-0 w-[500px] h-[500px]"
      initial={{ scale: 0.9 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', duration: 0.6 }}
    >
      <Progress
        {...(videDurationRaw == null
          ? { isIndeterminate: true }
          : { value: compressionProgress })}
        classNames={{
          base: 'absolute top-0 left-0 translate-x-[-25px] translate-y-[-25px]',
          svg: 'w-[500px] h-[500px] drop-shadow-md',
          indicator: 'stroke-primary stroke-1',
          track: 'stroke-transparent stroke-1',
          value: 'text-3xl font-semibold text-primary',
        }}
        strokeWidth={2}
        aria-label={`Progress-${compressionProgress}%`}
        isDisabled={isCancelling}
      />
      <Image
        alt="video to compress"
        src={thumbnailPath as string}
        className="max-w-[60vw] max-h-[40vh] object-cover rounded-3xl"
        style={{
          width: '450px',
          height: '450px',
          minWidth: '450px',
          minHeight: '450px',
          borderRadius: '50%',
          transform: 'scale(0.92)',
          flexShrink: 0,
        }}
      />
      <p className="italic text-sm mt-4 text-gray-600 dark:text-gray-400 text-center animate-pulse">
        {!shouldDisableCompression ? 'Compressing' : 'Converting'}
        ...
        {convertToExtension === 'webm' ? (
          <span className="block">
            webm conversion takes longer than the other formats.
          </span>
        ) : null}
      </p>
      <p
        className={`not-italic text-xl text-center font-bold text-primary my-1 opacity-${
          compressionProgress && compressionProgress > 0 ? 1 : 0
        }`}
      >
        {compressionProgress?.toFixed(2)}%
      </p>
      <div className="flex justify-center mt-8">
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
              size="sm"
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
      </div>
    </motion.div>
  ) : (
    <Image
      alt="video to compress"
      src={thumbnailPath as string}
      className="max-w-[60vw] max-h-[40vh] object-contain border-8 rounded-3xl border-primary"
    />
  )
}

export default React.memo(Compressing)
