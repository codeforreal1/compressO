import { core } from '@tauri-apps/api'

import {
  ExifInfo,
  ImageBasicInfo,
  ImageColorInfo,
  ImageDimensions,
} from '@/types/compression'

export async function convertSvgToPng(imagePath: string, imageId: string) {
  return await core.invoke<string>('convert_svg_to_png', {
    imagePath,
    imageId,
  })
}

export function getImageBasicInfo(imagePath: string): Promise<ImageBasicInfo> {
  return core.invoke('get_image_basic_info', { imagePath })
}

export function getImageDimensions(
  imagePath: string,
): Promise<ImageDimensions> {
  return core.invoke('get_image_dimensions', { imagePath })
}

export function getImageColorInfo(imagePath: string): Promise<ImageColorInfo> {
  return core.invoke('get_image_color_info', { imagePath })
}

export function getExifInfo(imagePath: string): Promise<ExifInfo> {
  return core.invoke('get_exif_info', { imagePath })
}

export function needsImagePreview(path: string) {
  return /\.(jxl|heic|heif)$/i.test(path)
}

export function prepareImagePreview(imagePath: string): Promise<string> {
  return core.invoke('prepare_image_preview', { imagePath })
}

export function getWebImageDimensions(src: string): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve([image.naturalWidth, image.naturalHeight])
    image.onerror = () => reject(new Error('WebView cannot display this image'))
    image.src = src
  })
}
