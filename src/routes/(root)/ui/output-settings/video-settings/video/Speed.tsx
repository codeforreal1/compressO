import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { appProxy, normalizeBatchMediaConfig } from '@/routes/(root)/-state'
import { slideDownTransition } from '@/utils/animation'
import { useBatchVideoConfigKey } from '../-batchConfig'

type VideoSpeedProps = {
  mediaIndex: number
}

const SPEED_OPTIONS = [0.25, 1, 2, 3, 4] as const
const DEFAULT_SPEED = 1

const VideoSpeed = ({ mediaIndex }: VideoSpeedProps) => {
  const {
    state: {
      media,
      commonConfigForBatchCompression,
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const batchConfigKey = useBatchVideoConfigKey()
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { shouldEnableCustomSpeed, customSpeed } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      const isEnabled =
        appProxy.state.media[mediaIndex].config.shouldEnableCustomSpeed
      appProxy.state.media[mediaIndex].config.shouldEnableCustomSpeed =
        !isEnabled
      appProxy.state.media[mediaIndex].isConfigDirty = true
      if (
        !isEnabled &&
        appProxy.state.media[mediaIndex].config.customSpeed === undefined
      ) {
        appProxy.state.media[mediaIndex].config.customSpeed = DEFAULT_SPEED
      }
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldEnableCustomSpeed =
          !appProxy.state.commonConfigForBatchCompression[batchConfigKey]
            .shouldEnableCustomSpeed
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, batchConfigKey])

  const handleValueChange = useCallback(
    (value: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.customSpeed = +value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].customSpeed = +value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  const initialSpeedValue = customSpeed ?? DEFAULT_SPEED

  return (
    <>
      <Switch
        isSelected={shouldEnableCustomSpeed}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          Speed
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomSpeed ? (
          <motion.div {...slideDownTransition}>
            <Slider
              label=" "
              step={0.01}
              minValue={0.25}
              maxValue={4}
              value={initialSpeedValue}
              marks={SPEED_OPTIONS.map((value) => ({
                value,
                label: `${value}x`,
              }))}
              onChange={(val) => {
                if (!Array.isArray(val)) {
                  handleValueChange(val)
                }
              }}
              isDisabled={!shouldEnableCustomSpeed || shouldDisableInput}
              className="w-full mb-8"
              classNames={{
                label: 'text-gray-600 dark:text-gray-400 text-sm',
                mark: '!text-xs mt-2',
                value: 'text-xs',
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default VideoSpeed
