import { appDataDir } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { snapshot } from 'valtio'

import { toast } from '@/components/Toast'
import { settingsStore } from '@/stores/settingsStore'
import {
  copyFilesToClipboard,
  getAvailablePath,
  moveFile,
} from '@/tauri/commands/fs'
import { Image, Video } from '@/types/app'
import { getParentDirectory } from '@/utils/fs'
import { appProxy } from './-state'

type Media = (Video & { type: 'video' }) | (Image & { type: 'image' })

/**
 * Saves every compressed output that isn't saved yet into the directory returned by
 * `getBaseDirectory` (skipped when it returns `null`).
 *
 * Dropped folders keep their structure & names (`Vacation/Day1` -> `<base>/Vacation/Day1`); only
 * files get the prefix. Existing files & folders are never replaced; numbered names like
 * `clip (1).mp4` or `Vacation (1)` are used instead. Each file is saved independently, so one failure doesn't
 * stop the rest; failed files stay unsaved for the Save button.
 */
async function saveCompressedMedia(
  getBaseDirectory: (media: Media) => string | null,
  { isAutomatic = false }: { isAutomatic?: boolean } = {},
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
            `${baseDirectory}/${topFolder}`,
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

  // Failures (e.g. no write permission for the folder) stay unsaved, so the Save button can still
  // save them to a location chosen manually
  if (failedCount > 0) {
    toast.error(
      savedCount > 0
        ? `Saved ${savedCount} of ${savedCount + failedCount} files. ${failedCount} could not be saved. Use Save Media to choose another location.`
        : isAutomatic
          ? 'Could not save automatically, possibly due to missing folder permissions. Use Save Media to choose a location.'
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
 * - outputs larger than their original, when "Skip larger outputs" is on
 */
export async function autoSaveCompressedMedia() {
  const { saveLocation, saveFolder, saveLargerOutputs } = settingsStore
  if (
    saveLocation === 'ask' ||
    (saveLocation === 'fixedFolder' && !saveFolder)
  ) {
    return
  }

  const appDataDirectory = await appDataDir().catch(() => null)
  let largerCount = 0

  await saveCompressedMedia(
    (mediaFile) => {
      if (
        !mediaFile.pathRaw ||
        !appDataDirectory ||
        mediaFile.pathRaw.startsWith(appDataDirectory)
      ) {
        return null
      }

      const originalSize = mediaFile.sizeInBytes ?? 0
      const outputSize = mediaFile.compressedFile?.sizeInBytes ?? 0
      if (!saveLargerOutputs && originalSize > 0 && outputSize > originalSize) {
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
    },
    { isAutomatic: true },
  )

  if (largerCount > 0) {
    toast.info(
      `${largerCount} ${largerCount > 1 ? 'outputs were' : 'output was'} larger than the original and not saved automatically. Use Save if you still want ${largerCount > 1 ? 'them' : 'it'}.`,
    )
  }
}

/**
 * Copies the outputs to the clipboard after compression when enabled in Settings
 * (Output -> Copy output to clipboard). Runs after the automatic save, so saved outputs are copied
 * from where they were saved. Unsaved outputs are pasted under the name they would be saved with
 * (prefix & original name), not their generated cache name. A batch is only copied when
 * "Include batch outputs" is also on.
 * Happens silently; only a failure shows a toast.
 */
export async function autoCopyCompressedMediaToClipboard() {
  const { copyOutputToClipboard, copyBatchOutputToClipboard } = settingsStore
  const { media } = appProxy.state
  if (!copyOutputToClipboard || !media.length) return
  if (media.length > 1 && !copyBatchOutputToClipboard) return

  const files = media.flatMap(({ compressedFile, fileName }) => {
    if (!compressedFile?.isSuccessful) return []
    if (compressedFile.savedPath) return [{ path: compressedFile.savedPath }]
    if (!compressedFile.pathRaw) return []
    const name = compressedFile.fileNameToDisplay || fileName
    return [
      {
        path: compressedFile.pathRaw,
        fileName: name ? `${settingsStore.outputFilePrefix}${name}` : undefined,
      },
    ]
  })
  if (!files.length) return

  try {
    await copyFilesToClipboard(files)
  } catch {
    toast.error('The output could not be copied to the clipboard.')
  }
}

/** An output of the menu bar's queue, saved on its own (see `saveQueueOutput`) */
export type QueueOutput = {
  /** The original media */
  sourcePath: string
  /** Folder relative to the dropped folder (e.g. `Vacation/Day1`), mirrored when saving */
  relativeDir: string
  originalSize: number
  /** The compressed output (in the app's cache) */
  outputPath: string
  outputSize: number
  /** Name to save it under, without the prefix */
  outputFileName: string
}

/**
 * Saves an output of the menu bar's queue automatically, like `autoSaveCompressedMedia`: to the save
 * location of the Output settings, with the file name prefix, mirroring dropped folders. Media of
 * a drop share their top folder through `topFolders` (by `groupKey`). Returns where it was saved,
 * or why it was not.
 */
export async function saveQueueOutput(
  output: QueueOutput,
  {
    groupKey,
    topFolders,
  }: { groupKey: string; topFolders: Map<string, string> },
): Promise<
  { savedPath: string } | { reason: 'no-save-location' | 'larger' | 'failed' }
> {
  const { saveLocation, saveFolder, saveLargerOutputs, outputFilePrefix } =
    settingsStore
  if (
    saveLocation === 'ask' ||
    (saveLocation === 'fixedFolder' && !saveFolder)
  ) {
    return { reason: 'no-save-location' }
  }
  if (
    !saveLargerOutputs &&
    output.originalSize > 0 &&
    output.outputSize > output.originalSize
  ) {
    return { reason: 'larger' }
  }

  // Same folder: where the file (or its dropped folder) is, e.g. `/a/Vacation/Day1/clip.mp4` with
  // `Vacation/Day1` -> `/a`
  const depth = output.relativeDir ? output.relativeDir.split('/').length : 0
  const baseDirectory =
    saveLocation === 'fixedFolder'
      ? saveFolder!
      : getParentDirectory(output.sourcePath, depth + 1)

  try {
    let destinationDirectory = baseDirectory
    if (output.relativeDir) {
      const [topFolder, ...subFolders] = output.relativeDir.split('/')
      // Existing folders are never merged into; a numbered name is used instead (once per drop)
      const topFolderKey = `${groupKey}\n${baseDirectory}\n${topFolder}`
      let destinationTopFolder = topFolders.get(topFolderKey)
      if (!destinationTopFolder) {
        destinationTopFolder = await getAvailablePath(
          `${baseDirectory}/${topFolder}`,
          true,
        )
        topFolders.set(topFolderKey, destinationTopFolder)
      }
      destinationDirectory = [destinationTopFolder, ...subFolders].join('/')
    }
    const savedPath = await moveFile(
      output.outputPath,
      `${destinationDirectory}/${outputFilePrefix}${output.outputFileName}`,
    )
    return { savedPath }
  } catch {
    return { reason: 'failed' }
  }
}
