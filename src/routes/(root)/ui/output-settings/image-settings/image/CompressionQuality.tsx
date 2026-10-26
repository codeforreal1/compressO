import { AnimatePresence, motion } from 'framer-motion'
import { cloneDeep } from 'lodash'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import ToggleSection from '@/components/ToggleSection'
import { useSyncState } from '@/hooks/useSyncState'
import {
  appProxy,
  imageConfigInitialState,
  normalizeBatchMediaConfig,
} from '@/routes/(root)/-state'
import { slideDownTransition } from '@/utils/animation'
import TargetSize from './TargetSize'

type CompressionQualityProps = {
  mediaIndex: number
}

const imageConfigInitialStateCloned = cloneDeep(imageConfigInitialState)

/** Compresses by quality (or losslessly), or to a file size (see `TargetSize`) */
function CompressionQuality({ mediaIndex }: CompressionQualityProps) {
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
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'image'
      ? media[mediaIndex]
      : null
  const { shouldUseTargetSize } =
    image?.config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const setTargetSizeMode = useCallback(
    (isTargetSize: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'image' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.shouldUseTargetSize =
          isTargetSize
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression.imageConfig.shouldUseTargetSize =
          isTargetSize
        normalizeBatchMediaConfig()
      }
    },
    [mediaIndex],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles ||
    image?.extension === 'svg'

  return (
    <ToggleSection
      aria-label={t('targetSize.mode')}
      options={[
        {
          value: 'quality',
          label: t('targetSize.modes.quality'),
          content: <QualitySettings mediaIndex={mediaIndex} />,
        },
        {
          value: 'size',
          label: t('targetSize.modes.size'),
          content: <TargetSize mediaIndex={mediaIndex} />,
        },
      ]}
      value={shouldUseTargetSize ? 'size' : 'quality'}
      onChange={(mode) => setTargetSizeMode(mode === 'size')}
      isDisabled={shouldDisableInput}
    />
  )
}

/** The lossless switch & the quality */
function QualitySettings({ mediaIndex }: CompressionQualityProps) {
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
          {t('quality.lossless')}
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {!isLossless ? (
          <motion.div {...slideDownTransition}>
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
                  value: 100,
                  label: t('svg.levels.high'),
                },
              ]}
              minValue={1}
              maxValue={100}
              className="mb-8 mt-2 mx-auto"
              classNames={{
                mark: 'text-[11px] mt-2',
                label: 'text-xs',
              }}
              getValue={(value) => {
                const val = Array.isArray(value) ? value?.[0] : +value
                return val < 50
                  ? t('svg.levels.low')
                  : val >= 50 && val < 99
                    ? t('svg.levels.medium')
                    : t('svg.levels.high')
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
