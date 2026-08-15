import { AnimatePresence, motion } from 'framer-motion'
import { cloneDeep } from 'lodash'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { useSyncState } from '@/hooks/useSyncState'
import {
  appProxy,
  imageConfigInitialState,
  normalizeBatchMediaConfig,
} from '@/routes/(root)/-state'
import { slideDownTransition } from '@/utils/animation'

type CompressionQualityProps = {
  mediaIndex: number
}

const imageConfigInitialStateCloned = cloneDeep(imageConfigInitialState)

function CompressionQuality({ mediaIndex }: CompressionQualityProps) {
  const {
    state: {
      isCompressing,
      isProcessCompleted,
      media,
      commonConfigForBatchCompression,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { quality: compressionQuality, isLossless } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const setQualityGlobal = useCallback(
    (value: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'image' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.quality = value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.imageConfig.quality =
            value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const [quality, setQuality] = useSyncState<number>({
    globalValue: compressionQuality ?? undefined,
    setGlobalValue: setQualityGlobal,
    defaultValue: imageConfigInitialStateCloned.quality,
    debounceMs: 500,
  })

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'image' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      appProxy.state.media[mediaIndex].config.isLossless =
        !appProxy.state.media[mediaIndex].config.isLossless
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.imageConfig.isLossless =
          !appProxy.state.commonConfigForBatchCompression.imageConfig.isLossless
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex])

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    image?.extension === 'svg'

  return (
    <>
      <Switch
        isSelected={isLossless}
        onValueChange={handleSwitchToggle}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          无损压缩
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {!isLossless ? (
          <motion.div {...slideDownTransition}>
            <Slider
              label="质量"
              aria-label="质量"
              marks={[
                {
                  value: 1,
                  label: '低',
                },
                {
                  value: 50,
                  label: '中',
                },
                {
                  value: 100,
                  label: '高',
                },
              ]}
              minValue={1}
              maxValue={100}
              className="mb-8 mt-1 mx-auto"
              classNames={{
                mark: 'text-[11px] mt-2',
                base: 'mt-[-10px]',
                label: 'text-xs',
              }}
              getValue={(value) => {
                const val = Array.isArray(value) ? value?.[0] : +value
                return val < 50 ? '低' : val >= 50 && val < 99 ? '中' : '高'
              }}
              renderValue={() => (
                <p className="text-primary text-xs">{quality}%</p>
              )}
              value={quality}
              onChange={(value) => {
                if (typeof value === 'number') {
                  setQuality(value)
                }
              }}
              isDisabled={isLossless || shouldDisableInput}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default CompressionQuality
