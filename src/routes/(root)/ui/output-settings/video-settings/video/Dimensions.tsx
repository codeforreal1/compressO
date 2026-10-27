import { AnimatePresence, motion } from 'framer-motion'
import React, { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { subscribe, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import NumberInput from '@/components/NumberInput'
import Switch from '@/components/Switch'
import Tooltip from '@/components/Tooltip'
import { batchResolutions } from '@/types/compression'
import { slideDownTransition } from '@/utils/animation'
import { appProxy } from '../../../../-state'

/** The listed resolutions, as the size of the longer side (see `batchResolutions`) */
const RESOLUTION_BUTTONS = Object.entries(batchResolutions).flatMap(
  ([label, width]) => (width ? [{ label, width }] : []),
)

type VideoDimensionsProps = {
  mediaIndex: number
}

function Dimensions({ mediaIndex }: VideoDimensionsProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return

  const {
    state: { media, isCompressing, isProcessCompleted, isLoadingMediaFiles },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config, dimensions: videoOriginalDimensions } = video ?? {}
  const {
    shouldEnableCustomDimensions,
    customDimensions: videoCustomDimensions,
  } = config ?? {}
  const isCropping = Boolean(
    config?.isVideoTransformEditMode &&
      config?.transformVideoConfig?.transforms?.crop,
  )

  const [dimensions, setDimensions] = React.useState(() => ({
    width:
      (videoCustomDimensions
        ? videoCustomDimensions[0]
        : videoOriginalDimensions?.width) ?? 0,
    height:
      (videoCustomDimensions
        ? videoCustomDimensions[1]
        : videoOriginalDimensions?.height) ?? 0,
  }))

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    if (config && appProxy.state.media[mediaIndex].type === 'video') {
      unsubscribe = subscribeKey(
        appProxy.state.media[mediaIndex].config,
        'shouldTransformVideo',
        (shouldTransformVideo) => {
          const targetVideo =
            appProxy.state.media[mediaIndex].type === 'video'
              ? appProxy.state.media[mediaIndex]
              : null
          if (targetVideo) {
            if (shouldTransformVideo) {
              if (targetVideo.config.transformVideoConfig) {
                const transforms =
                  targetVideo.config.transformVideoConfig?.transforms
                if (transforms?.crop) {
                  setDimensions({
                    // The crop is in fractional pixels
                    width: Math.round(transforms.crop.width),
                    height: Math.round(transforms.crop.height),
                  })
                }
              }
            } else {
              if (targetVideo.dimensions) {
                setDimensions({
                  width: targetVideo.dimensions.width!,
                  height: targetVideo.dimensions.height!,
                })
              }
            }
          }
        },
      )
    }
    return () => {
      unsubscribe?.()
    }
  }, [mediaIndex, config])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    const transformVideoConfig =
      appProxy.state.media[mediaIndex].type === 'video'
        ? appProxy.state.media[mediaIndex]?.config?.transformVideoConfig
        : null
    if (isCropping && transformVideoConfig?.transforms?.crop) {
      unsubscribe = subscribe(transformVideoConfig, () => {
        if (appProxy.state.media[mediaIndex].type === 'video') {
          const targetVideo = appProxy.state.media[mediaIndex]
          const shouldTransformVideo = targetVideo.config.shouldTransformVideo
          const transformCrop =
            targetVideo.config.transformVideoConfig?.transforms?.crop
          if (shouldTransformVideo && transformCrop) {
            const _dimensions: [number, number] = [
              Math.round(transformCrop?.width ?? 0),
              Math.round(transformCrop?.height ?? 0),
            ]
            setDimensions({
              width: _dimensions[0],
              height: _dimensions[1],
            })
            appProxy.state.media[mediaIndex].config.customDimensions =
              _dimensions
            appProxy.state.media[mediaIndex].isConfigDirty = true
          }
        }
      })
    }
    return () => {
      unsubscribe?.()
    }
  }, [mediaIndex, isCropping])

  const handleChange = useCallback(
    (value: number, type: 'width' | 'height') => {
      if (
        !value ||
        value <= 0 ||
        mediaIndex < 0 ||
        appProxy.state.media[mediaIndex].type !== 'video'
      ) {
        return
      }
      const targetVideo = appProxy.state.media[mediaIndex]
      const targetVideoDimensions = targetVideo.config?.shouldTransformVideo
        ? {
            width:
              targetVideo?.config?.transformVideoConfig?.transforms?.crop
                ?.width ?? targetVideo?.dimensions?.width,
            height:
              targetVideo?.config?.transformVideoConfig?.transforms?.crop
                ?.height ?? targetVideo?.dimensions?.height,
          }
        : targetVideo?.dimensions
      if (
        targetVideoDimensions == null ||
        Number.isNaN(targetVideoDimensions?.width) ||
        Number.isNaN(targetVideoDimensions?.height)
      ) {
        return null
      }
      const aspectRatio =
        targetVideoDimensions.width! / targetVideoDimensions.height!
      const _dimensions: [number, number] =
        type === 'width'
          ? [value, Math.round(value / aspectRatio)]
          : [Math.round(value * aspectRatio), value]
      setDimensions((s) => ({
        ...s,
        width: _dimensions[0],
        height: _dimensions[1],
      }))
      appProxy.state.media[mediaIndex].config.customDimensions = _dimensions
      appProxy.state.media[mediaIndex].isConfigDirty = true
    },
    [mediaIndex],
  )

  // What "original" means: the media's size, or the crop size when a transform crop is applied
  const transformCrop = config?.shouldTransformVideo
    ? config.transformVideoConfig?.transforms?.crop
    : null
  const baseDimensions = transformCrop
    ? {
        width: Math.round(transformCrop.width),
        height: Math.round(transformCrop.height),
      }
    : videoOriginalDimensions
  // Follows dimensions set outside the inputs (e.g. by a preset); none means the original size
  const customWidth = videoCustomDimensions?.[0]
  const customHeight = videoCustomDimensions?.[1]
  const baseWidth = baseDimensions?.width
  const baseHeight = baseDimensions?.height
  useEffect(() => {
    const width = customWidth ?? baseWidth
    const height = customHeight ?? baseHeight
    if (width && height) {
      setDimensions((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      )
    }
  }, [customWidth, customHeight, baseWidth, baseHeight])

  const isOriginalDimensions =
    !baseDimensions ||
    (dimensions.width === baseDimensions.width &&
      dimensions.height === baseDimensions.height)

  const handleRevert = useCallback(() => {
    if (
      !baseDimensions?.width ||
      !baseDimensions?.height ||
      appProxy.state.media[mediaIndex].type !== 'video'
    ) {
      return
    }
    setDimensions({
      width: baseDimensions.width,
      height: baseDimensions.height,
    })
    // No custom dimensions means the output keeps its original size, without resizing
    appProxy.state.media[mediaIndex].config.customDimensions = undefined
    appProxy.state.media[mediaIndex].isConfigDirty = true
  }, [mediaIndex, baseDimensions?.width, baseDimensions?.height])

  const isPortrait = dimensions.height > dimensions.width
  const longerSide = Math.max(dimensions.width, dimensions.height)

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  const canRevert =
    !!shouldEnableCustomDimensions &&
    !isOriginalDimensions &&
    !shouldDisableInput

  return (
    <>
      <div className="w-full flex items-center">
        <Switch
          isSelected={shouldEnableCustomDimensions}
          onValueChange={() => {
            if (
              appProxy.state.media[mediaIndex].type === 'video' &&
              appProxy.state.media[mediaIndex]?.config
            ) {
              appProxy.state.media[
                mediaIndex
              ].config.shouldEnableCustomDimensions =
                !shouldEnableCustomDimensions
              appProxy.state.media[mediaIndex].isConfigDirty = true
            }
          }}
          isDisabled={shouldDisableInput}
        >
          <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
            {t('dimensions.resolution')}
          </p>
        </Switch>
        {/* Always rendered (only faded) so showing it never shifts the layout; it is only needed
        when the size differs from the original */}
        <Button
          isIconOnly
          size="sm"
          variant="light"
          onPress={handleRevert}
          isDisabled={!canRevert}
          aria-hidden={!canRevert}
          tabIndex={canRevert ? undefined : -1}
          aria-label={t('dimensions.revert')}
          className={`ml-auto transition-opacity ${canRevert ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <Tooltip
            content={t('dimensions.revert')}
            aria-label={t('dimensions.revert')}
          >
            <Icon name="redo" size={18} className="-scale-x-100" />
          </Tooltip>
        </Button>
      </div>
      <AnimatePresence mode="wait">
        {shouldEnableCustomDimensions ? (
          <motion.div {...slideDownTransition}>
            <div className="mt-2 flex items-center space-x-2">
              <NumberInput
                label={t('dimensions.width')}
                className="max-w-[120px] xl:max-w-[150px]"
                value={dimensions?.width}
                onValueChange={(val) => handleChange(val, 'width')}
                labelPlacement="outside"
                classNames={{ label: '!text-gray-600 dark:!text-gray-400' }}
                isDisabled={!shouldEnableCustomDimensions || shouldDisableInput}
              />
              <NumberInput
                label={t('dimensions.height')}
                className="max-w-[120px] xl:max-w-[150px]"
                value={dimensions?.height}
                onValueChange={(val) => handleChange(val, 'height')}
                labelPlacement="outside"
                classNames={{ label: '!text-gray-600 dark:!text-gray-400' }}
                isDisabled={
                  media.length === 0 ||
                  isCompressing ||
                  isProcessCompleted ||
                  isLoadingMediaFiles
                }
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {RESOLUTION_BUTTONS.map((preset) => (
                <Button
                  size="sm"
                  radius="md"
                  key={preset.label}
                  // Sets the longer side: the width of a landscape media, the height of a portrait one
                  onPress={() =>
                    handleChange(preset.width, isPortrait ? 'height' : 'width')
                  }
                  // Highlighted while the longer side matches it (a custom size matches none)
                  color={longerSide === preset.width ? 'primary' : 'default'}
                  variant={longerSide === preset.width ? 'solid' : 'flat'}
                  aria-pressed={longerSide === preset.width}
                  isDisabled={shouldDisableInput}
                  className="min-w-[unset]"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default React.memo(Dimensions)
