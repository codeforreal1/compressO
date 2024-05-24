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

// const videoInitialState: Video = {
//   id: 'LFLmGvBmAu4wMF9JXP1Dt',
//   isFileSelected: true,
//   pathRaw:
//     '/home/niraj/Downloads/copy_34992E05-461C-4F84-8447-FA4B3F3452DC.mov',
//   path: 'asset://localhost/%2Fhome%2Fniraj%2FDownloads%2Fcopy_34992E05-461C-4F84-8447-FA4B3F3452DC.mov',
//   fileName: 'copy_34992E05-461C-4F84-8447-FA4B3F3452DC.mov',
//   mimeType: 'video/quicktime',
//   sizeInBytes: 70872137,
//   size: '70.9 MB',
//   extension: 'mov',
//   thumbnailPathRaw:
//     '/home/niraj/.local/share/com.compresso.app/assets/LFLmGvBmAu4wMF9JXP1Dt.jpg',
//   thumbnailPath:
//     'asset://localhost/%2Fhome%2Fniraj%2F.local%2Fshare%2Fcom.compresso.app%2Fassets%2FLFLmGvBmAu4wMF9JXP1Dt.jpg',
//   isThumbnailGenerating: false,
//   videoDurationMilliseconds: 33790,
//   videDurationRaw: '00:00:33.79',
//   isCompressing: true,
//   isCompressionSuccessful: false,
//   compressedVideo: null,
//   compressionProgress: 50,
//   config: {
//     convertToExtension: 'mp4',
//     presetName: 'ironclad',
//     shouldDisableCompression: false,
//     shouldMuteVideo: false,
//   },
// }

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
