import { invoke } from '@tauri-apps/api/core'

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
      // biome-ignore lint/suspicious/noConsole: <>
      console.error('Failed to generate video URL:', error)
      const encodedPath = encodeURIComponent(filePath)
      return `${serverUrl}/video?path=${encodedPath}`
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
