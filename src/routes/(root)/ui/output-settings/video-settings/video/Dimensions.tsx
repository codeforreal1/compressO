import { AnimatePresence, motion } from 'framer-motion'
import React, { useCallback, useEffect } from 'react'
import { subscribe, useSnapshot } from 'valtio'
import { subscribeKey } from 'valtio/utils'

import Button from '@/components/Button'
import NumberInput from '@/components/NumberInput'
import Switch from '@/components/Switch'
import { slideDownTransition } from '@/utils/animation'
import { appProxy } from '../../../../-state'

type VideoDimensionsProps = {
  mediaIndex: number
}

function Dimensions({ mediaIndex }: VideoDimensionsProps) {
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
                    width: transforms.crop.width,
                    height: transforms.crop.height,
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
