import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Switch from '@/components/Switch'
import { slideDownTransition } from '@/utils/animation'
import CompressionQuality from './CompressionQuality'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type CompressionPresetProps = {
  mediaIndex: number
}

function CompressionPreset({ mediaIndex }: CompressionPresetProps) {
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      media,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const batchConfigKey = useBatchVideoConfigKey()
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { shouldDisableCompression } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.shouldDisableCompression =
        !shouldDisableCompression
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldDisableCompression = !shouldDisableCompression
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldDisableCompression, batchConfigKey])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  const isLossless = shouldDisableCompression

  return (
    <>
      <div className="flex items-center mb-4">
        <Switch
          isSelected={isLossless}
          onValueChange={handleSwitchToggle}
          className="flex justify-center items-center"
          isDisabled={shouldDisableInput}
          size="sm"
        >
          <div className="flex justify-center items-center">
            <span className="text-gray-600 dark:text-gray-400 block mr-2 text-sm">
              Lossless Compression
            </span>
          </div>
        </Switch>
      </div>
      <AnimatePresence mode="wait">
        {!isLossless ? (
          <motion.div {...slideDownTransition} className="pt-2">
            <div className="mt-[-10px]">
              <CompressionQuality mediaIndex={mediaIndex} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default CompressionPreset
