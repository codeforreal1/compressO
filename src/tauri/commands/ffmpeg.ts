import { CompressionResult, VideoThumbnail } from '@/types/compression'
import { FileMetadata } from '@/types/fs'
import { core } from '@tauri-apps/api'

export function compressVideo({
  videoPath,
  convertToExtension,
  presetName,
  videoId,
  shouldMuteVideo = false,
}: {
  videoPath: string
  convertToExtension?: string
  presetName?: string | null
  videoId?: string | null
  shouldMuteVideo?: boolean
}): Promise<CompressionResult> {
  return core.invoke('compress_video', {
    videoPath,
    convertToExtension: convertToExtension ?? 'mp4',
    presetName,
    videoId,
    shouldMuteVideo,
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

export function getVideoDuration(videoPath: string): Promise<string | null> {
  return core.invoke('get_video_duration', { videoPath })
}
