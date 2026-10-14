import type { CSSProperties } from 'react'

import type { ImageConfig, VideoConfig } from '@/types/app'
import {
  type CropAspectRatio,
  cropAspectRatios,
  type MediaTransformHistory,
  type MediaTransforms,
  type PortableTransform,
} from '@/types/compression'

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

/** A rotation in degrees as 0, 90, 180 or 270 (clockwise) */
export function normalizeRotation(rotate: number | null | undefined) {
  const quarters = Math.round((rotate ?? 0) / 90)
  return (((quarters % 4) + 4) % 4) * 90
}

/** The largest area of an aspect ratio that fits in a size, centered */
export function getAspectRatioCrop(
  size: { width: number; height: number },
  aspectRatio: CropAspectRatio,
) {
  const [ratioWidth, ratioHeight] = cropAspectRatios[aspectRatio]
  const ratio = ratioWidth / ratioHeight
  const width = Math.min(size.width, Math.round(size.height * ratio))
  const height = Math.min(size.height, Math.round(width / ratio))
  return {
    left: Math.round((size.width - width) / 2),
    top: Math.round((size.height - height) / 2),
    width,
    height,
  }
}

/**
 * The transforms & history (as made by the crop editor) of a portable transform, for a media of a
 * size (upright, before transforms): flips, then the rotation, then the crop shape, centered in the
 * rotated media. `null` when nothing changes (e.g. a square image cropped to 1:1).
 */
export function getTransformsForMedia(
  portable: PortableTransform,
  size: { width: number; height: number },
): {
  transforms: MediaTransforms
  transformHistory: MediaTransformHistory[]
} | null {
  const rotate = normalizeRotation(portable.rotate)
  const flip = {
    horizontal: !!portable.flip?.horizontal,
    vertical: !!portable.flip?.vertical,
  }
  const rotatedSize =
    rotate % 180 === 90
      ? { width: size.height, height: size.width }
      : { width: size.width, height: size.height }
  const fullCrop = { left: 0, top: 0, ...rotatedSize }
  const crop =
    portable.aspectRatio && portable.aspectRatio in cropAspectRatios
      ? getAspectRatioCrop(rotatedSize, portable.aspectRatio)
      : fullCrop

  // Replayed in order by the backend: the rotation, then the flips (in the output's axes), then the
  // crop (centered, so the flips do not move it)
  const transformHistory: MediaTransformHistory[] = []
  if (rotate) transformHistory.push({ type: 'rotate', value: rotate })
  if (flip.horizontal || flip.vertical) {
    transformHistory.push({ type: 'flip', value: flip })
  }
  if (crop.width !== rotatedSize.width || crop.height !== rotatedSize.height) {
    transformHistory.push({ type: 'crop', value: crop })
  }
  if (!transformHistory.length) return null

  // The crop editor keeps its flips in the media's own axes (before the rotation), which are
  // swapped by a quarter turn
  const editorFlip =
    rotate % 180 === 90
      ? { horizontal: flip.vertical, vertical: flip.horizontal }
      : flip
  return {
    transforms: { crop, rotate, flip: editorFlip },
    transformHistory,
  }
}

type TransformConfig = NonNullable<
  VideoConfig['transformVideoConfig'] | ImageConfig['transformImageConfig']
>

/** A rotation and/or flips as a 2x2 matrix (rows), applied to a point as `matrix · point` */
type Matrix = [[number, number], [number, number]]

const multiply = (a: Matrix, b: Matrix): Matrix => [
  [
    a[0][0] * b[0][0] + a[0][1] * b[1][0],
    a[0][0] * b[0][1] + a[0][1] * b[1][1],
  ],
  [
    a[1][0] * b[0][0] + a[1][1] * b[1][0],
    a[1][0] * b[0][1] + a[1][1] * b[1][1],
  ],
]

const ROTATIONS: Record<number, Matrix> = {
  0: [
    [1, 0],
    [0, 1],
  ],
  90: [
    [0, -1],
    [1, 0],
  ],
  180: [
    [-1, 0],
    [0, -1],
  ],
  270: [
    [0, 1],
    [-1, 0],
  ],
}
const FLIP_HORIZONTAL: Matrix = [
  [-1, 0],
  [0, 1],
]
const FLIP_VERTICAL: Matrix = [
  [1, 0],
  [0, -1],
]

const isSameMatrix = (a: Matrix, b: Matrix) =>
  a[0][0] === b[0][0] &&
  a[0][1] === b[0][1] &&
  a[1][0] === b[1][0] &&
  a[1][1] === b[1][1]

/**
 * The portable part of a media's transforms (rotation, flips, crop shape); `null` when none. A free
 * crop is not portable. Read from the history, which is what the backend applies: any sequence of
 * rotations & flips comes down to a rotation followed by (at most) a horizontal flip.
 */
