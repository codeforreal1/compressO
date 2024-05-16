import { FileMetadata } from '@/types/fs'
import { core } from '@tauri-apps/api'

export function getFileMetadata(filePath: string): Promise<FileMetadata> {
  return core.invoke('get_file_metadata', { filePath })
}

export function getImageDimension(
  imagePath: string,
): Promise<[number, number]> {
  return core.invoke('get_image_dimension', { imagePath })
}

export function moveFile(from: string, to: string) {
  return core.invoke('move_file', { from, to })
}

export function deleteFile(path: string) {
  return core.invoke('delete_file', { path })
}
