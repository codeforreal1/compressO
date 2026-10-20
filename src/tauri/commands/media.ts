import { core } from '@tauri-apps/api'

import {
  ImageCompressionConfig,
  MediaBatchCompressionResult,
  VideoCompressionConfig,
} from '@/types/compression'

export async function compressMediaBatch(
  batchId: string,
  media: {
    videoConfig?: VideoCompressionConfig
    imageConfig?: ImageCompressionConfig
  }[],
): Promise<MediaBatchCompressionResult> {
  return core.invoke('compress_media_batch', {
    batchId,
    media,
  })
}

/** Pauses a batch after the media being compressed, or resumes it */
export function setBatchPaused(batchId: string, paused: boolean) {
  return core.invoke<void>('set_batch_paused', { batchId, paused })
}

/**
 * About the size a video comes out at with its settings, in bytes (a few short parts of it are
 * compressed); stopped like a compression, with `estimateId`
 * - `duration`: the video's length, in seconds
 */
export function estimateVideoSize(
  estimateId: string,
  config: VideoCompressionConfig,
  duration: number,
) {
  return core.invoke<number>('estimate_video_size', {
    estimateId,
    config,
    duration,
  })
}
