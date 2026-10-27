import { AnimatePresence, motion } from 'framer-motion'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Switch from '@/components/Switch'
import ToggleSection from '@/components/ToggleSection'
import { slideDownTransition } from '@/utils/animation'
import CompressionQuality from './CompressionQuality'
import TargetSize from './TargetSize'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type CompressionPresetProps = {
  mediaIndex: number
}

function CompressionPreset({ mediaIndex }: CompressionPresetProps) {
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
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { shouldDisableCompression, shouldUseTargetSize } =
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

  /** Compresses by quality (as before), or to a file size */
  const setTargetSizeMode = useCallback(
    (isTargetSize: boolean) => {
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.shouldUseTargetSize =
          isTargetSize
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else if (appProxy.state.media.length > 1) {
        appProxy.state.commonConfigForBatchCompression[
          batchConfigKey
        ].shouldUseTargetSize = isTargetSize
        normalizeBatchMediaConfig()
      }
    },
    [mediaIndex, batchConfigKey],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  const isLossless = shouldDisableCompression

  return (
    <>
      <ToggleSection
        aria-label={t('targetSize.mode')}
        options={[
          {
            value: 'quality',
            label: t('targetSize.modes.quality'),
            content: (
              <QualitySettings
                isLossless={!!isLossless}
                onLosslessChange={handleSwitchToggle}
                isDisabled={shouldDisableInput}
                mediaIndex={mediaIndex}
              />
            ),
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
    </>
  )
}

type QualitySettingsProps = {
  isLossless: boolean
  onLosslessChange: () => void
  isDisabled: boolean
  mediaIndex: number
}

/** Lossless compression, or the quality (compressing by quality, as before target sizes) */
function QualitySettings({
  isLossless,
  onLosslessChange,
  isDisabled,
  mediaIndex,
}: QualitySettingsProps) {
  const { t } = useTranslation()
  const handleSwitchToggle = onLosslessChange
  const shouldDisableInput = isDisabled
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
              {t('quality.lossless')}
            </span>
          </div>
        </Switch>
      </div>
      <AnimatePresence mode="wait">
        {!isLossless ? (
          <motion.div {...slideDownTransition} className="pt-2">
            <div>
              <CompressionQuality mediaIndex={mediaIndex} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default CompressionPreset
