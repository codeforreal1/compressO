import {
  CompressionResult,
  VideoInfo,
  VideoThumbnail,
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
}: {
  videoPath: string
  convertToExtension?: string
  presetName?: string | null
  videoId?: string | null
  shouldMuteVideo?: boolean
  quality?: number
  dimensions?: readonly [number, number]
  fps?: string
}): Promise<CompressionResult> {
  return core.invoke('compress_video', {
    videoPath,
    convertToExtension: convertToExtension ?? 'mp4',
    presetName,
    videoId,
    shouldMuteVideo,
    quality,
    dimensions,
    fps,
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
