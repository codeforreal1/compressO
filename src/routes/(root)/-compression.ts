import { TimelineAction } from '@xzdarcy/timeline-engine'

import { getDropQueue } from '@/tauri/commands/dropQueue'
import { Image, MediaMetadataConfig, Video } from '@/types/app'
import {
  getAudioFileOutputExtension,
  ImageCompressionConfig,
  isAudioExtension,
  MediaItem,
  MediaTransformHistory,
  VideoCompressionConfig,
  VideoTrimSegment,
} from '@/types/compression'
import { getAudioBitrateForQuality } from '@/utils/audio'
import {
  getLongerSideDimensions,
  getTransformedDimensions,
} from '@/utils/video'

/**
 * Resolves once the drop zone (macOS menu bar) is not compressing any media, so only one compression
 * runs at a time: the main window's compression waits for the drop zone's current media, while the
 * drop zone waits for the main window's compression before its next media (see `-queue.ts`)
 */
export async function waitForDropZone(signal: AbortSignal) {
  while (!signal.aborted) {
    const items = await getDropQueue().catch(() => [])
    if (!items.some((item) => item.status === 'compressing')) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

export type MediaFile =
  | (Video & { type: 'video' })
  | (Image & { type: 'image' })

/**
 * How long a video's output is, in milliseconds, which its progress is measured against (ffmpeg
 * reports how much of the output is written): only the trimmed parts, faster or slower with a
 * custom speed (as sent in `getMediaItemConfig`, clamped like the backend). A GIF is converted from
 * an intermediate video, so it is encoded twice. Used by the main window & the menu bar's queue.
 */
export function getOutputDuration(media: MediaFile) {
  if (media.type !== 'video') return 0
  const trimConfig = media.config?.trimConfig ?? []
  let duration =
    (media.config?.shouldTrimVideo && trimConfig.length
      ? trimConfig.reduce(
          (total, part) =>
            total + (part.end >= part.start ? part.end - part.start : 0),
          0,
        )
      : (media.videoDuration ?? 0)) * 1000
  const speed = media.config?.customSpeed
  if (media.config?.shouldEnableCustomSpeed && speed && speed !== 1) {
    duration /= Math.min(Math.max(speed, 0.25), 4)
  }
  if (media.config?.convertToExtension === 'gif') duration *= 2
  return duration
}

/**
 * What the backend compresses a media with (`compress_media_batch`), from its settings. Used by the
 * main window & the menu bar's queue.
 * - `batchVideoLongerSide` / `batchImageLongerSide`: the batch's resolution, for media without
 *   their own dimensions (`null` outside a batch)
 */
export function getMediaItemConfig(
  v: MediaFile,
  {
    batchVideoLongerSide,
    batchImageLongerSide,
  }: {
    batchVideoLongerSide: number | null
    batchImageLongerSide: number | null
  },
): MediaItem {
  if (v.type === 'video' && v.isAudioFile) {
    v = getAudioFileForCompression(v)
  }
  return {
    videoConfig:
      v.type === 'video'
        ? ({
            videoId: v.id!,
            videoPath: v.pathRaw!,
            convertToExtension: (v.config?.convertToExtension === '-'
              ? v.extension
              : v.config.convertToExtension)!,
            // The backend compresses (CRF from the quality) when a preset is set, and keeps
            // the source codec otherwise (lossless)
            presetName: !v.config?.shouldDisableCompression ? 'ironclad' : null,
            quality: !v.config?.shouldDisableCompression
              ? (v.config?.quality as number)
              : 101,
            audioConfig: {
              volume: v.config?.audioConfig?.volume ?? 100,
              audioChannelConfig:
                (v.config?.audioConfig?.volume ?? 100) !== 0
                  ? (v.config?.audioConfig?.audioChannelConfig ?? null)
                  : null,
              bitrate:
                (v.config?.audioConfig?.volume ?? 100) !== 0
                  ? (v.config?.audioConfig?.bitrate ?? null)
                  : null,
              audioCodec:
                v.config?.shouldEnableCustomAudioCodec &&
                v.config.audioConfig?.audioCodec !== '-'
                  ? (v.config?.audioConfig?.audioCodec ?? null)
                  : null,
              selectedAudioTracks:
                v.config?.shouldEnableAudioTrackSelection &&
                (v.config?.audioConfig?.volume ?? 100) !== 0
                  ? (v.config?.selectedAudioTracks ?? null)
                  : null,
            },
            dimensions:
              v.config?.shouldEnableCustomDimensions &&
              v.config.customDimensions
                ? ([
                    Math.round(v.config.customDimensions[0]),
                    Math.round(v.config.customDimensions[1]),
                  ] as [number, number])
                : v.dimensions
                  ? getLongerSideDimensions(
                      getTransformedDimensions(
                        v.dimensions,
                        v.config?.shouldTransformVideo
                          ? v.config.transformVideoConfig?.transformHistory
                          : null,
                      ),
                      batchVideoLongerSide,
                    )
                  : null,

            speed:
              v.config?.shouldEnableCustomSpeed && v.config.customSpeed !== 1
                ? v.config.customSpeed
                : null,
            fps: v.config?.shouldEnableCustomFPS
              ? v.config.customFPS?.toString?.()
              : null,
            videoCodec:
              v.config?.shouldEnableCustomVideoCodec &&
              v.config?.customVideoCodec !== '-'
                ? v.config.customVideoCodec
                : null,
            transformHistory: v.config?.shouldTransformVideo
              ? ((v.config.transformVideoConfig?.transformHistory ??
                  []) as MediaTransformHistory[])
              : null,
            stripMetadata: v.config?.shouldStripMetadata,
            metadataConfig:
              !v.config?.shouldStripMetadata && v.config?.metadataConfig
                ? Object.entries(
                    v.config?.metadataConfig as MediaMetadataConfig,
                  ).reduce(
                    (a, [key, value]: [string, any]) => {
                      a[key] = value?.length > 0 ? value : null
                      return a
                    },
                    {} as Record<string, string>,
                  )
                : null,
            customThumbnailPath:
              v.config?.shouldEnableCustomThumbnail &&
              v.config?.customThumbnailPath?.length
                ? v.config.customThumbnailPath
                : null,
            trimSegments:
              v.config?.shouldTrimVideo && Array.isArray(v.config?.trimConfig)
                ? (v.config.trimConfig
                    .filter((a) => a.end >= a.start)
                    .map(
                      (action: TimelineAction): VideoTrimSegment => ({
                        start: action.start,
                        end: action.end,
                      }),
                    ) as VideoTrimSegment[])
                : null,
            subtitlesConfig:
              (v.config?.subtitlesConfig?.shouldEnableSubtitles &&
                v.config?.subtitlesConfig?.subtitles?.length > 0) ||
              v.config?.subtitlesConfig?.preserveExistingSubtitles === true
                ? {
                    subtitles:
                      v.config.subtitlesConfig?.subtitles?.map((s) => ({
                        subtitlePath: s.subtitlePath ?? null,
                        language: s.language || 'eng',
                        fileName: s.fileName ?? null,
                        title: s.title,
                      })) ?? [],
                    shouldEnableSubtitles:
                      v.config.subtitlesConfig.shouldEnableSubtitles ?? false,
                    preserveExistingSubtitles:
                      v.config.subtitlesConfig.preserveExistingSubtitles,
                  }
                : null,
          } satisfies VideoCompressionConfig)
        : undefined,
    imageConfig:
      v.type === 'image'
        ? ({
            imageId: v.id!,
            convertToExtension: (v.config.convertToExtension === '-'
              ? v.extension
              : v.config.convertToExtension)!,
            imagePath: v.pathRaw!,
            isLossless: v.config.isLossless,
            quality: v.config.isLossless ? 100 : (v.config.quality ?? 100),
            stripMetadata: v.config.shouldStripMetadata,
            svgScaleFactor: v.config.svgScaleFactor ?? null,
            svgConfig: v.config?.shouldEnableAdvancedSvgSetting
              ? (v.config.svgConfig ?? null)
              : null,
            dimensions:
              v.config?.shouldEnableCustomDimensions &&
              v.config.customDimensions
                ? ([
                    v.config.customDimensions[0],
                    v.config.customDimensions[1],
                  ] as [number, number])
                : // The size of a batch (from a preset) for images without their own;
                  // SVGs are resized with the SVG scale factor instead
                  v.dimensions?.width &&
                    v.extension !== 'svg' &&
                    v.config.convertToExtension !== 'svg'
                  ? getLongerSideDimensions(
                      getTransformedDimensions(
                        v.dimensions,
                        v.config?.shouldTransformImage
                          ? v.config.transformImageConfig?.transformHistory
                          : null,
                      ),
                      batchImageLongerSide,
                    )
                  : null,
            transformHistory: v.config?.shouldTransformImage
              ? (v.config.transformImageConfig?.transformHistory as
                  | MediaTransformHistory[]
                  | null)
              : null,
          } satisfies ImageCompressionConfig)
        : undefined,
  }
}

/**
 * An audio file as it is compressed: written in an audio format, without the settings of videos,
 * at the bitrate of its Quality (unless a bitrate is chosen)
 */
function getAudioFileForCompression(
  audioFile: MediaFile & { type: 'video' },
): MediaFile & { type: 'video' } {
  const { config } = audioFile
  return {
    ...audioFile,
    dimensions: undefined,
    config: {
      ...config,
      convertToExtension: isAudioExtension(config.convertToExtension)
        ? config.convertToExtension
        : getAudioFileOutputExtension(audioFile.extension),
      shouldDisableCompression: false,
      shouldEnableCustomDimensions: false,
      shouldEnableCustomFPS: false,
      shouldEnableCustomVideoCodec: false,
      shouldTransformVideo: false,
      shouldEnableCustomThumbnail: false,
      subtitlesConfig: null,
      audioConfig: {
        ...config.audioConfig,
        bitrate:
          config.shouldEnableCustomBitrate && config.audioConfig?.bitrate
            ? config.audioConfig.bitrate
            : getAudioBitrateForQuality(config.quality),
      },
    },
  }
}
