import { SelectItem } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Checkbox from '@/components/Checkbox'
import Divider from '@/components/Divider'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import { slideDownTransition } from '@/utils/animation'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

type AudioChannelsProps = {
  mediaIndex: number
}

function AudioChannels({ mediaIndex }: AudioChannelsProps) {
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
  const { audioConfig, shouldEnableCustomChannel, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      const videoConfig = appProxy.state.media[mediaIndex].config
      videoConfig.shouldEnableCustomChannel = !shouldEnableCustomChannel
      if (!shouldEnableCustomChannel) {
        if (!videoConfig.audioConfig) {
          videoConfig.audioConfig = { volume: 100 }
        }
        videoConfig.audioConfig.audioChannelConfig = {
          channelLayout: 'stereo',
        }
      } else {
        if (videoConfig.audioConfig) {
          videoConfig.audioConfig.audioChannelConfig = null
        }
      }
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        const commonConfig =
          appProxy.state.commonConfigForBatchCompression.videoConfig
        commonConfig.shouldEnableCustomChannel = !shouldEnableCustomChannel
        if (!commonConfig.audioConfig) {
          commonConfig.audioConfig = { volume: 100 }
        }
        if (!shouldEnableCustomChannel) {
          commonConfig.audioConfig.audioChannelConfig = {
            channelLayout: 'stereo',
          }
        } else {
          commonConfig.audioConfig.audioChannelConfig = null
        }
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableCustomChannel])

  const handleChannelLayoutChange = useCallback(
    (value: string) => {
      const newLayout = value as 'mono' | 'stereo'

      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        const videoConfig = appProxy.state.media[mediaIndex].config
        if (!videoConfig.audioConfig) {
          videoConfig.audioConfig = { volume: 100 }
        }
        if (newLayout === 'mono') {
          videoConfig.audioConfig.audioChannelConfig = {
            channelLayout: newLayout,
            monoSource: { left: true, right: true },
          }
        } else {
          videoConfig.audioConfig.audioChannelConfig = {
            channelLayout: newLayout,
            stereoSwapChannels: false,
          }
        }
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
          if (newLayout === 'mono') {
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioChannelConfig =
              {
                channelLayout: newLayout,
                monoSource: { left: true, right: true },
              }
          } else {
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioChannelConfig =
              {
                channelLayout: newLayout,
                stereoSwapChannels: false,
              }
          }
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const handleMonoLeftChange = useCallback(
    (isSelected: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        const videoConfig = appProxy.state.media[mediaIndex].config
        if (!videoConfig.audioConfig.audioChannelConfig) {
          videoConfig.audioConfig.audioChannelConfig = {
            channelLayout: 'mono',
          }
        }
        if (!videoConfig.audioConfig.audioChannelConfig.monoSource) {
          videoConfig.audioConfig.audioChannelConfig.monoSource = {
            left: true,
            right: true,
          }
        }
        videoConfig.audioConfig.audioChannelConfig.monoSource!.left = isSelected
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig.audioChannelConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioChannelConfig =
              {
                channelLayout: 'mono',
              }
          }
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig.audioChannelConfig!.monoSource
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig.audioChannelConfig!.monoSource = {
              left: true,
              right: true,
            }
          }
          appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig
            .audioChannelConfig!.monoSource!.left = isSelected
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const handleMonoRightChange = useCallback(
    (isSelected: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        const videoConfig = appProxy.state.media[mediaIndex].config
        if (!videoConfig.audioConfig.audioChannelConfig) {
          videoConfig.audioConfig.audioChannelConfig = {
            channelLayout: 'mono',
          }
        }
        if (!videoConfig.audioConfig.audioChannelConfig.monoSource) {
          videoConfig.audioConfig.audioChannelConfig.monoSource = {
            left: true,
            right: true,
          }
        }
        videoConfig.audioConfig.audioChannelConfig.monoSource!.right =
          isSelected
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig.audioChannelConfig
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioChannelConfig =
              {
                channelLayout: 'mono',
              }
          }
          if (
            !appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig.audioChannelConfig!.monoSource
          ) {
            appProxy.state.commonConfigForBatchCompression.videoConfig
              .audioConfig.audioChannelConfig!.monoSource = {
              left: true,
              right: true,
            }
          }
          appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig
            .audioChannelConfig!.monoSource!.right = isSelected
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const handleStereoSwapChange = useCallback(() => {
    const currentConfig =
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
        ? appProxy.state.media[mediaIndex].config.audioConfig
            ?.audioChannelConfig
        : appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig
            ?.audioChannelConfig

    const newValue = !currentConfig?.stereoSwapChannels

    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      const videoConfig = appProxy.state.media[mediaIndex].config
      if (!videoConfig.audioConfig.audioChannelConfig) {
        videoConfig.audioConfig.audioChannelConfig = {
          channelLayout: 'stereo',
        }
      }
      videoConfig.audioConfig.audioChannelConfig.stereoSwapChannels = newValue
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        if (
          !appProxy.state.commonConfigForBatchCompression.videoConfig
            .audioConfig.audioChannelConfig
        ) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig.audioChannelConfig =
            {
              channelLayout: 'stereo',
            }
        }
        appProxy.state.commonConfigForBatchCompression.videoConfig.audioConfig
          .audioChannelConfig!.stereoSwapChannels = newValue
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    audioConfig?.volume === 0 ||
    convertToExtension === 'gif'

  const hasNoAudio = videoInfoRaw?.audioStreams?.length === 0

  return (
    <div>
      <Switch
        isSelected={shouldEnableCustomChannel}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput || hasNoAudio}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          声道
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomChannel ? (
          <motion.div {...slideDownTransition}>
            <Select
              fullWidth
              label="布局："
              className="block flex-shrink-0 rounded-2xl !mt-8"
              size="sm"
              value={audioConfig?.audioChannelConfig?.channelLayout ?? 'stereo'}
              selectedKeys={[
                audioConfig?.audioChannelConfig?.channelLayout ?? 'stereo',
              ]}
              onChange={(evt) => {
                const value = evt?.target?.value
                if (value) {
                  handleChannelLayoutChange(value)
                }
              }}
              selectionMode="single"
              isDisabled={!shouldEnableCustomChannel || shouldDisableInput}
              classNames={{
                label: '!text-gray-600 dark:!text-gray-400 text-xs',
              }}
            >
              <SelectItem key="mono" textValue="单声道">
                单声道
              </SelectItem>
              <SelectItem key="stereo" textValue="立体声">
                立体声
              </SelectItem>
            </Select>
            <AnimatePresence mode="wait">
              {audioConfig?.audioChannelConfig?.channelLayout === 'mono' ? (
                <motion.div {...slideDownTransition} className="mt-4">
                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                    Mono Source:
                  </p>
                  <div className="flex gap-4">
                    <Checkbox
                      isSelected={
                        audioConfig?.audioChannelConfig?.monoSource?.left ??
                        true
                      }
                      onValueChange={handleMonoLeftChange}
                      isDisabled={shouldDisableInput}
                    >
                      <span className="text-sm">左声道</span>
                    </Checkbox>
                    <Divider orientation="vertical" className="h-5" />
                    <Checkbox
                      isSelected={
                        audioConfig?.audioChannelConfig?.monoSource?.right ??
                        true
                      }
                      onValueChange={handleMonoRightChange}
                      isDisabled={shouldDisableInput}
                    >
                      <span className="text-sm">右声道</span>
                    </Checkbox>
                  </div>
                </motion.div>
              ) : null}
              {audioConfig?.audioChannelConfig?.channelLayout === 'stereo' ? (
                <motion.div {...slideDownTransition} className="mt-4">
                  <Switch
                    isSelected={
                      audioConfig?.audioChannelConfig?.stereoSwapChannels ??
                      false
                    }
                    onValueChange={handleStereoSwapChange}
                    isDisabled={shouldDisableInput}
                  >
                    <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
                      交换左右声道
                    </p>
                  </Switch>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default AudioChannels
