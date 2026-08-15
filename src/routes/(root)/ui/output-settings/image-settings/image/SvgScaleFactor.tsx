import { cloneDeep } from 'lodash'
import { useCallback } from 'react'
import { useSnapshot } from 'valtio'

import Slider from '@/components/Slider'
import { useSyncState } from '@/hooks/useSyncState'
import {
  appProxy,
  imageConfigInitialState,
  normalizeBatchMediaConfig,
} from '@/routes/(root)/-state'

type SvgScaleFactorProps = {
  mediaIndex: number
}

const SVG_SCALE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const

const imageConfigInitialStateClone = cloneDeep(imageConfigInitialState)

const SvgScaleFactor = ({ mediaIndex }: SvgScaleFactorProps) => {
  const {
    state: {
      media,
      commonConfigForBatchCompression,
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type === 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { svgScaleFactor } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const setScaleFactorGlobal = useCallback(
    (value: number) => {
      const scaleFactor = value as (typeof SVG_SCALE_OPTIONS)[number]
      if (
        mediaIndex >= 0 &&
        appProxy.state.media[mediaIndex].type === 'image' &&
        appProxy.state.media[mediaIndex]?.config
      ) {
        appProxy.state.media[mediaIndex].config.svgScaleFactor = scaleFactor
        appProxy.state.media[mediaIndex].isConfigDirty = true
      } else {
        if (appProxy.state.media.length > 1) {
          appProxy.state.commonConfigForBatchCompression.imageConfig.svgScaleFactor =
            scaleFactor
          normalizeBatchMediaConfig()
        }
      }
    },
    [mediaIndex],
  )

  const [scaleFactor, setScaleFactor] = useSyncState<number>({
    globalValue: svgScaleFactor ?? undefined,
    setGlobalValue: setScaleFactorGlobal,
    defaultValue: imageConfigInitialStateClone.svgScaleFactor ?? 4,
    debounceMs: 500,
  })

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <Slider
      label="缩放因子"
      size="lg"
      step={1}
      minValue={1}
      maxValue={8}
      value={scaleFactor}
      marks={SVG_SCALE_OPTIONS.map((value) => ({
        value,
        label: `${value}x`,
      }))}
      onChange={(val) => {
        if (!Array.isArray(val)) {
          setScaleFactor(val)
        }
      }}
      isDisabled={shouldDisableInput}
      className="w-full"
      classNames={{
        label: 'text-gray-600 dark:text-gray-400 text-sm',
        mark: '!text-xs mt-2',
        value: 'text-xs',
      }}
    />
  )
}

export default SvgScaleFactor
