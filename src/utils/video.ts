import { invoke } from '@tauri-apps/api/core'

import { MediaTransformHistory } from '@/types/compression'
import { getPlatform } from './fs'

export async function getServerUrl(): Promise<string | null> {
  const platform = getPlatform()

  if (!platform.isLinux) {
    return null
  }

  if (window.__serverUrl) {
    return window.__serverUrl
  }

  try {
    const serverUrl = await invoke<string>('get_server_url')
    window.__serverUrl = serverUrl
    return serverUrl
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: <>
    console.error('Failed to get video server URL:', error)
    return null
  }
}

export async function constructVideoUrl(filePath: string): Promise<string> {
  const platform = getPlatform()

  if (platform.isLinux) {
    const serverUrl = await getServerUrl()

    if (!serverUrl) {
      // biome-ignore lint/suspicious/noConsole: <>
      console.warn('Video server not available, file may not play on Linux')
      return filePath
    }

    try {
      return await invoke<string>('construct_video_url', { filePath })
    } catch (error) {
      // Links are only made by the backend, with the server's secret
      // biome-ignore lint/suspicious/noConsole: <>
      console.error('Failed to generate video URL:', error)
      return filePath
    }
  }

  return filePath
}

/** Container a video is written as, resolving "Same as input" and input-only aliases. */
export function getOutputVideoContainer(
  convertToExtension: string | undefined,
  sourceExtension: string | null | undefined,
) {
  const extension =
    convertToExtension === '-' ? sourceExtension : convertToExtension
  switch (extension) {
    case 'm4v':
      return 'mp4'
    case 'mts':
    case 'm2ts':
      return 'ts'
    default:
      return extension ?? ''
  }
}

type Dimensions = { width: number; height: number }

/**
 * Size of a video after its transforms: the crop size when cropped (the crop is applied after the
 * rotations), otherwise the original size with width & height swapped by quarter-turn rotations.
 */
export function getTransformedDimensions(
  dimensions: Dimensions,
  transformHistory: readonly MediaTransformHistory[] | null | undefined,
): Dimensions {
  let isQuarterTurned = false
  let crop: Dimensions | null = null
  for (const action of transformHistory ?? []) {
    if (action.type === 'rotate' && Math.abs(action.value % 180) === 90) {
      isQuarterTurned = !isQuarterTurned
    } else if (action.type === 'crop') {
      crop = { width: action.value.width, height: action.value.height }
    }
  }
  if (crop) return crop
  return isQuarterTurned
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions
}

/**
 * Dimensions with the longer side (the width of a landscape media, the height of a portrait one)
 * scaled to `longerSide`, keeping the aspect ratio, rounded to even numbers (required by video
 * encoders). Smaller media is upscaled; `null` without a size.
 */
export function getLongerSideDimensions(
  dimensions: Dimensions,
  longerSide: number | null,
): [number, number] | null {
  const { width, height } = dimensions
  if (!longerSide || !width || !height) return null

  const originalLongerSide = Math.max(width, height)

  const toEven = (value: number) => Math.max(2, Math.round(value / 2) * 2)
  const scale = longerSide / originalLongerSide
  return [toEven(width * scale), toEven(height * scale)]
}
