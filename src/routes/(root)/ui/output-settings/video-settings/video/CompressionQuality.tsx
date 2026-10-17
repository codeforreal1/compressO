import { cloneDeep } from 'lodash'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import { useSyncState } from '@/hooks/useSyncState'
import {
  appProxy,
  normalizeBatchMediaConfig,
  videoConfigInitialState,
} from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type CompressionQualityProps = {
  mediaIndex: number
  /** E.g. for an audio file with a bitrate chosen, which then sets its size */
  isDisabled?: boolean
}

const videoConfigInitialStateCloned = cloneDeep(videoConfigInitialState)

function CompressionQuality({
  mediaIndex,
  isDisabled,
}: CompressionQualityProps) {
  const { t } = useTranslation()
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
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { quality: compressionQuality } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}

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
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].quality = value
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const [quality, setQuality] = useSyncState<number>({
    globalValue: compressionQuality ?? undefined,
    setGlobalValue: setQualityGlobal,
    defaultValue: videoConfigInitialStateCloned.quality ?? 50,
    debounceMs: 500,
  })

  const shouldDisableInput =
    isDisabled ||
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    // Shown under Lossless Compression, which animates it in & out (see `CompressionPreset`)
    <div>
      <Slider
        label={t('quality.title')}
        aria-label={t('quality.title')}
        marks={[
          {
            value: 1,
            label: t('svg.levels.low'),
          },
          {
            value: 50,
            label: t('svg.levels.medium'),
          },
          {
            value: 99,
            label: t('svg.levels.high'),
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
          return val < 50
            ? t('svg.levels.low')
            : val >= 50 && val < 100
              ? t('svg.levels.medium')
              : t('svg.levels.high')
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
    </div>
  )
}

export default CompressionQuality