export function getPortableTransform(
  transformConfig: TransformConfig | null | undefined,
): PortableTransform | null {
  if (!transformConfig) return null
  let matrix = ROTATIONS[0]
  for (const action of transformConfig.transformHistory ?? []) {
    if (action.type === 'rotate') {
      matrix = multiply(ROTATIONS[normalizeRotation(action.value)], matrix)
    } else if (action.type === 'flip') {
      if (action.value.horizontal) matrix = multiply(FLIP_HORIZONTAL, matrix)
      if (action.value.vertical) matrix = multiply(FLIP_VERTICAL, matrix)
    }
  }
  // A flip mirrors (negative determinant); without it, the matrix is a rotation
  const isFlipped =
    matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0] < 0
  const rotationMatrix = isFlipped ? multiply(FLIP_HORIZONTAL, matrix) : matrix
  const rotate = Number(
    Object.keys(ROTATIONS).find((angle) =>
      isSameMatrix(ROTATIONS[Number(angle)], rotationMatrix),
    ) ?? 0,
  )

  const portable: PortableTransform = {
    rotate,
    flip: { horizontal: isFlipped, vertical: false },
    aspectRatio: transformConfig.aspectRatio ?? null,
  }
  return portable.rotate || isFlipped || portable.aspectRatio ? portable : null
}

/**
 * Renders the preview of transforms (as the backend applies them: flips, rotation, then the crop)
 * as a blob url, at most `maxSize` on its longer side
 */
export async function renderTransformPreview(
  src: string,
  transforms: MediaTransforms,
  maxSize = 1600,
): Promise<string> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.src = src
  await image.decode()
  // The browser shows photos upright (EXIF orientation), like the backend makes them
  const width = image.naturalWidth
  const height = image.naturalHeight
  const rotate = normalizeRotation(transforms.rotate)
  const isQuarterTurned = rotate % 180 === 90
  const rotatedWidth = isQuarterTurned ? height : width
  const rotatedHeight = isQuarterTurned ? width : height

  const crop =
    transforms.crop?.width && transforms.crop?.height
      ? transforms.crop
      : { left: 0, top: 0, width: rotatedWidth, height: rotatedHeight }
  const scale = Math.min(1, maxSize / Math.max(crop.width, crop.height))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(crop.width * scale))
  canvas.height = Math.max(1, Math.round(crop.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not supported')
  context.scale(scale, scale)
  // Moves the crop to the origin, then draws the rotated & flipped media around its center
  context.translate(-crop.left, -crop.top)
  context.translate(rotatedWidth / 2, rotatedHeight / 2)
  context.rotate((rotate * Math.PI) / 180)
  context.scale(
    transforms.flip?.horizontal ? -1 : 1,
    transforms.flip?.vertical ? -1 : 1,
  )
  context.drawImage(image, -width / 2, -height / 2)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  if (!blob) throw new Error('The preview could not be rendered')
  return URL.createObjectURL(blob)
}

/**
 * Applies a portable transform (e.g. from a preset) to a media's config: replaces its transforms with
 * the ones computed for its size (`size`: upright, before transforms). Without a portable transform,
 * only transforms set by a preset are removed (the media's own edits are kept). Returns:
 * - `applied`: the media is transformed
 * - `none`: there is nothing to apply
 * - `unchanged`: the transform changes nothing for this media (e.g. a square image cropped to 1:1)
 * - `skipped`: the size of the media is not known
 */
export function applyPortableTransform(
  config: VideoConfig | ImageConfig,
  mediaType: 'video' | 'image',
  portable: PortableTransform | null | undefined,
  size: { width: number; height: number } | null | undefined,
): 'applied' | 'none' | 'unchanged' | 'skipped' {
  const fields =
    mediaType === 'video'
      ? ({
          should: 'shouldTransformVideo',
          transformConfig: 'transformVideoConfig',
          editMode: 'isVideoTransformEditMode',
        } as const)
      : ({
          should: 'shouldTransformImage',
          transformConfig: 'transformImageConfig',
          editMode: 'isImageTransformEditMode',
        } as const)
  const target = config as Record<string, unknown>
  const current = target[fields.transformConfig] as TransformConfig | undefined

  const clear = () => {
    target[fields.should] = false
    target[fields.transformConfig] = undefined
    target[fields.editMode] = false
  }

  if (!portable) {
    if (current?.isFromPreset) clear()
    return 'none'
  }
  if (!size?.width || !size?.height) return 'skipped'

  const result = getTransformsForMedia(portable, size)
  if (!result) {
    if (!current || current.isFromPreset) clear()
    return 'unchanged'
  }
  target[fields.should] = true
  target[fields.editMode] = false
  target[fields.transformConfig] = {
    ...result,
    aspectRatio: portable.aspectRatio,
    isFromPreset: true,
    // Rendered for the preview (see `MediaThumbnail`)
    previewUrl: undefined,
  } satisfies TransformConfig
  return 'applied'
}
