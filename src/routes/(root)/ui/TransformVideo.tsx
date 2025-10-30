import React from 'react'
import { useSnapshot } from 'valtio'

import Switch from '@/components/Switch'
import { videoProxy } from '../-state'

function TransformVideo() {
  const {
    state: {
      isCompressing,
      config: { shouldTransformVideo },
    },
  } = useSnapshot(videoProxy)

  return (
    <>
      <Switch
        isSelected={shouldTransformVideo}
        onValueChange={() => {
          videoProxy.state.config.shouldTransformVideo = !shouldTransformVideo
          if (shouldTransformVideo) {
            videoProxy.state.config.transformVideoCoordinates = undefined
          }
        }}
        isDisabled={isCompressing}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          Transform
        </p>
      </Switch>
    </>
  )
}

export default TransformVideo
