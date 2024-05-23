import { proxy } from 'valtio'

import { Video, VideoConfig } from './types'

const videoConfigInitialState: VideoConfig = {
  convertToExtension: 'mp4',
  presetName: 'ironclad',
  shouldDisableCompression: false,
  shouldMuteVideo: false,
}

const videoInitialState: Video = {
  id: null,
  isFileSelected: false,
  pathRaw: null,
  path: null,
  fileName: null,
  mimeType: null,
  sizeInBytes: null,
  size: null,
  extension: null,
  thumbnailPathRaw: null,
  thumbnailPath: null,
  isThumbnailGenerating: false,
  videoDurationMilliseconds: null,
  videDurationRaw: null,
  isCompressing: false,
  isCompressionSuccessful: false,
  compressedVideo: null,
  compressionProgress: 0,
  config: videoConfigInitialState,
}

export const videoProxy = proxy({
  state: videoInitialState,
  resetState() {
    videoProxy.state = JSON.parse(JSON.stringify(videoInitialState))
  },
})
