import { estimateVideoSize } from '@/tauri/commands/media'
import {
  getQualityEstimateKey,
  getQualityMediaItemConfig,
  type MediaFile,
  qualitySizeEstimates,
} from './-compression'

/**
 * The size a video comes out at with its quality settings, estimated by compressing short parts of
 * it (see `estimate_video_size`, which takes a while, so only when compressing to a target size
 * starts), & kept by its settings (`getQualityEstimateKey`) so it is estimated once for them. When
 * the quality settings fit the target size (or nearly), they are used (see `getTargetSizePlan`).
 */

/** Settings whose estimate failed, not tried again */
const failedKeys = new Set<string>()
/** Estimates being made, by their key */
const estimatesInProgress = new Map<string, Promise<number | null>>()

/**
 * A video's estimated size at its quality settings, in bytes (`null` when it cannot be estimated),
 * estimated now unless known or being estimated
 */
export function estimateQualitySize(
  media: MediaFile,
  batchVideoLongerSide: number | null,
): Promise<number | null> {
  const key = getQualityEstimateKey(media, batchVideoLongerSide)
  if (!key || failedKeys.has(key)) return Promise.resolve(null)
  const known = qualitySizeEstimates.sizes[key]
  if (known != null) return Promise.resolve(known)
  const inProgress = estimatesInProgress.get(key)
  if (inProgress) return inProgress

  const { videoConfig } = getQualityMediaItemConfig(media, batchVideoLongerSide)
  if (!videoConfig || media.type !== 'video' || !media.videoDuration) {
    return Promise.resolve(null)
  }
  const estimate = estimateVideoSize(
    `estimate-${crypto.randomUUID()}`,
    videoConfig,
    media.videoDuration,
  )
    .then((size) => {
      qualitySizeEstimates.sizes[key] = size
      return size
    })
    .catch(() => {
      failedKeys.add(key)
      return null
    })
    .finally(() => {
      estimatesInProgress.delete(key)
    })
  estimatesInProgress.set(key, estimate)
  return estimate
}

/**
 * Estimates the videos compressed to a target size whose quality settings are not estimated yet,
 * one at a time, so those whose quality settings fit are compressed at them (see `-compression.ts`)
 */
/** Whether a video compressed to a target size has its size at its quality settings to estimate */
export function needsQualityEstimate(
  media: MediaFile,
  batchVideoLongerSide: number | null,
) {
  if (media.type !== 'video' || !media.config?.shouldUseTargetSize) {
    return false
  }
  const key = getQualityEstimateKey(media, batchVideoLongerSide)
  return (
    !!key && !failedKeys.has(key) && qualitySizeEstimates.sizes[key] == null
  )
}

export async function estimateTargetSizeVideos(
  media: readonly MediaFile[],
  batchVideoLongerSide: number | null,
  signal?: AbortSignal,
) {
  for (const item of media) {
    if (signal?.aborted) return
    if (needsQualityEstimate(item, batchVideoLongerSide)) {
      await estimateQualitySize(item, batchVideoLongerSide)
    }
  }
}
