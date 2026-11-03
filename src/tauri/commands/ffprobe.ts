import { core } from '@tauri-apps/api'

import {
  AudioStream,
  Chapter,
  ContainerInfo,
  SubtitleStream,
  VideoInfo,
  VideoStream,
} from '@/types/compression'
import type { VideoDynamicRangeInfo } from '@/types/videoDynamicRange'

export function getVideoBasicInfo(
  videoPath: string,
): Promise<VideoInfo | null> {
  return core.invoke('get_video_basic_info', { videoPath })
}

export function getContainerInfo(
  videoPath: string,
): Promise<ContainerInfo | null> {
  return core.invoke('get_container_info', { videoPath })
}

export function getVideoStreams(
  videoPath: string,
): Promise<VideoStream[] | null> {
  return core.invoke('get_video_streams', { videoPath })
}

export function getVideoDynamicRange(videoPath: string) {
  return core.invoke<VideoDynamicRangeInfo>('get_video_dynamic_range', {
    videoPath,
  })
}

export function getAudioStreams(
  videoPath: string,
): Promise<AudioStream[] | null> {
  return core.invoke('get_audio_streams', { videoPath })
}

export function getSubtitleStreams(
  videoPath: string,
): Promise<SubtitleStream[] | null> {
  return core.invoke('get_subtitle_streams', { videoPath })
}

export function getChapters(videoPath: string): Promise<Chapter[] | null> {
  return core.invoke('get_chapters', { videoPath })
}
