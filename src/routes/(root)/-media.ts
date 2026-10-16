import { core } from '@tauri-apps/api'
import { open } from '@tauri-apps/plugin-dialog'
import cloneDeep from 'lodash/cloneDeep'

import { toast } from '@/components/Toast'
import { generateVideoThumbnail } from '@/tauri/commands/ffmpeg'
import { getVideoBasicInfo } from '@/tauri/commands/ffprobe'
import {
  getFileMetadata,
  getImageDimension,
  getSvgDimension,
  readFilesFromPaths,
} from '@/tauri/commands/fs'
import { convertSvgToPng } from '@/tauri/commands/image'
import { Image, Video } from '@/types/app'
import {
  extensions,
  inputExtensions,
  inputOnlyExtensions,
} from '@/types/compression'
import { CollectedFile } from '@/types/fs'
import { formatBytes } from '@/utils/fs'
import { isVideoPreviewAvailable } from '@/utils/video'
import {
  applyDefaultPresetsToBatchConfig,
  getInitialImageConfig,
  getInitialVideoConfig,
} from './-presets'
import {
  appProxy,
  imageConfigInitialState,
  normalizeBatchMediaConfig,
  videoConfigInitialState,
} from './-state'

/** File paths (picker, Open with) or files from dropped/pasted folders */
export type MediaSelection = string | CollectedFile

async function getSvgDimensionSilently(
  path: string,
): Promise<[number, number] | null> {
  try {
    const dimension = await getSvgDimension(path)
    return dimension
  } catch {
    return null
  }
}

/** Whether media can be added now: before compression starts (not during or after it) */
export function canAddMedia() {
  return !appProxy.state.isCompressing && !appProxy.state.isProcessCompleted
}

/**
 * Loads the selected media, adding it to the media already selected (if any). Files that are
 * already selected are skipped, so the same file is only added once.
 */
