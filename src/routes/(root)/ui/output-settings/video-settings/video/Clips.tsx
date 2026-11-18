import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import StepperInput from '@/components/StepperInput'
import Switch from '@/components/Switch'
import UnitSwitch from '@/components/UnitSwitch'
import { slideDownTransition } from '@/utils/animation'
import { formatDuration } from '@/utils/string'
import {
  getClipCount,
  getClipsWarning,
  getOutputDuration,
  type MediaFile,
} from '../../../../-compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'

type ClipsProps = {
  mediaIndex: number
}

const MAX_CLIP_LENGTH_IN_MINUTES = 24 * 60

/** Splits the compressed video into clips, after every other setting is applied */
function Clips({ mediaIndex }: ClipsProps) {
  const { t } = useTranslation()
  const {
    state: {
      media,
      isCompressing,
      isProcessCompleted,
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
  const { shouldEnableClips, clipLengthInSeconds, convertToExtension } =
    config ?? commonConfigForBatchCompression[batchConfigKey] ?? {}
  // Shown in minutes by default; the unit can be toggled to seconds, like Target Size's MB & GB
  const [isInMinutes, setIsInMinutes] = useState(true)

  const isGif = convertToExtension === 'gif'
  const clipLength = clipLengthInSeconds ?? 60
  const unitScale = isInMinutes ? 60 : 1
  const warning = isGif
    ? ('clips.notAvailable' as const)
    : video
      ? getClipsWarning(video as MediaFile)
      : null
  const durationInSeconds = video
    ? getOutputDuration(video as MediaFile) / 1000
    : 0
  const clipCount = getClipCount(durationInSeconds, clipLength) || null
  const hasBatchWarning =
    !video &&
    !!shouldEnableClips &&
    media.some(
      (mediaFile) =>
        mediaFile.type === 'video' &&
        getClipsWarning(mediaFile as MediaFile) === 'clips.tooLong',
    )

  const handleSwitchToggle = useCallback(() => {
    if (
      mediaIndex >= 0 &&
      appProxy.state.media[mediaIndex].type === 'video' &&
      appProxy.state.media[mediaIndex]?.config
    ) {
      const videoConfig = appProxy.state.media[mediaIndex].config
      videoConfig.shouldEnableClips = !shouldEnableClips
      if (!videoConfig.clipLengthInSeconds) {
        videoConfig.clipLengthInSeconds = 60
      }
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      if (appProxy.state.media.length > 1) {
        const commonConfig =
          appProxy.state.commonConfigForBatchCompression[batchConfigKey]
        commonConfig.shouldEnableClips = !shouldEnableClips
        if (!commonConfig.clipLengthInSeconds) {
          commonConfig.clipLengthInSeconds = 60
        }
        normalizeBatchMediaConfig()
      }
    }
  }, [mediaIndex, shouldEnableClips, batchConfigKey])

  const handleLengthChange = useCallback(
    (value: number) => {
      const seconds = Math.round(value * (isInMinutes ? 60 : 1))
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'video' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.clipLengthInSeconds = seconds
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression[
            batchConfigKey
          ].clipLengthInSeconds = seconds
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex, batchConfigKey, isInMinutes],
  )

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <>
      <div className="flex w-full items-center gap-2">
        <Switch
          isSelected={shouldEnableClips}
          onValueChange={handleSwitchToggle}
          isDisabled={shouldDisableInput}
        >
          <span className="text-gray-600 dark:text-gray-400 text-sm mr-2">
            {t('clips.title')}
          </span>
        </Switch>
        {clipCount != null ? (
          <span className="ml-auto text-xs text-gray-600 dark:text-gray-400">
            {t('clips.count', { count: clipCount })}
          </span>
        ) : null}
      </div>
      <AnimatePresence mode="wait">
        {shouldEnableClips ? (
          <motion.div {...slideDownTransition} className="pt-3">
            <StepperInput
              aria-label={t('clips.length')}
              decreaseLabel={t('common.decrease')}
              increaseLabel={t('common.increase')}
              value={clipLength / unitScale}
              minValue={isInMinutes ? 0.1 : 1}
              maxValue={
                isInMinutes
                  ? MAX_CLIP_LENGTH_IN_MINUTES
                  : MAX_CLIP_LENGTH_IN_MINUTES * 60
              }
              step={1}
              decimals={isInMinutes ? 1 : 0}
              unit={
                <UnitSwitch
                  units={[t('clips.seconds'), t('clips.minutes')]}
                  isLarger={isInMinutes}
                  onToggle={() => setIsInMinutes((value) => !value)}
                  aria-label={t('clips.switchUnit', {
                    unit: isInMinutes ? t('clips.seconds') : t('clips.minutes'),
                  })}
                  disabled={shouldDisableInput || isGif}
                />
              }
              onChange={handleLengthChange}
              isDisabled={shouldDisableInput || isGif}
            />
            {warning ? (
              <p className="mt-2 text-xs text-warning-600 dark:text-warning-400">
                {t(warning, {
                  duration: durationInSeconds
                    ? formatDuration(durationInSeconds, {
                        disableMilliseconds: true,
                      })
                    : '',
                })}
              </p>
            ) : null}
            {hasBatchWarning ? (
              <p className="mt-2 text-xs text-warning-600 dark:text-warning-400">
                {t('clips.batchTooLong')}
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default Clips
