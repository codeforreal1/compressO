import { AnimatePresence, motion } from 'framer-motion'
import { cloneDeep } from 'lodash'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import { useSyncState } from '@/hooks/useSyncState'
import { slideDownTransition } from '@/utils/animation'
import {
  appProxy,
  normalizeBatchMediaConfig,
  videoConfigInitialState,
} from '../../../../-state'

type CompressionQualityProps = {
  mediaIndex: number
}

const videoConfigInitialStateCloned = cloneDeep(videoConfigInitialState)

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
  const video =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { quality: compressionQuality } =
    config ?? commonConfigForBatchCompression.videoConfig ?? {}

  const setQualityGlobal = useCallback(
    (value: number) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.quality = value
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.videoConfig.quality =
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
    defaultValue: videoConfigInitialStateCloned.quality ?? 50,
    debounceMs: 500,
  })

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <AnimatePresence mode="wait">
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
              value: 99,
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
            return val < 50 ? '低' : val >= 50 && val < 100 ? '中' : '高'
          }}
          renderValue={() => <p className="text-primary text-xs">{quality}%</p>}
          value={quality}
          onChange={(value) => {
            if (typeof value === 'number') {
              setQuality(value)
            }
          }}
          isDisabled={shouldDisableInput}
        />
      </motion.div>
    </AnimatePresence>
  )
}

export default CompressionQuality
