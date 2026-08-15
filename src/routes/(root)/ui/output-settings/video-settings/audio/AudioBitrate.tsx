import { SelectItem } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import Switch from '@/components/Switch'
import { slideDownTransition } from '@/utils/animation'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

const AUDIO_BITRATES = [
  { value: 64, label: '64 kbps' },
  { value: 96, label: '96 kbps' },
  { value: 128, label: '128 kbps' },
  { value: 160, label: '160 kbps' },
  { value: 192, label: '192 kbps' },
  { value: 256, label: '256 kbps' },
  { value: 320, label: '320 kbps' },
]

type AudioBitrateProps = {
  mediaIndex: number
}

function AudioBitrate({ mediaIndex }: AudioBitrateProps) {
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
  const { audioConfig, shouldEnableCustomBitrate, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      const videoConfig = appProxy.state.media[mediaIndex].config
      videoConfig.shouldEnableCustomBitrate = !shouldEnableCustomBitrate
      if (!shouldEnableCustomBitrate) {
        if (!videoConfig.audioConfig) {
          videoConfig.audioConfig = { volume: 100 }
        }
        videoConfig.audioConfig.bitrate = 128
      } else {
        if (videoConfig.audioConfig) {
          videoConfig.audioConfig.bitrate = null
        }
      }
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        const commonConfig =
          appProxy.state.commonConfigForBatchCompression.videoConfig
        commonConfig.shouldEnableCustomBitrate = !shouldEnableCustomBitrate
        if (!commonConfig.audioConfig) {
          commonConfig.audioConfig = { volume: 100 }
        }
        if (!shouldEnableCustomBitrate) {
          commonConfig.audioConfig.bitrate = 128
        } else {
          commonConfig.audioConfig.bitrate = null
        }
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableCustomBitrate])

  const handleBitrateChange = useCallback(
    (value: string) => {
      const bitrate = Number.parseInt(value, 10)
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        const videoConfig = appProxy.state.media[mediaIndex].config
        if (!videoConfig.audioConfig) {
          videoConfig.audioConfig = { volume: 100 }
        }
        videoConfig.audioConfig.bitrate = bitrate
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig =
              {
                volume: 100,
              }
          }
          appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.bitrate =
            bitrate
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    audioConfig?.volume === 0 ||
    convertToExtension === 'gif'

  const hasNoAudio = videoInfoRaw?.audioStreams?.length === 0
  const currentValue = audioConfig?.bitrate ?? 128

  return (
    <div>
      <Switch
        isSelected={shouldEnableCustomBitrate}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput || hasNoAudio}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          比特率
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomBitrate ? (
          <motion.div {...slideDownTransition}>
            <Select
              fullWidth
              label="比特率："
              className="block flex-shrink-0 rounded-2xl !mt-8"
              size="sm"
              value={currentValue?.toString() ?? '128'}
              selectedKeys={[currentValue?.toString() ?? '128']}
              onChange={(evt) => {
                const value = evt?.target?.value
                if (value) {
                  handleBitrateChange(value)
                }
              }}
              selectionMode="single"
              isDisabled={!shouldEnableCustomBitrate || shouldDisableInput}
              classNames={{
                label: '!text-gray-600 dark:!text-gray-400 text-xs',
              }}
            >
              {AUDIO_BITRATES.map((bitrate) => (
                <SelectItem key={bitrate.value} textValue={bitrate.label}>
                  {bitrate.label}
                </SelectItem>
              ))}
            </Select>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default AudioBitrate
