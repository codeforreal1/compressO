import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Divider from '@/components/Divider'
import InfoTooltip from '@/components/InfoTooltip'
import Slider from '@/components/Slider'
import Switch from '@/components/Switch'
import { appProxy, normalizeBatchMediaConfig } from '@/routes/(root)/-state'
import type { ImageConfig } from '@/types/app'
import {
  MAX_HDR_BOOST_INTENSITY,
  supportsHdrBoostOutput,
} from '@/utils/imageDynamicRange'

type DynamicRangeProps = { mediaIndex: number }

function DynamicRange({ mediaIndex }: DynamicRangeProps) {
  const { t } = useTranslation()
  const { state } = useSnapshot(appProxy)
  const selected = state.media[mediaIndex]
  const image = selected?.type === 'image' ? selected : null
  const images = image
    ? [image]
    : state.media.filter((item) => item.type === 'image')
  if (
    !images.length ||
    !images.some((item) => item.dynamicRangeInfo?.supported)
  )
    return null

  const ranges = new Set(
    images.map((item) => item.dynamicRangeInfo?.dynamicRange ?? 'unknown'),
  )
  const range = ranges.size === 1 ? [...ranges][0] : 'mixed'
  const config =
    image?.config ?? state.commonConfigForBatchCompression.imageConfig
  const mode = range === 'sdr' ? 'boost' : range === 'hdr' ? 'sdr' : null
  const unsupportedOutput =
    mode === 'boost' &&
    !images.every((item) =>
      supportsHdrBoostOutput(
        config.convertToExtension === '-'
          ? (item.extension ?? '')
          : config.convertToExtension,
        item.dynamicRangeInfo,
      ),
    )
  // HDR JPEG needs Core Image (macOS 15 and later)
  const canBoostJpeg = images.every(
    (item) => item.dynamicRangeInfo?.supportsHdrJpeg,
  )
  const enabled =
    !unsupportedOutput && mode !== null && config.dynamicRange?.mode === mode
  const storedIntensity = config.dynamicRange?.intensity ?? 2
  const intensity = Number.isFinite(storedIntensity)
    ? Math.min(MAX_HDR_BOOST_INTENSITY, Math.max(1, storedIntensity))
    : 2
  const disabled =
    state.isCompressing || state.isProcessCompleted || state.isLoadingMediaFiles

  const update = (change: (target: ImageConfig) => void) => {
    const target = appProxy.state.media[mediaIndex]
    if (target?.type === 'image') {
      change(target.config)
      target.isConfigDirty = true
    } else {
      change(appProxy.state.commonConfigForBatchCompression.imageConfig)
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
              isDisabled={disabled || unsupportedOutput}
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
                unsupportedOutput
                  ? t(
                      canBoostJpeg
                        ? 'dynamicRange.formatsOnly'
                        : 'dynamicRange.formatsOnlyWithoutJpeg',
                    )
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
          {t(range === 'mixed' ? 'dynamicRange.mixed' : 'dynamicRange.unknown')}
        </p>
      )}
    </>
  )
}

export default DynamicRange
