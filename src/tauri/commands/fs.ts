import { core } from '@tauri-apps/api'

import { CollectedFile, FileMetadata } from '@/types/fs'

export function getFileMetadata(filePath: string): Promise<FileMetadata> {
  return core.invoke('get_file_metadata', { filePath })
}

export function getImageDimension(
  imagePath: string,
): Promise<[number, number]> {
  return core.invoke('get_image_dimension', { imagePath })
}

export function getSvgDimension(imagePath: string): Promise<[number, number]> {
  return core.invoke('get_svg_dimension', { imagePath })
}

/**
 * Moves a file without ever replacing an existing one (uses a numbered name like `clip (1).mp4`
 * instead). Resolves to the path the file was saved to.
 */
export function moveFile(from: string, to: string) {
  return core.invoke<string>('move_file', { from, to })
}

/** First unused path for `path`, numbered like `name (1)` if it already exists */
export function getAvailablePath(path: string, isDir: boolean) {
  return core.invoke<string>('get_available_path', { path, isDir })
}

export function deleteFile(path: string) {
  return core.invoke('delete_file', { path })
}

export function showItemInFileManager(path: string) {
  return core.invoke('show_item_in_file_manager', { path })
}

export function deleteCache() {
  return core.invoke('delete_cache')
}

export function copyFileToClipboard(filePath: string) {
  return core.invoke('copy_file_to_clipboard', {
    filePath,
  })
}

export function readFilesFromClipboard() {
  return core.invoke<CollectedFile[]>('read_files_from_clipboard')
}

export function readFilesFromPaths(paths: string[]) {
  return core.invoke<CollectedFile[]>('read_files_from_paths', { paths })
}
