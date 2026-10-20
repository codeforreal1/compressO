import { getLocalTimeZone, now } from '@internationalized/date'
import cloneDeep from 'lodash/cloneDeep'
import { proxy } from 'valtio'

import {
  getAudioFileOutputExtension,
  getBatchResolutionLongerSide,
  isAudioExtension,
  isVideoCodecCompatible,
  type MediaTransformHistory,
} from '@/types/compression'
import { DEFAULT_TARGET_SIZE_IN_MB } from '@/utils/targetSize'
import { applyPortableTransform } from '@/utils/transform'
import {
  getLongerSideDimensions,
  getOutputVideoContainer,
  getTransformedDimensions,
} from '@/utils/video'
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
  shouldUseTargetSize: false,
  targetSizeInMB: DEFAULT_TARGET_SIZE_IN_MB,
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

/** Settings of an audio file, before its own (or the batch's) are applied */
export const audioFileConfigInitialState: VideoConfig = {
  ...videoConfigInitialState,
  subtitlesConfig: null,
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
  isAppendingMedia: false,
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
    audioFileConfig: audioFileConfigInitialState,
  },
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
 * Normalizes the individual non-dirty media config to match with batch config. The batch's
 * transform (rotation, flips, crop shape) & resolution are set as each media's own (computed from
 * its size), so the settings of a single media show what it is compressed to.
 */
export function normalizeBatchMediaConfig() {
  if (appProxy.state.media.length > 1) {
    const { videoConfig, imageConfig, audioFileConfig } =
      appProxy.state.commonConfigForBatchCompression
    const videoLongerSide = getBatchResolutionLongerSide(
      videoConfig.batchResolution,
    )
    const imageLongerSide = imageConfig.batchLongerSide ?? null
    for (const index in appProxy.state.media) {
      const mediaFile = appProxy.state.media[index]
      if (mediaFile?.isConfigDirty) continue
      if (mediaFile.type === 'video' && mediaFile.isAudioFile) {
        mediaFile.config = getAudioFileBatchConfig(
          audioFileConfig,
          mediaFile.extension,
        )
      } else if (mediaFile.type === 'video') {
        const config = cloneDeep(videoConfig)
        // Only the batch's config holds the batch transform
        delete config.batchTransform
        // The batch's codec is used where the video's output container can hold it (e.g. not VP9
        // in a TS file, with "Same as input"); the others keep their default codec
        if (
          config.shouldEnableCustomVideoCodec &&
          config.customVideoCodec &&
          !isVideoCodecCompatible(
            config.customVideoCodec,
            getOutputVideoContainer(
              config.convertToExtension,
              mediaFile.extension,
            ),
          )
        ) {
          config.customVideoCodec = undefined
        }
        if (!isAudioExtension(config.convertToExtension)) {
          applyPortableTransform(
            config,
            'video',
            videoConfig.batchTransform,
            mediaFile.dimensions,
          )
        }
        applyBatchSize(
          config,
          getOutputDimensions(
            mediaFile.dimensions,
            config.shouldTransformVideo
              ? config.transformVideoConfig?.transformHistory
              : null,
          ),
          videoLongerSide,
        )
        mediaFile.config = config
      } else if (mediaFile.type === 'image') {
        const config = cloneDeep(imageConfig)
        delete config.batchTransform
        // SVGs cannot be transformed, and are resized with the SVG scale factor instead
        if (
          mediaFile.extension !== 'svg' &&
          config.convertToExtension !== 'svg'
        ) {
          applyPortableTransform(
            config,
            'image',
            imageConfig.batchTransform,
            mediaFile.dimensions,
          )
          applyBatchSize(
            config,
            getOutputDimensions(
              mediaFile.dimensions,
              config.shouldTransformImage
                ? config.transformImageConfig?.transformHistory
                : null,
            ),
            imageLongerSide,
          )
        }
        mediaFile.config = config
      }
    }
  }
}

/**
 * The batch's audio settings as an audio file's own: always written as audio, in its own format
 * when the batch keeps "Same as input"
 */
export function getAudioFileBatchConfig(
  audioFileConfig: VideoConfig,
  sourceExtension: string | null | undefined,
): VideoConfig {
  const config = cloneDeep(audioFileConfig)
  if (!isAudioExtension(config.convertToExtension)) {
    config.convertToExtension = getAudioFileOutputExtension(sourceExtension)
  }
  return config
}

/** Size of a media after its transforms (rotations & crop) */
function getOutputDimensions(
  dimensions: { width: number; height: number } | undefined,
  transformHistory: readonly MediaTransformHistory[] | null | undefined,
) {
  return dimensions?.width && dimensions?.height
    ? getTransformedDimensions(dimensions, transformHistory)
    : undefined
}

/** Sets the batch's size (of the longer side) as a media's custom dimensions */
function applyBatchSize(
  config: VideoConfig | ImageConfig,
  dimensions: { width: number; height: number } | undefined,
  longerSide: number | null,
) {
  const customDimensions =
    longerSide && dimensions?.width && dimensions?.height
      ? getLongerSideDimensions(dimensions, longerSide)
      : null
  config.shouldEnableCustomDimensions = !!customDimensions
  config.customDimensions = customDimensions ?? undefined
}
