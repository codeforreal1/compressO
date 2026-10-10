import type { CSSProperties } from 'react'

import { MediaTransformHistory } from '@/types/compression'

export type TransformPreview = {
  /** Aspect ratio of the output (the crop area) */
  aspectRatio: number
  /** Width of the output in source pixels */
  croppedWidth: number
  /** Full rotated/flipped frame, offset so only the crop area is visible */
  frameStyle: CSSProperties
  /** Media (video/image) box centered in the frame, with the rotations/flips applied */
  mediaStyle: CSSProperties
}

const toPercent = (value: number) => `${value * 100}%`

/**
 * CSS that previews transforms live on a video or animated image. Mirrors the ffmpeg filters built by
 * `build_transform_filters` in the backend: rotations & flips in history order, then the latest crop.
 */
export function getTransformPreview(
  transformHistory: readonly MediaTransformHistory[],
  mediaWidth: number,
  mediaHeight: number,
): TransformPreview | null {
  if (!mediaWidth || !mediaHeight || transformHistory.length === 0) {
    return null
  }

  const operations: string[] = []
  let isQuarterTurned = false
  let crop: Extract<MediaTransformHistory, { type: 'crop' }>['value'] | null =
    null

  for (const action of transformHistory) {
    if (action.type === 'rotate') {
      switch (action.value % 360) {
        case 90:
        case -270:
          operations.push('rotate(90deg)')
          isQuarterTurned = !isQuarterTurned
          break
        case -90:
        case 270:
          operations.push('rotate(-90deg)')
          isQuarterTurned = !isQuarterTurned
          break
        case 180:
        case -180:
          operations.push('rotate(180deg)')
          break
      }
    } else if (action.type === 'flip') {
      if (action.value.horizontal) operations.push('scaleX(-1)')
      if (action.value.vertical) operations.push('scaleY(-1)')
    } else {
      crop = action.value
    }
  }

  const frameWidth = isQuarterTurned ? mediaHeight : mediaWidth
  const frameHeight = isQuarterTurned ? mediaWidth : mediaHeight

  const cropArea =
    crop && crop.width > 0 && crop.height > 0
      ? crop
      : { left: 0, top: 0, width: frameWidth, height: frameHeight }

  return {
    aspectRatio: cropArea.width / cropArea.height,
    croppedWidth: cropArea.width,
    frameStyle: {
      position: 'absolute',
      width: toPercent(frameWidth / cropArea.width),
      height: toPercent(frameHeight / cropArea.height),
      left: toPercent(-cropArea.left / cropArea.width),
      top: toPercent(-cropArea.top / cropArea.height),
    },
    mediaStyle: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: toPercent(mediaWidth / frameWidth),
      height: toPercent(mediaHeight / frameHeight),
      // CSS applies the right-most transform first, so reverse to keep the history order
      transform: ['translate(-50%, -50%)', ...operations.reverse()].join(' '),
    },
  }
}
