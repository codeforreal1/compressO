import { Checkbox } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { useSnapshot } from 'valtio'

import Switch from '@/components/Switch'
import { AudioStream } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { cn } from '@/utils/tailwind'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

type AudioTracksProps = {
  mediaIndex: number
}

function getLanguageFromTags(
  tags: readonly (readonly [string, string])[] | null,
): string {
  if (!tags) return '未知'
  const langTag = tags.find(([key]) => key.toLowerCase() === 'language')
  return langTag ? langTag[1] : '-'
}

function getTitleFromTags(
  tags: readonly (readonly [string, string])[] | null,
): string | null {
  if (!tags) return null
  const titleTag = tags.find(([key]) => key.toLowerCase() === 'title')
  return titleTag ? titleTag[1] : null
}

function AudioTracks({ mediaIndex }: AudioTracksProps) {
  if (mediaIndex < 0) return null

  const {
    state: {
      media,
      isCompressing,
      isProcessCompleted,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config, videoInfoRaw } = video ?? {}
  const {
    shouldEnableAudioTrackSelection,
    selectedAudioTracks,
    audioConfig,
    convertToExtension,
  } = config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const audioStreams = videoInfoRaw?.audioStreams ?? []

  useEffect(() => {
    if (
      shouldEnableAudioTrackSelection &&
      (!selectedAudioTracks || selectedAudioTracks.length === 0)
    ) {
      const allTrackIndices = audioStreams.map((_, index) => index)

      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks =
          allTrackIndices
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.selectedAudioTracks =
            allTrackIndices
          normalizeBatchMediaConfig()
        }
      }
    }
  }, [
    shouldEnableAudioTrackSelection,
    mediaIndex,
    audioStreams,
    selectedAudioTracks,
  ])

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldEnableAudioTrackSelection =
        !shouldEnableAudioTrackSelection
      appProxy.state.media[mediaIndex].isConfigDirty = true

      if (!shouldEnableAudioTrackSelection) {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks =
          audioStreams.map((_, index) => index)
      } else {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks = []
      }
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.videoConfig.shouldEnableAudioTrackSelection =
          !shouldEnableAudioTrackSelection
        if (!shouldEnableAudioTrackSelection) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.selectedAudioTracks =
            audioStreams.map((_, index) => index)
        } else {
          appProxy.state.commonConfigForBatchCompression.videoConfig.selectedAudioTracks =
            []
        }
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableAudioTrackSelection, audioStreams])

  const handleTrackToggle = useCallback(
    (trackIndex: number) => {
      const currentSelected = selectedAudioTracks ?? []
      const isSelected = currentSelected.includes(trackIndex)

      let newSelected: number[]
      if (isSelected) {
        if (currentSelected.length <= 1) return
        newSelected = currentSelected.filter((i) => i !== trackIndex)
      } else {
        newSelected = [...currentSelected, trackIndex]
      }

      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.selectedAudioTracks =
          newSelected
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.selectedAudioTracks =
            newSelected
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, selectedAudioTracks],
  )

  const hasNoAudio = audioStreams.length === 0

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    hasNoAudio ||
    audioConfig?.volume === 0 ||
    convertToExtension === 'gif'

  return (
    <>
      <Switch
        isSelected={shouldEnableAudioTrackSelection}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput || audioStreams.length === 0}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          音轨
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableAudioTrackSelection && audioStreams.length > 0 ? (
          <motion.div {...slideDownTransition} className="mt-1">
            <div className="w-full rounded-2xl overflow-hidden">
              {audioStreams.map((stream: AudioStream, index: number) => {
                const isSelected = (selectedAudioTracks ?? []).includes(index)
                const language = getLanguageFromTags(stream.tags)
                const title = getTitleFromTags(stream.tags)

                return (
                  <Checkbox
                    key={index}
                    isSelected={isSelected}
                    onValueChange={() => handleTrackToggle(index)}
                    isDisabled={
                      !shouldEnableAudioTrackSelection || shouldDisableInput
                    }
                    size="sm"
                    classNames={{
                      base: cn(
                        'inline-flex w-full max-w-md bg-content1',
                        'hover:bg-content2 items-center justify-start',
                        'cursor-pointer rounded-xl gap-2 p-4 py-2 pl-6 border-2 border-transparent',
                      ),
                      label: 'w-full',
                    }}
                    className="my-[2px]"
                  >
                    <div className="flex flex-col ml-2">
                      <span className="text-sm font-medium">
                        音轨 #{index + 1}
                        {title ? ` - ${title}` : ''}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {language ? `${language} • ` : ''}
                        {stream.codec.toUpperCase?.() ?? ''} • {stream.channels}{' '}
                        个声道
                      </span>
                    </div>
                  </Checkbox>
                )
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default AudioTracks
