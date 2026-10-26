import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import StepperInput from '@/components/StepperInput'
import ToggleSection from '@/components/ToggleSection'
import Tooltip from '@/components/Tooltip'
import UnitSwitch from '@/components/UnitSwitch'
import { getAudioFileOutputExtension } from '@/types/compression'
import {
  MAX_AUDIO_TARGET_SIZE_IN_MB,
  MIN_AUDIO_TARGET_SIZE_IN_MB,
  supportsAudioTargetSize,
} from '@/utils/audioTargetSize'
import { cn } from '@/utils/tailwind'
import {
  getAudioTargetSizePlan,
  getAudioTargetSizeWarning,
  type MediaFile,
} from '../../../../-compression'
import { appProxy, normalizeBatchMediaConfig } from '../../../../-state'
import { useBatchVideoConfigKey } from '../-batchConfig'
import CompressionQuality from '../video/CompressionQuality'

/** Settings for audio-only outputs, including audio extracted from a video. */
function AudioCompression({ mediaIndex }: { mediaIndex: number }) {
  const { t } = useTranslation()
  const { state } = useSnapshot(appProxy)
  const batchKey = useBatchVideoConfigKey()
  const file =
    mediaIndex >= 0 && state.media[mediaIndex]?.type === 'video'
      ? state.media[mediaIndex]
      : null
  const config = file?.config ?? state.commonConfigForBatchCompression[batchKey]
  const disabled =
    state.isCompressing ||
    state.isProcessCompleted ||
    state.isLoadingMediaFiles ||
    state.media.length === 0
  const size = config.targetSizeInMB ?? 10
  const [inMB, setInMB] = useState(true)
  const scale = inMB ? 1 : 0.001
  const update = (values: {
    shouldUseTargetSize?: boolean
    targetSizeInMB?: number
  }) => {
    if (mediaIndex >= 0 && appProxy.state.media[mediaIndex]?.type === 'video') {
      Object.assign(appProxy.state.media[mediaIndex].config, values)
      appProxy.state.media[mediaIndex].isConfigDirty = true
    } else {
      Object.assign(
        appProxy.state.commonConfigForBatchCompression[batchKey],
        values,
      )
      normalizeBatchMediaConfig()
    }
  }
  const extension =
    config.convertToExtension === '-'
      ? file
        ? getAudioFileOutputExtension(file.extension)
        : 'mp3'
      : config.convertToExtension
  const supported = supportsAudioTargetSize(
    extension,
    config.shouldEnableCustomAudioCodec ? config.audioConfig?.audioCodec : null,
  )
  // "Same as input" batches can contain both lossy and lossless outputs. Keep the batch
  // slider available if it applies to any file; a lossless file's own slider stays disabled.
  const qualitySupported =
    !file && config.convertToExtension === '-'
      ? state.media.some(
          (item) =>
            item.type === 'video' &&
            (batchKey === 'audioFileConfig'
              ? item.isAudioFile
              : !item.isAudioFile) &&
            supportsAudioTargetSize(
              item.config.convertToExtension === '-'
                ? getAudioFileOutputExtension(item.extension)
                : item.config.convertToExtension,
              item.config.shouldEnableCustomAudioCodec
                ? item.config.audioConfig?.audioCodec
                : null,
            ),
        )
      : supported
  const qualityExplanation = t('quality.unsupportedAudio')
  const plan = file
    ? getAudioTargetSizePlan(appProxy.state.media[mediaIndex])
    : null
  const warning = !supported
    ? ('targetSize.audioLossless' as const)
    : file
      ? getAudioTargetSizeWarning(file as MediaFile)
      : state.media
          .filter(
            (item) =>
              item.type === 'video' &&
              (batchKey === 'audioFileConfig'
                ? item.isAudioFile
                : !item.isAudioFile),
          )
          .map((item) => getAudioTargetSizeWarning(item as MediaFile))
          .find(Boolean)
  const message = warning
    ? t(warning)
    : plan
      ? t('targetSize.audioEstimate', { bitrate: plan.bitrate })
      : t('targetSize.eachAudio')

  return (
    <ToggleSection
      aria-label={t('targetSize.mode')}
      value={config.shouldUseTargetSize ? 'size' : 'quality'}
      onChange={(mode) => update({ shouldUseTargetSize: mode === 'size' })}
      isDisabled={disabled}
      options={[
        {
          value: 'quality',
          label: t('targetSize.modes.quality'),
          content: (
            <Tooltip
              content={qualityExplanation}
              isDisabled={qualitySupported}
              delay={0}
              className="text-warning-600 dark:text-warning-400"
            >
              <div
                tabIndex={!qualitySupported ? 0 : undefined}
                aria-label={!qualitySupported ? qualityExplanation : undefined}
                className={!qualitySupported ? 'cursor-not-allowed' : undefined}
              >
                <CompressionQuality
                  mediaIndex={mediaIndex}
                  isDisabled={
                    !qualitySupported || !!config.shouldEnableCustomBitrate
                  }
                />
              </div>
            </Tooltip>
          ),
        },
        {
          value: 'size',
          label: t('targetSize.modes.size'),
          content: (
            <div>
              <StepperInput
                aria-label={t('targetSize.size')}
                decreaseLabel={t('common.decrease')}
                increaseLabel={t('common.increase')}
                value={size / scale}
                minValue={MIN_AUDIO_TARGET_SIZE_IN_MB / scale}
                maxValue={MAX_AUDIO_TARGET_SIZE_IN_MB / scale}
                step={inMB ? 0.1 : 10}
                decimals={inMB ? 3 : 0}
                unit={
                  <UnitSwitch
                    units={['KB', 'MB']}
                    isLarger={inMB}
                    onToggle={() => setInMB(!inMB)}
                    disabled={disabled}
                    aria-label={t('targetSize.switchUnit', {
                      unit: inMB ? 'KB' : 'MB',
                    })}
                  />
                }
                onChange={(value) =>
                  update({
                    targetSizeInMB: Math.round(value * scale * 1000) / 1000,
                  })
                }
                isDisabled={disabled || !supported}
              />
              <p
                className={cn(
                  'mt-2 text-xs',
                  warning
                    ? 'text-warning-600 dark:text-warning-400'
                    : 'text-zinc-500 dark:text-zinc-400',
                )}
                role="status"
              >
                {message}
              </p>
            </div>
          ),
        },
      ]}
    />
  )
}

export default AudioCompression
