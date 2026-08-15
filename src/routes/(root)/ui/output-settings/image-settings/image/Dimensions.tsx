import { AnimatePresence, motion } from 'framer-motion'
import React, { useCallback, useEffect } from 'react'
import { subscribe, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'

import Button from '@/components/Button'
import NumberInput from '@/components/NumberInput'
import Switch from '@/components/Switch'
import { appProxy } from '@/routes/(root)/-state'
import { slideDownTransition } from '@/utils/animation'

type DimensionsProps = {
  mediaIndex: number
}

function Dimensions({ mediaIndex }: DimensionsProps) {
  if (mediaIndex < 0) return

  const {
    state: { media, isCompressing, isProcessCompleted, isLoadingMediaFiles },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && media[mediaIndex].type === 'image'
      ? media[mediaIndex]
      : null
  const { config, dimensions: imageOriginalDimensions } = image ?? {}
  const {
    shouldEnableCustomDimensions,
    customDimensions: imageCustomDimensions,
  } = config ?? {}
  const isCropping = Boolean(
    config?.isImageTransformEditMode &&
      config?.transformImageConfig?.transforms?.crop,
  )

  const [dimensions, setDimensions] = React.useState(() => ({
    width:
      (imageCustomDimensions
        ? imageCustomDimensions[0]
        : imageOriginalDimensions?.width) ?? 0,
    height:
      (imageCustomDimensions
        ? imageCustomDimensions[1]
        : imageOriginalDimensions?.height) ?? 0,
  }))

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    if (config && appProxy.state.media[mediaIndex].type === 'image') {
      unsubscribe = subscribeKey(
        appProxy.state.media[mediaIndex].config,
        'shouldTransformImage',
        (shouldTransformImage) => {
          const targetImage =
            appProxy.state.media[mediaIndex].type === 'image'
              ? appProxy.state.media[mediaIndex]
              : null
          if (targetImage) {
            if (shouldTransformImage) {
              if (targetImage.config.transformImageConfig) {
                const transforms =
                  targetImage.config.transformImageConfig?.transforms
                if (transforms?.crop) {
                  setDimensions({
                    width: transforms.crop.width,
                    height: transforms.crop.height,
                  })
                }
              }
            } else {
              if (targetImage.dimensions) {
                setDimensions({
                  width: targetImage.dimensions.width!,
                  height: targetImage.dimensions.height!,
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

    const transformImageConfig =
      appProxy.state.media[mediaIndex].type === 'image'
        ? appProxy.state.media[mediaIndex]?.config?.transformImageConfig
        : null
    if (isCropping && transformImageConfig?.transforms?.crop) {
      unsubscribe = subscribe(transformImageConfig, () => {
        if (appProxy.state.media[mediaIndex].type === 'image') {
          const targetImage = appProxy.state.media[mediaIndex]
          const shouldTransformImage = targetImage.config.shouldTransformImage
          const transformCrop =
            targetImage.config.transformImageConfig?.transforms?.crop
          if (shouldTransformImage && transformCrop) {
            const _dimensions: [number, number] = [
              transformCrop?.width ?? 0,
              transformCrop?.height ?? 0,
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
        appProxy.state.media[mediaIndex].type !== 'image'
      ) {
        return
      }
      const targetImage = appProxy.state.media[mediaIndex]
      const targetDimensions = targetImage.config?.shouldTransformImage
        ? {
            width:
              targetImage?.config?.transformImageConfig?.transforms?.crop
                ?.width ?? targetImage?.dimensions?.width,
            height:
              targetImage?.config?.transformImageConfig?.transforms?.crop
                ?.height ?? targetImage?.dimensions?.height,
          }
        : targetImage?.dimensions
      if (
        targetDimensions == null ||
        Number.isNaN(targetDimensions?.width) ||
        Number.isNaN(targetDimensions?.height)
      ) {
        return null
      }
      const aspectRatio = targetDimensions.width! / targetDimensions.height!
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

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <>
      <Switch
        isSelected={shouldEnableCustomDimensions}
        onValueChange={() => {
          if (
            appProxy.state.media[mediaIndex].type === 'image' &&
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
          尺寸
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomDimensions ? (
          <motion.div {...slideDownTransition}>
            <div className="mt-2 flex items-center space-x-2">
              <NumberInput
                label="宽度"
                className="max-w-[120px] xl:max-w-[150px]"
                value={dimensions?.width}
                onValueChange={(val) => handleChange(val, 'width')}
                labelPlacement="outside"
                classNames={{ label: '!text-gray-600 dark:!text-gray-400' }}
                isDisabled={!shouldEnableCustomDimensions || shouldDisableInput}
              />
              <NumberInput
                label="高度"
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
              {[
                { label: '480p', width: 640 },
                { label: '720p', width: 1280 },
                { label: '1080p', width: 1920 },
                { label: '2k', width: 2560 },
                { label: '4k', width: 3840 },
              ].map((preset) => (
                <Button
                  size="sm"
                  radius="md"
                  key={preset.label}
                  onPress={() => handleChange(preset.width, 'width')}
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
