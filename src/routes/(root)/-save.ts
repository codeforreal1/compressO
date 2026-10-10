import { appDataDir } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { snapshot } from 'valtio'

import { toast } from '@/components/Toast'
import { settingsStore } from '@/stores/settingsStore'
import { getAvailablePath, moveFile } from '@/tauri/commands/fs'
import { Image, Video } from '@/types/app'
import { getParentDirectory } from '@/utils/fs'
import { appProxy } from './-state'

type Media = (Video & { type: 'video' }) | (Image & { type: 'image' })

/**
 * Saves every compressed output that isn't saved yet into the directory returned by
 * `getBaseDirectory` (skipped when it returns `null`).
 *
 * Dropped folders keep their structure with the top folder prefixed (`Vacation/Day1` ->
 * `<base>/compressO-Vacation/Day1`). Existing files & folders are never replaced; numbered names
 * like `clip (1).mp4` are used instead. Each file is saved independently, so one failure doesn't
 * stop the rest; failed files stay unsaved for the Save button.
 */
async function saveCompressedMedia(
  getBaseDirectory: (media: Media) => string | null,
) {
  const prefix = settingsStore.outputFilePrefix
  // Resolved once per save so all of a dropped folder's files go into the same top folder
  const destinationTopFolders = new Map<string, string>()
  const savedLocations = new Set<string>()
  let lastSavedPath: string | null = null
  let savedCount = 0
  let failedCount = 0

  appProxy.state.isSaving = true
  const { media } = appProxy.state
  for (let i = 0; i < media.length; i++) {
    const mediaFile = media[i]
    const { compressedFile } = mediaFile
    if (!compressedFile?.pathRaw || compressedFile.isSaved) continue

    const baseDirectory = getBaseDirectory(mediaFile)
    if (baseDirectory == null) continue

    appProxy.state.media[i].compressedFile = {
      ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
      isSaving: true,
    }
    try {
      let destinationDirectory = baseDirectory
      let location = baseDirectory
      if (mediaFile.relativeDir) {
        const [topFolder, ...subFolders] = mediaFile.relativeDir.split('/')
        const topFolderKey = `${baseDirectory}\n${topFolder}`
        let destinationTopFolder = destinationTopFolders.get(topFolderKey)
        if (!destinationTopFolder) {
          destinationTopFolder = await getAvailablePath(
            `${baseDirectory}/${prefix}${topFolder}`,
            true,
          )
          destinationTopFolders.set(topFolderKey, destinationTopFolder)
        }
        destinationDirectory = [destinationTopFolder, ...subFolders].join('/')
        location = destinationTopFolder
      }

      const savedPath = await moveFile(
        compressedFile.pathRaw,
        `${destinationDirectory}/${prefix}${compressedFile.fileNameToDisplay || mediaFile.fileName}`,
      )
      savedLocations.add(location)
      lastSavedPath = savedPath
      savedCount++
      appProxy.state.media[i].compressedFile = {
        ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
        savedPath,
        isSaving: false,
        isSaved: true,
      }
    } catch (_) {
      failedCount++
      appProxy.state.media[i].compressedFile = {
        ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
        isSaving: false,
      }
    }
  }

  // "Show in folder" target: the file itself for a single output, otherwise the folder
  if (lastSavedPath) {
    appProxy.state.savedPath =
      appProxy.state.media.length === 1 || savedLocations.size !== 1
        ? lastSavedPath
        : [...savedLocations][0]
  }

  if (failedCount > 0) {
    toast.error(
      savedCount > 0
        ? `Saved ${savedCount} of ${savedCount + failedCount} files. ${failedCount} could not be saved. Use Save to try another location.`
        : 'Could not save media to the given path.',
    )
  }

  appProxy.state.isSaving = false
  appProxy.state.isSaved = appProxy.state.media.every(
    (mediaFile) =>
      !mediaFile.compressedFile?.isSuccessful ||
      !!mediaFile.compressedFile?.isSaved,
  )
}

/** Saves after asking where: a file location for a single output, a folder for a batch */
export async function saveCompressedMediaWithPrompt() {
  const { media } = appProxy.state
  if (!media.length) return

  if (media.length > 1) {
    const directory = await open({
      directory: true,
      title: 'Choose directory to save the compressed media.',
    })
    if (typeof directory === 'string') {
      await saveCompressedMedia(() => directory)
    }
    return
  }

  const [mediaFile] = media
  const { compressedFile } = mediaFile
  if (!compressedFile?.pathRaw) return

  const pathToSave = await save({
    title: 'Choose location to save the compressed media.',
    defaultPath: `${settingsStore.outputFilePrefix}${compressedFile.fileNameToDisplay ?? mediaFile.fileName ?? ''}`,
  })
  if (!pathToSave) return

  // The dialog gives the exact path (the name may have been edited), so it's used as is. Even if
  // "Replace" was confirmed in it, an existing file isn't replaced; a numbered name is used instead.
  appProxy.state.isSaving = true
  try {
    const savedPath = await moveFile(compressedFile.pathRaw, pathToSave)
    appProxy.state.savedPath = savedPath
    appProxy.state.media[0].compressedFile = {
      ...(snapshot(appProxy).state.media[0].compressedFile ?? {}),
      savedPath,
      isSaved: true,
    }
    appProxy.state.isSaved = true
  } catch (_) {
    toast.error('Could not save media to the given path.')
  } finally {
    appProxy.state.isSaving = false
  }
}

/**
 * Saves automatically after compression when a save location is set in Settings
 * (Output -> Save location). With "Ask every time" nothing happens and the Save button is used.
 * Never throws: failures show a toast and leave the Save button available.
 *
 * Some outputs are always left for the Save button:
 * - pasted images, which only exist in the app's data folder (no original folder to save next to)
 * - outputs larger than their original, when "Save larger outputs" is off
 */
export async function autoSaveCompressedMedia() {
  const { saveLocation, saveFolder, skipLargerOutputs } = settingsStore
  if (
    saveLocation === 'ask' ||
    (saveLocation === 'fixedFolder' && !saveFolder)
  ) {
    return
  }

  const appDataDirectory = await appDataDir().catch(() => null)
  let largerCount = 0

  await saveCompressedMedia((mediaFile) => {
    if (
      !mediaFile.pathRaw ||
      !appDataDirectory ||
      mediaFile.pathRaw.startsWith(appDataDirectory)
    ) {
      return null
    }

    const originalSize = mediaFile.sizeInBytes ?? 0
    const outputSize = mediaFile.compressedFile?.sizeInBytes ?? 0
    if (skipLargerOutputs && originalSize > 0 && outputSize > originalSize) {
      largerCount++
      return null
    }

    if (saveLocation === 'fixedFolder') {
      return saveFolder
    }
    // Same folder: where the file (or its dropped folder) is, e.g. `/a/Vacation/Day1/clip.mp4`
    // with `Vacation/Day1` -> `/a`
    const depth = mediaFile.relativeDir
      ? mediaFile.relativeDir.split('/').length
      : 0
    return getParentDirectory(mediaFile.pathRaw, depth + 1)
  })

  if (largerCount > 0) {
    toast.info(
      `${largerCount} ${largerCount > 1 ? 'outputs were' : 'output was'} larger than the original and not saved automatically. Use Save if you still want ${largerCount > 1 ? 'them' : 'it'}.`,
    )
  }
}
