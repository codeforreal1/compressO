import React from 'react'
import { useSnapshot } from 'valtio'

import Image from '@/components/Image'
import { videoProxy } from '../-state'
import VideoTransformer from './VideoTransformer'

function VideoThumbnail() {
  const {
    state: {
      thumbnailPath,
      config: { shouldTransformVideo },
    },
  } = useSnapshot(videoProxy)

  return (
    <>
      {!shouldTransformVideo ? (
        <Image
          alt="video to compress"
          src={thumbnailPath as string}
          className="max-w-[50vw] xxl:max-w-[60vw] max-h-[60vh] object-contain rounded-3xl border-primary border-4"
        />
      ) : (
        <VideoTransformer />
      )}
    </>
  )
}

export default VideoThumbnail
