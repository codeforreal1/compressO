import {
  CompressionResult,
  VideoInfo,
  VideoThumbnail,
  VideoTransforms,
} from '@/types/compression'
import { FileMetadata } from '@/types/fs'
import { core } from '@tauri-apps/api'

export function compressVideo({
  videoPath,
  convertToExtension,
  presetName,
  videoId,
  shouldMuteVideo = false,
  quality = 101, // quality should be within 0-100, but if you supply out of bound value, backend will automatically select optimum quality
  dimensions,
  fps,
  transforms,
}: {
  videoPath: string
  convertToExtension?: string
  presetName?: string | null
  videoId?: string | null
  shouldMuteVideo?: boolean
  quality?: number
  dimensions?: readonly [number, number]
  fps?: string
  transforms?: VideoTransforms
}): Promise<CompressionResult> {
  return core.invoke('compress_video', {
    videoPath,
    convertToExtension: convertToExtension ?? 'mp4',
    presetName,
    videoId,
    shouldMuteVideo,
    quality,
    fps,
    ...(dimensions
      ? { dimensions: [Math.round(dimensions[0]), Math.round(dimensions[1])] }
      : {}),
    ...(transforms
      ? {
          transforms: {
            ...transforms,
            coordinates: {
              top: Math.round(transforms.coordinates.top),
              left: Math.round(transforms?.coordinates.left),
              width: Math.round(transforms?.coordinates.width),
              height: Math.round(transforms?.coordinates.height),
            },
          },
        }
      : {}),
  })
}

export function generateVideoThumbnail(
  videoPath: string,
): Promise<VideoThumbnail> {
  return core.invoke('generate_video_thumbnail', { videoPath })
}

export function getFileMetadata(filePath: string): Promise<FileMetadata> {
  return core.invoke('get_file_metadata', { filePath })
}

export function getVideoInfo(videoPath: string): Promise<VideoInfo | null> {
  return core.invoke('get_video_info', { videoPath })
}
