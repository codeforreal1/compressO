import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Divider from '@/components/Divider'
import InfoTooltip from '@/components/InfoTooltip'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { appProxy, normalizeBatchMediaConfig } from '@/routes/(root)/-state'
import type { VideoConfig } from '@/types/app'
import { MAX_HDR_BOOST_INTENSITY } from '@/utils/imageDynamicRange'
import { getVideoHdrOutput } from '@/utils/videoDynamicRange'
import { useBatchVideoConfigKey } from '../-batchConfig'

type DynamicRangeProps = { mediaIndex: number }

/** HDR Boost for SDR videos, Remove HDR for HDR videos (see `video_dynamic_range.rs`) */
function DynamicRange({ mediaIndex }: DynamicRangeProps) {
  const { t } = useTranslation()
  const { state } = useSnapshot(appProxy)
  const batchConfigKey = useBatchVideoConfigKey()
  const selected = state.media[mediaIndex]
  const video = selected?.type === 'video' ? selected : null
  const videos = video
    ? [video]
    : state.media.filter((item) => item.type === 'video' && !item.isAudioFile)
  if (!videos.length || !videos.some((item) => item.dynamicRangeInfo)) {
    return null
  }

  const ranges = new Set(
    videos.map((item) => item.dynamicRangeInfo?.dynamicRange ?? 'unknown'),
  )
  const range = ranges.size === 1 ? [...ranges][0] : 'mixed'
  const config = (video?.config ??
    state.commonConfigForBatchCompression[batchConfigKey]) as VideoConfig
  const mode = range === 'sdr' ? 'boost' : range === 'hdr' ? 'sdr' : null
  const outputs = videos.map((item) =>
    getVideoHdrOutput(config, item.extension),
  )
  // HDR sources whose output cannot hold HDR are always converted to SDR
  const isSdrOnly =
    mode === 'sdr' &&
    outputs.every((output) => !output.canHoldHdr && !output.isLossless)
  const boostLimit =
    mode !== 'boost'
      ? null
      : outputs.some((output) => !output.canHoldHdr)
        ? 'dynamicRange.videoBoostFormats'
        : outputs.some((output) => output.isLossless)
          ? 'dynamicRange.videoBoostLossless'
          : null
  const enabled =
    isSdrOnly ||
    (!boostLimit && mode !== null && config.dynamicRange?.mode === mode)
  const storedIntensity = config.dynamicRange?.intensity ?? 2
  const intensity = Number.isFinite(storedIntensity)
    ? Math.min(MAX_HDR_BOOST_INTENSITY, Math.max(1, storedIntensity))
    : 2
  const disabled =
    state.isCompressing || state.isProcessCompleted || state.isLoadingMediaFiles

  const update = (change: (target: VideoConfig) => void) => {
    const target = appProxy.state.media[mediaIndex]
    if (target?.type === 'video') {
      change(target.config)
      target.isConfigDirty = true
    } else {
      change(appProxy.state.commonConfigForBatchCompression[batchConfigKey])
      normalizeBatchMediaConfig()
    }
  }

  return (
    <>
      <Divider className="my-3" />
      {mode ? (
        <>
          <div className="flex items-center">
            <Switch
              isSelected={enabled}
              isDisabled={disabled || isSdrOnly || !!boostLimit}
              onValueChange={(value) =>
                update((target) => {
                  target.dynamicRange = {
                    mode: value ? mode : 'original',
                    intensity,
                  }
                })
              }
            >
              <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
                {t(
                  mode === 'boost'
                    ? 'dynamicRange.boost'
                    : 'dynamicRange.convert',
                )}
              </p>
            </Switch>
            <InfoTooltip
              content={
                isSdrOnly
                  ? t('dynamicRange.videoSdrOnly')
                  : boostLimit
                    ? t(boostLimit)
                    : null
              }
            />
          </div>
          {enabled && mode === 'boost' ? (
            <Slider
              label={t('dynamicRange.intensity')}
              aria-label={t('dynamicRange.intensity')}
              minValue={1}
              maxValue={MAX_HDR_BOOST_INTENSITY}
              step={0.1}
              value={intensity}
              renderValue={() => (
                <span className="text-primary text-xs">
                  {intensity.toFixed(1)}×
                </span>
              )}
              onChange={(value) => {
                if (typeof value === 'number')
                  update((target) => {
                    target.dynamicRange = { mode: 'boost', intensity: value }
                  })
              }}
              isDisabled={disabled}
              className="mt-3 mb-2"
              classNames={{ label: 'text-xs' }}
            />
          ) : null}
        </>
      ) : (
        <p className="text-xs text-gray-500">
          {t(
            range === 'mixed'
              ? 'dynamicRange.videoMixed'
              : 'dynamicRange.videoUnknown',
          )}
        </p>
      )}
    </>
  )
}

export default DynamicRange
