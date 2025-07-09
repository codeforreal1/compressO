export const extensions = {
  video: { mp4: 'mp4', mov: 'mov', mkv: 'mkv', webm: 'webm', avi: 'avi' },
} as const

export const compressionPresets = {
  ironclad: 'ironclad',
  thunderbolt: 'thunderbolt',
} as const

export type CompressionResult = {
  fileName: string
  filePath: string
}

export enum CustomEvents {
  VideoCompressionProgress = 'VideoCompressionProgress',
  CancelInProgressCompression = 'CancelInProgressCompression',
}

export type VideoCompressionProgress = {
  videoId: string
  fileName: string
  currentDuration: string
}

export type VideoThumbnail = {
  id: string
  fileName: string
  filePath: string
}

export type VideoInfo = {
  duration: string
  dimensions: [number, number]
}
