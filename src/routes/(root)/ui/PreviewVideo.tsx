import React from 'react'
import { useSnapshot } from 'valtio'

import { videoProxy } from '../-state'
import VideoThumbnail from './VideoThumbnail'
import VideoTransformer from './VideoTransformer'

function PreviewVideo() {
  const {
    state: {
      config: { shouldTransformVideo },
    },
  } = useSnapshot(videoProxy)

  return <>{shouldTransformVideo ? <VideoTransformer /> : <VideoThumbnail />}</>
}

export default PreviewVideo
