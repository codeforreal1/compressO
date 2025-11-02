import { useSnapshot } from 'valtio'

import VideoThumbnail from './VideoThumbnail'
import VideoTransformer from './VideoTransformer'
import { videoProxy } from '../-state'

function PreviewVideo() {
  const {
    state: {
      config: { shouldTransformVideo },
    },
  } = useSnapshot(videoProxy)

  return <>{shouldTransformVideo ? <VideoTransformer /> : <VideoThumbnail />}</>
}

export default PreviewVideo
