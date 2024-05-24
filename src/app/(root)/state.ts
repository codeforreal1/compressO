import { proxy } from 'valtio'
import cloneDeep from 'lodash/cloneDeep'

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

const snapshotMoment = {
  beforeCompressionStarted: 'beforeCompressionStarted',
} as const

type SnapshotMoment = keyof typeof snapshotMoment

type VideoProxy = {
  state: Video
  snapshots: Record<SnapshotMoment, Video>
  takeSnapshot: (moment: SnapshotMoment) => void
  timeTravel: (to: SnapshotMoment) => void
  resetProxy: () => void
}

const snapshotsInitialState = {
  [snapshotMoment.beforeCompressionStarted]: cloneDeep(videoInitialState),
}

export const videoProxy: VideoProxy = proxy({
  state: videoInitialState,
  snapshots: snapshotsInitialState,
  takeSnapshot(moment: SnapshotMoment) {
    if (moment in snapshotMoment) {
      videoProxy.snapshots[moment] = cloneDeep(videoProxy.state)
    }
  },
  timeTravel(to: SnapshotMoment) {
    if (to in snapshotMoment) {
      videoProxy.state = cloneDeep(videoProxy.snapshots[to])
    }
  },
  resetProxy() {
    videoProxy.state = cloneDeep(videoInitialState)
    videoProxy.snapshots = cloneDeep(snapshotsInitialState)
  },
})
