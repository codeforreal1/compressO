import { getLocalTimeZone, now } from '@internationalized/date'
import cloneDeep from 'lodash/cloneDeep'
import { proxy } from 'valtio'

import {
    App,
    ImageConfig,
    MediaMetadataConfig,
    VideoConfig,
} from '../../types/app'

export const videoMetadataConfigInitialState: MediaMetadataConfig = {
  title: '',
  album: '',
  artist: '',
  comment: '',
  description: '',
  synopsis: '',
  year: '',
  genre: '',
  copyright: '',
  creationTime: '',
  creationTimeRaw: now(getLocalTimeZone()),
}

export const videoConfigInitialState: VideoConfig = {
  convertToExtension: '-',
  presetName: 'ironclad',
  shouldDisableCompression: false,
  shouldEnableCustomVideoCodec: false,
  shouldEnableCustomDimensions: false,
  shouldEnableCustomFPS: false,
  shouldTransformVideo: false,
  shouldEnableCustomAudioCodec: false,
  audioConfig: {
    volume: 100,
    audioCodec: '-',
    audioChannelConfig: null,
    bitrate: null,
  },
  shouldEnableAudioTrackSelection: false,
  quality: 50,
  shouldStripMetadata: true,
  metadataConfig: null,
  customThumbnailPath: null,
  shouldEnableCustomThumbnail: false,
  shouldTrimVideo: false,
  isVideoTrimEditMode: false,
  shouldEnableCustomChannel: false,
  shouldEnableCustomBitrate: false,
  subtitlesConfig: {
    subtitles: [],
    shouldEnableSubtitles: false,
  },
  shouldEnableCustomSpeed: false,
  customSpeed: undefined,
}

export const svgSettingInitialState = {
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  cornerThreshold: 60,
  lengthThreshold: 4,
  spliceThreshold: 45,
  isBw: false,
}

export const imageConfigInitialState: ImageConfig = {
  convertToExtension: '-',
  isLossless: false,
  quality: 50,
  shouldStripMetadata: true,
  svgScaleFactor: 1,
  shouldEnableAdvancedSvgSetting: false,
  svgConfig: svgSettingInitialState,
}

const appInitialState: App = {
  activeTab: 'all',
  media: [],
  isLoadingMediaFiles: false,
  totalSelectedMediaCount: 0,
  currentMediaIndex: 0,
  isCompressing: false,
  totalProgress: 0,
  isProcessCompleted: false,
  isBatchCompressionCancelled: false,
  isSaving: false,
  isSaved: false,
  selectedMediaIndexForCustomization: -1,
  commonConfigForBatchCompression: {
    videoConfig: videoConfigInitialState,
    imageConfig: imageConfigInitialState,
  },
  autoSaveEnabled: localStorage.getItem('autoSaveEnabled') === 'true' || false,
  autoSavePath: localStorage.getItem('autoSavePath') || undefined,
}

const snapshotMoment = {
  beforeCompressionStarted: 'beforeCompressionStarted',
  batchCompressionStep: 'batchCompressionStep',
} as const

type SnapshotMoment = keyof typeof snapshotMoment

type AppProxy = {
  state: App
  snapshots: Record<SnapshotMoment, App>
  takeSnapshot: (moment: SnapshotMoment) => void
  timeTravel: (to: SnapshotMoment) => void
  removeSnapshot: (moment: SnapshotMoment) => void
  clearSnapshots: () => void
  resetProxy: () => void
}

const snapshotsInitialState = {
  [snapshotMoment.beforeCompressionStarted]: cloneDeep(appInitialState),
  [snapshotMoment.batchCompressionStep]: cloneDeep(appInitialState),
}

export const appProxy: AppProxy = proxy({
  state: appInitialState,
  snapshots: snapshotsInitialState,
  takeSnapshot(moment: SnapshotMoment) {
    if (moment in snapshotMoment) {
      appProxy.snapshots[moment] = cloneDeep(appProxy.state)
    }
  },
  timeTravel(to: SnapshotMoment) {
    if (to in snapshotMoment) {
      appProxy.state = cloneDeep(appProxy.snapshots[to])
    }
  },
  removeSnapshot(moment: SnapshotMoment) {
    if (moment in snapshotMoment) {
      delete appProxy.snapshots[moment]
    }
  },
  clearSnapshots() {
    cloneDeep(snapshotsInitialState)
  },
  resetProxy() {
    appProxy.state = cloneDeep(appInitialState)
    appProxy.snapshots = cloneDeep(snapshotsInitialState)
  },
})

/**
 * Normalizes the individual non-dirty media config to match with batch config.
 */
export function normalizeBatchMediaConfig() {
  if (appProxy.state.media.length > 1) {
    for (const index in appProxy.state.media) {
      if (!appProxy.state.media[index]?.isConfigDirty) {
        if (appProxy.state.media[index].type === 'video') {
          appProxy.state.media[index].config = cloneDeep(
            appProxy.state.commonConfigForBatchCompression.videoConfig,
          )
        } else if (appProxy.state.media[index].type === 'image') {
          appProxy.state.media[index].config = cloneDeep(
            appProxy.state.commonConfigForBatchCompression.imageConfig,
          )
        }
      }
    }
  }
}
