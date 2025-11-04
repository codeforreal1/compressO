import { useSnapshot } from 'valtio'

import Image from '@/components/Image'
import { videoProxy } from '../-state'

function VideoThumbnail() {
  const {
    state: { thumbnailPath },
  } = useSnapshot(videoProxy)

  return (
    <Image
      alt="video to compress"
      src={thumbnailPath as string}
      className="max-w-[65vw] xxl:max-w-[75vw] max-h-[60vh] object-contain rounded-3xl border-primary border-4"
    />
  )
}

export default VideoThumbnail
