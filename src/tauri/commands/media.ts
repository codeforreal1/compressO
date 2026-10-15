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
