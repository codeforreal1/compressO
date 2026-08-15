import { SelectItem } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect } from 'react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { slideDownTransition } from '@/utils/animation'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'

const FPS_LIST = [24, 25, 30, 50, 60] as const
const DEFAULT_FPS = 30

type VideoFPSProps = {
  mediaIndex: number
}

function FPS({ mediaIndex }: VideoFPSProps) {
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
  const { config, fps: videoFps } = video ?? {}
  const { shouldEnableCustomFPS, customFPS, convertToExtension } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      const isEnabled =
        appProxy.state.media[mediaIndex].config.shouldEnableCustomFPS
      appProxy.state.media[mediaIndex].config.shouldEnableCustomFPS = !isEnabled
      appProxy.state.media[mediaIndex].isConfigDirty = true
      if (!isEnabled && !appProxy.state.media[mediaIndex].config.customFPS) {
        appProxy.state.media[mediaIndex].config.customFPS =
          appProxy.state.media[mediaIndex].fps ?? DEFAULT_FPS
      }
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.videoConfig.shouldEnableCustomFPS =
          !appProxy.state.commonConfigForBatchCompression.videoConfig
            .shouldEnableCustomFPS
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex])

  const handleValueChange = useCallback(
    (value: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.customFPS = +value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.customFPS =
            +value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const isGifTarget = convertToExtension === 'gif'

  useEffect(() => {
    if (!isGifTarget) {
      if (mediaIndex >= 0) {
        if (
          appProxy.state.media[mediaIndex].type === 'video' &&
          !FPS_LIST.includes(
            appProxy.state.media[mediaIndex].config.customFPS as any,
          )
        ) {
          appProxy.state.media[mediaIndex].config.customFPS =
            appProxy.state.media[mediaIndex].fps ?? DEFAULT_FPS
        }
      }
    }
  }, [isGifTarget, mediaIndex])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  const initialFpsValue = customFPS ?? videoFps ?? DEFAULT_FPS

  return (
    <>
      <Switch
        isSelected={shouldEnableCustomFPS}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          帧率
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomFPS ? (
          <motion.div {...slideDownTransition}>
            {isGifTarget ? (
              <Slider
                label=" "
                size="lg"
                step={1}
                minValue={1}
                maxValue={60}
                value={initialFpsValue}
                onChange={(val) => {
                  if (!Array.isArray(val)) {
                    handleValueChange(val)
                  }
                }}
                isDisabled={!shouldEnableCustomFPS || shouldDisableInput}
                className="w-full"
                classNames={{
                  label: 'text-gray-600 dark:text-gray-400 text-sm',
                  value: 'text-xs',
                }}
              />
            ) : (
              <Select
                fullWidth
                label="每秒帧数："
                className="block flex-shrink-0 rounded-2xl !mt-8"
                selectedKeys={[String(initialFpsValue)!]}
                size="sm"
                value={String(initialFpsValue)}
                onChange={(evt) => {
                  const value = evt?.target?.value
                  if (value && !Number.isNaN(+value)) {
                    handleValueChange(+value)
                  }
                }}
                selectionMode="single"
                isDisabled={!shouldEnableCustomFPS || shouldDisableInput}
                classNames={{
                  label: '!text-gray-600 dark:!text-gray-400 text-xs',
                }}
              >
                {FPS_LIST?.map((f) => (
                  <SelectItem
                    key={String(f)}
                    textValue={String(f)}
                    className="flex justify-center items-center"
                  >
                    {String(f)}
                  </SelectItem>
                ))}
              </Select>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default FPS