export async function addMedia(selection: MediaSelection | MediaSelection[]) {
  if (appProxy.state.isCompressing) return
  if (appProxy.state.isProcessCompleted) {
    toast.info(
      'Media cannot be added after compression. Start a new compression to add more media.',
    )
    return
  }

  const existingMediaCount = appProxy.state.media.length
  const selectedPaths = new Set(
    appProxy.state.media.map((mediaFile) => mediaFile.pathRaw),
  )

  const selectedFiles = (
    Array.isArray(selection) ? selection : [selection]
  ).map((file) =>
    typeof file === 'string' ? { path: file, relativeDir: '' } : file,
  )
  const supportedFiles = selectedFiles.filter(({ path: filePath }) => {
    const ext = filePath.split('.').pop()?.toLowerCase()
    return (
      ext &&
      (inputExtensions.video.includes(ext) ||
        inputExtensions.image.includes(ext))
    )
  })

  if (supportedFiles.length === 0) {
    toast.error('No valid media files found.')
    return
  }

  // Skip files that are already selected (or repeated within this selection)
  const mediaPaths = supportedFiles.filter(({ path }) => {
    if (selectedPaths.has(path)) return false
    selectedPaths.add(path)
    return true
  })

  if (mediaPaths.length === 0) {
    toast.info('The selected media has already been added.')
    return
  }

  appProxy.state.isLoadingMediaFiles = true
  appProxy.state.isAppendingMedia = existingMediaCount > 0
  // The batch settings start from the default presets (added media follows the batch settings)
  if (existingMediaCount === 0) {
    applyDefaultPresetsToBatchConfig()
  }
  // Includes the media already selected, for the batch loading progress
  appProxy.state.totalSelectedMediaCount =
    existingMediaCount + mediaPaths.length

  let corruptedFilesCount = 0
  for (const index in mediaPaths) {
    const { path, relativeDir } = mediaPaths[index]
    try {
      const fileMetadata = await getFileMetadata(path)
      const mediaType = fileMetadata.mimeType.startsWith('video')
        ? 'video'
        : 'image'

      if (
        !fileMetadata ||
        (typeof fileMetadata?.size === 'number' && mediaType === 'video'
          ? fileMetadata?.size <= 1000
          : fileMetadata?.size < 100)
      ) {
        corruptedFilesCount++
        continue
      }

      if (mediaType === 'video') {
        const [videoInfo, videoThumbnail] = await Promise.all([
          getVideoBasicInfo(path),
          generateVideoThumbnail(path),
        ])

        const videoState: Video & { type: 'video' } = {
          type: 'video',
          id: videoThumbnail?.id ?? `${index}-${+new Date()}`,
          pathRaw: path,
          path: core.convertFileSrc(path),
          relativeDir,
          fileName: fileMetadata?.fileName,
          mimeType: fileMetadata?.mimeType,
          sizeInBytes: fileMetadata?.size,
          size: formatBytes(fileMetadata?.size ?? 0),
          extension: fileMetadata?.extension?.toLowerCase?.(),
          config: cloneDeep(videoConfigInitialState),
          // A thumbnail instead where videos cannot be played (Linux, with video previews off)
          previewMode: isVideoPreviewAvailable ? 'video' : 'image',
        }

        // input-only formats stay "Same as input" since they aren't in the extension list
        if (videoState.extension && videoState.extension in extensions.video) {
          videoState.config.convertToExtension =
            videoState.extension as keyof (typeof extensions)['video']
        }

        if (videoInfo) {
          const dimensions = videoInfo.dimensions
          if (
            !Number.isNaN(videoInfo.dimensions?.[0]) &&
            !Number.isNaN(videoInfo.dimensions?.[1])
          ) {
            videoState.dimensions = {
              width: dimensions[0],
              height: dimensions[1],
            }
          }

          if (videoInfo.duration) {
            videoState.videoDuration = videoInfo.duration
          }

          if (videoInfo.fps) {
            videoState.fps = Math.ceil(videoInfo.fps)
          }
        }

        // Settings from the default video preset
        const { config: presetConfig, audioStreams } =
          await getInitialVideoConfig(videoState.config, {
            sourceExtension: videoState.extension,
            path,
            dimensions: videoState.dimensions,
          })
        videoState.config = presetConfig
        if (audioStreams) {
          videoState.videoInfoRaw = { audioStreams }
        }

        if (videoThumbnail) {
          videoState.id = videoThumbnail?.id
          videoState.thumbnailPathRaw = videoThumbnail?.filePath
          videoState.thumbnailPath = core.convertFileSrc(
            videoThumbnail?.filePath,
          )
        }
        appProxy.state.media.push(videoState)
      } else if (mediaType === 'image') {
        const imageDimension = await (path.endsWith('.svg')
          ? getSvgDimensionSilently(path)
          : getImageDimension(path))
        const imageState: Image & { type: 'image' } = {
          type: 'image',
          id: `${index}-${+new Date()}`,
          pathRaw: path,
          path: core.convertFileSrc(path),
          relativeDir,
          thumbnailPathRaw: path,
          thumbnailPath: core.convertFileSrc(path),
          fileName: fileMetadata?.fileName,
          mimeType: fileMetadata?.mimeType,
          sizeInBytes: fileMetadata?.size,
          size: formatBytes(fileMetadata?.size ?? 0),
          extension: fileMetadata?.extension?.toLowerCase?.(),
          config: cloneDeep(imageConfigInitialState),
          dimensions: {
            width: imageDimension?.[0] ?? 0,
            height: imageDimension?.[1] ?? 0,
          },
        }

        // input-only formats can't be written back, so default to lossless png
        if (
          (inputOnlyExtensions.image as readonly string[]).includes(
            imageState.extension ?? '',
          )
        ) {
          imageState.config.convertToExtension = 'png'
        }

        // Settings from the default image preset
        imageState.config = getInitialImageConfig(imageState.config, {
          sourceExtension: imageState.extension,
          dimensions: imageState.dimensions,
        })

        // create a static image thumbnail for gif due to performance reason,
        // and for tiff since webviews other than Safari can't display it
        const isTiff = ['tiff', 'tif'].includes(imageState.extension ?? '')
        if (path.endsWith('.gif') || isTiff) {
          try {
            const thumbnail = await generateVideoThumbnail(
              path,
              // a still image has no frame at the default 1s timestamp
              isTiff ? '00:00:00.00' : undefined,
            )
            imageState.thumbnailPathRaw = thumbnail.filePath
            imageState.thumbnailPath = core.convertFileSrc(thumbnail.filePath)
          } catch {}
        }

        // create a static image thumbnail for large svg due to performance reason
        if (path.endsWith('.svg') && fileMetadata?.size >= 0.5 * 1024 * 1024) {
          try {
            const outputPngPath = await convertSvgToPng(path, imageState.id!)
            imageState.thumbnailPathRaw = outputPngPath
            imageState.thumbnailPath = core.convertFileSrc(outputPngPath)
          } catch {}
        }
        appProxy.state.media.push(imageState)
      } else {
        throw new Error('Invalid media type.')
      }
    } catch {
      corruptedFilesCount++
    }
  }
  appProxy.state.isLoadingMediaFiles = false
  appProxy.state.isAppendingMedia = false

  // Added media follows the batch settings (media with customized settings keeps them)
  if (existingMediaCount > 0) {
    normalizeBatchMediaConfig()
  }

  if (corruptedFilesCount > 0) {
    toast.error(
      mediaPaths.length > 1
        ? 'Some files appear to be corrupted or invalid and were not added.'
        : 'The file appears to be corrupted or invalid.',
    )
    // Only start over when nothing was selected before
    if (corruptedFilesCount === mediaPaths.length && existingMediaCount === 0) {
      appProxy.resetProxy()
    }
  }
}

/** Opens the file picker and adds the chosen media */
export async function pickMediaToAdd() {
  try {
    const filePath = await open({
      directory: false,
      multiple: true,
      title: `Select images/videos to compress.`,
      filters: [
        { name: 'video', extensions: inputExtensions.video },
        { name: 'image', extensions: inputExtensions.image },
      ],
    })
    if (filePath == null) {
      return
    }
    await addMedia(filePath)
  } catch (error: any) {
    toast.error(error?.message ?? 'Could not select media.')
  }
}

/**
 * Opens files & folders from outside the window ("Open with CompressO", or dropped on the menu bar
 * popover). A finished compression whose outputs are all saved is replaced by the new media; with
 * unsaved outputs, the new media is refused (see `addMedia`) so nothing is lost.
 */
export async function openExternalMedia(paths: string[]) {
  const { isCompressing, isProcessCompleted, media } = appProxy.state
  if (isCompressing) return

  const hasUnsavedOutput = media.some(
    (mediaFile) =>
      mediaFile.compressedFile?.isSuccessful &&
      !mediaFile.compressedFile?.isSaved,
  )
  if (isProcessCompleted && !hasUnsavedOutput) {
    appProxy.resetProxy()
  }

  try {
    // Folders are expanded into the media they contain
    const files = await readFilesFromPaths(paths)
    await addMedia(files)
  } catch {
    toast.error('Invalid files/folders')
  }
}
