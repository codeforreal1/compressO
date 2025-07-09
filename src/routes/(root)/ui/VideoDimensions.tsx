import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import NumberInput from '@/components/NumberInput'
import Switch from '@/components/Switch'
import { slideDownTransition } from '@/utils/animation'
import { videoProxy } from '../-state'

function VideoDimensions() {
  const {
    state: {
      isCompressing,
      config: { shouldEnableCustomDimensions },
      dimensions: videoDimensions,
    },
  } = useSnapshot(videoProxy)

  const [dimensions, setDimensions] = React.useState({
    width: videoDimensions?.width ?? 0,
    height: videoDimensions?.height ?? 0,
  })

  React.useEffect(() => {
    if (
      !Number.isNaN(videoDimensions?.width) &&
      !Number.isNaN(videoDimensions)
    ) {
      setDimensions({
        width: videoDimensions?.width ?? 0,
        height: videoDimensions?.height ?? 0,
      })
    }
  }, [videoDimensions])

  const handleChange = (value: number, type: 'width' | 'height') => {
    if (
      !value ||
      value <= 0 ||
      videoDimensions == null ||
      Number.isNaN(videoDimensions?.width) ||
      Number.isNaN(videoDimensions?.height)
    ) {
      return
    }
    const aspectRatio = videoDimensions.width / videoDimensions.height
    setDimensions((s) => ({
      ...s,
      ...(type === 'width'
        ? { width: value, height: Math.round(value / aspectRatio) }
        : { width: Math.round(value * aspectRatio), height: value }),
    }))
  }

  return (
    <>
      <Switch
        isSelected={shouldEnableCustomDimensions}
        onValueChange={() => {
          videoProxy.state.config.shouldEnableCustomDimensions =
            !shouldEnableCustomDimensions
        }}
        isDisabled={isCompressing}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          Dimensions
        </p>
      </Switch>
      <AnimatePresence mode="wait">
        {shouldEnableCustomDimensions ? (
          <motion.div
            {...slideDownTransition}
            className="mt-2 flex items-center space-x-2"
          >
            <NumberInput
              label="Width"
              className="max-w-[120px] xl:max-w-[150px]"
              value={dimensions?.width}
              onValueChange={(val) => handleChange(val, 'width')}
              labelPlacement="outside"
              classNames={{ label: '!text-gray-600 dark:!text-gray-400' }}
            />
            <NumberInput
              label="Height"
              className="max-w-[120px] xl:max-w-[150px]"
              value={dimensions?.height}
              onValueChange={(val) => handleChange(val, 'height')}
              labelPlacement="outside"
              classNames={{ label: '!text-gray-600 dark:!text-gray-400' }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

export default VideoDimensions
