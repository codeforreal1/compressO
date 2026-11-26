import { core } from '@tauri-apps/api'
import { appDataDir, join } from '@tauri-apps/api/path'
import { open, save } from '@tauri-apps/plugin-dialog'
import { snapshot } from 'valtio'

import { toast } from '@/components/Toast'
import { t } from '@/i18n'
import { settingsStore } from '@/stores/settingsStore'
import {
  copyFilesToClipboard,
  getAvailablePath,
  moveFile,
} from '@/tauri/commands/fs'
import { Image, Video } from '@/types/app'
import type { PresetOutput } from '@/types/preset'
import {
  applyFileNameTemplate,
  getLegacyPrefixFromTemplate,
  migratePrefixToTemplate,
  sanitizeFileNamePart,
} from '@/utils/fileNameTemplate'
import { formatBytes, getParentDirectory } from '@/utils/fs'
import {
  getPresetNameForTemplate,
  getPresetOutput,
  savesAutomatically,
} from '@/utils/presetOutput'
import { recordSavedOutput } from './-history'
import { appProxy } from './-state'

type Media = (Video & { type: 'video' }) | (Image & { type: 'image' })

/** Where a media's output is saved & its file name prefix: those of its preset (see `PresetOutput`) */
function getMediaOutput(media: Pick<Media, 'config'>) {
  return getPresetOutput(media.config?.presetId)
}

/**
 * Saves the clips of a compressed video into `destinationDirectory`, keeping each clip's name.
 * Clips already saved are skipped, so a partial save can be retried. Returns how many were saved
 * & failed, & the first/last clip paths saved.
 */
async function saveVideoClips(
  mediaIndex: number,
  destinationDirectory: string,
  fileNameTemplate: string,
  presetName: string,
) {
  const mediaFile = appProxy.state.media[mediaIndex]
  const file = mediaFile?.type === 'video' ? mediaFile.compressedFile : null
  const clips = file?.clips ?? []
  let savedCount = 0
  let failedCount = 0
  let firstSavedPath: string | null = null
  let lastSavedPath: string | null = null

  for (const clip of clips) {
    if (clip.isSaved || !clip.pathRaw) continue
    clip.isSaving = true
    try {
      const targetName = applyFileNameTemplate(
        clip.fileNameToDisplay || clip.fileName,
        fileNameTemplate,
        { presetName },
      )
      const { path: savedPath } = await moveFile(
        clip.pathRaw,
        `${destinationDirectory}/${targetName}`,
        {
          replaceOriginal: settingsStore.replaceOriginalFiles
            ? mediaFile?.pathRaw
            : null,
        },
      )
      clip.savedPath = savedPath
      clip.isSaving = false
      clip.isSaved = true
      firstSavedPath ??= savedPath
      lastSavedPath = savedPath
      savedCount++
      recordSavedOutput(
        clip,
        clip.historyId
          ? (mediaFile?.id ?? null)
          : `${mediaFile?.id ?? ''}:clip-${clip.index}`,
      )
    } catch (_) {
      clip.isSaving = false
      failedCount++
    }
  }

  const current = appProxy.state.media[mediaIndex]
  const currentFile = current?.type === 'video' ? current.compressedFile : null
  if (currentFile) {
    currentFile.isSaving = false
    currentFile.isSaved =
      clips.length > 0 && clips.every((clip) => clip.isSaved)
    currentFile.savedPath =
      clips.find((clip) => clip.savedPath)?.savedPath ?? currentFile.savedPath
  }

  return { savedCount, failedCount, firstSavedPath, lastSavedPath }
}

/**
 * Saves every compressed output that isn't saved yet into the directory returned by
 * `getBaseDirectory` (skipped when it returns `null`).
 *
 * Saved to another folder (a fixed one, or one chosen with Save Media), dropped folders keep their
 * structure & names (`Vacation/Day1` -> `<base>/Vacation/Day1`), unless "Preserve folder
 * structure" is off (Settings -> Output); with `keepFolderStructure` off (also next to their
 * originals), each file is saved straight into its base directory. Only files get the
 * prefix. Existing files & folders are never replaced; numbered names like
 * `clip (1).mp4` or `Vacation (1)` are used instead, except an original saved over with "Replace
 * original files" on (Settings -> Output), which goes to the Trash. Each file is saved independently, so one failure doesn't
 * stop the rest; failed files stay unsaved for the Save button.
 */
async function saveCompressedMedia(
  getBaseDirectory: (media: Media) => string | null,
  {
    isAutomatic = false,
    keepFolderStructure = true,
  }: {
    isAutomatic?: boolean
    /** For all media, or for each (e.g. by its preset's save location) */
    keepFolderStructure?: boolean | ((media: Media) => boolean)
  } = {},
) {
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
    if (!compressedFile) continue
    const clips = mediaFile.type === 'video' ? compressedFile?.clips : undefined
    if ((!compressedFile.pathRaw && !clips?.length) || compressedFile.isSaved)
      continue

    const baseDirectory = getBaseDirectory(mediaFile)
    if (baseDirectory == null) continue
    const fileNameTemplate = getMediaOutput(mediaFile).fileNameTemplate
    const presetName = getPresetNameForTemplate(mediaFile.config?.presetId)
    const shouldKeepFolderStructure =
      typeof keepFolderStructure === 'function'
        ? keepFolderStructure(mediaFile)
        : keepFolderStructure

    appProxy.state.media[i].compressedFile = {
      ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
      isSaving: true,
    }
    try {
      let destinationDirectory = baseDirectory
      let location = baseDirectory
      if (shouldKeepFolderStructure && mediaFile.relativeDir) {
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

      if (clips?.length) {
        const result = await saveVideoClips(
          i,
          destinationDirectory,
          fileNameTemplate,
          presetName,
        )
        if (result.savedCount > 0) {
          savedLocations.add(location)
          lastSavedPath = result.lastSavedPath ?? lastSavedPath
        }
        savedCount += result.savedCount
        failedCount += result.failedCount
        if (result.failedCount > 0) {
          appProxy.state.media[i].compressedFile = {
            ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
            isSaving: false,
          }
        }
        continue
      }

      if (!compressedFile.pathRaw) continue
      const targetName = applyFileNameTemplate(
        compressedFile.fileNameToDisplay || mediaFile.fileName || '',
        fileNameTemplate,
        { presetName },
      )
      const { path: savedPath, replacedOriginal } = await moveFile(
        compressedFile.pathRaw,
        `${destinationDirectory}/${targetName}`,
        {
          replaceOriginal: settingsStore.replaceOriginalFiles
            ? mediaFile.pathRaw
            : null,
        },
      )
      savedLocations.add(location)
      lastSavedPath = savedPath
      savedCount++
      appProxy.state.media[i].compressedFile = {
        ...(snapshot(appProxy).state.media[i].compressedFile ?? {}),
        savedPath,
        replacedOriginal,
        isSaving: false,
        isSaved: true,
      }
      recordSavedOutput(
        snapshot(appProxy).state.media[i].compressedFile ?? {},
        mediaFile.id,
      )
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
        ? t('save.partiallySaved', {
            saved: savedCount,
            count: savedCount + failedCount,
            failed: failedCount,
          })
        : isAutomatic
          ? t('save.autoSaveFailed')
          : t('save.failed'),
    )
  }

  appProxy.state.isSaving = false
  appProxy.state.isSaved = appProxy.state.media.every(
    (mediaFile) =>
      !mediaFile.compressedFile?.isSuccessful ||
      !!mediaFile.compressedFile?.isSaved,
  )
}

/**
 * Uses another output of a video compressed to a target size (see `compressedFile.options`). When
 * the output was already saved, the chosen one replaces it there (same name & folder), & the one
 * saved goes back among the options.
 */
export async function chooseOutputOption(
  mediaIndex: number,
  option: { pathRaw: string; sizeInBytes: number },
) {
  const mediaFile = appProxy.state.media[mediaIndex]
  const file = mediaFile?.type === 'video' ? mediaFile.compressedFile : null
  if (!file?.pathRaw || file.pathRaw === option.pathRaw || file.isSaving) {
    return
  }
  const chosen = {
    pathRaw: option.pathRaw,
    path: core.convertFileSrc(option.pathRaw),
    sizeInBytes: option.sizeInBytes,
    size: formatBytes(option.sizeInBytes),
  }
  if (!file.isSaved || !file.savedPath) {
    Object.assign(file, chosen)
    return
  }

  const savedPath = file.savedPath
  const previousPath = file.pathRaw
  file.isSaving = true
  try {
    await moveFile(savedPath, previousPath)
    try {
      const { path: newSavedPath } = await moveFile(option.pathRaw, savedPath)
      Object.assign(file, chosen, { savedPath: newSavedPath })
      // The output saved is now this one (its size)
      recordSavedOutput(file, mediaFile.id)
      if (appProxy.state.media.length === 1) {
        appProxy.state.savedPath = newSavedPath
      }
    } catch (error) {
      // The output saved before is put back
      await moveFile(previousPath, savedPath).catch(() => {})
      throw error
    }
  } catch (_) {
    toast.error(t('save.failed'))
  } finally {
    file.isSaving = false
  }
}

/**
 * Looks at another output of a video compressed to a target size. Once the output is saved, the
 * option is only shown (see `previewOption`), so nothing on disk changes until
 * `replaceSavedOutput`; before, it simply becomes the output that will be saved.
 */
export function previewOutputOption(
  mediaIndex: number,
  option: { pathRaw: string; sizeInBytes: number },
) {
  const mediaFile = appProxy.state.media[mediaIndex]
  const file = mediaFile?.type === 'video' ? mediaFile.compressedFile : null
  if (!file || file.isSaving) return
  if (!file.isSaved || !file.savedPath) {
    chooseOutputOption(mediaIndex, option)
    return
  }
  // The saved one again: nothing to replace
  file.previewOption = option.pathRaw === file.pathRaw ? null : { ...option }
}

/** Saves the output looked at (see `previewOutputOption`) in place of the one saved */
export async function replaceSavedOutput(mediaIndex: number) {
  const mediaFile = appProxy.state.media[mediaIndex]
  const file = mediaFile?.type === 'video' ? mediaFile.compressedFile : null
  const option = file?.previewOption
  if (!file || !option) return
  await chooseOutputOption(mediaIndex, option)
  // Kept on a failure (see the toast), so it can be tried again
  if (file.pathRaw === option.pathRaw) file.previewOption = null
}

/**
 * Saves after asking where: a file location for a single output, or for one media of a batch
 * (`mediaIndex`, from its own view), & a folder for the whole batch
 */
export async function saveCompressedMediaWithPrompt(mediaIndex?: number) {
  const { media } = appProxy.state
  if (!media.length) return

  if (mediaIndex == null && media.length > 1) {
    const directory = await open({
      directory: true,
      title: t('save.chooseDirectory'),
    })
    if (typeof directory === 'string') {
      await saveCompressedMedia(() => directory, {
        keepFolderStructure: settingsStore.preserveFolderStructure,
      })
    }
    return
  }

  const index = mediaIndex ?? 0
  const isSingle = media.length === 1
  const mediaFile = media[index]
  const compressedFile = mediaFile?.compressedFile
  if (!compressedFile) return
  const clips = mediaFile?.type === 'video' ? compressedFile.clips : undefined
  if (!compressedFile.pathRaw && !clips?.length) return

  if (clips?.length) {
    const directory = await open({
      directory: true,
      title: t('clips.chooseFolder'),
    })
    if (typeof directory !== 'string') return

    if (isSingle) appProxy.state.isSaving = true
    compressedFile.isSaving = true
    const result = await saveVideoClips(
      index,
      directory,
      getMediaOutput(mediaFile).fileNameTemplate,
      getPresetNameForTemplate(mediaFile.config?.presetId),
    )
    if (result.failedCount > 0) {
      toast.error(
        result.savedCount > 0
          ? t('save.partiallySaved', {
              saved: result.savedCount,
              count: result.savedCount + result.failedCount,
              failed: result.failedCount,
            })
          : t('save.failed'),
      )
    }
    if (isSingle) {
      if (result.firstSavedPath)
        appProxy.state.savedPath = result.firstSavedPath
      appProxy.state.isSaving = false
    }
    const savedFile = appProxy.state.media[index]?.compressedFile
    appProxy.state.isSaved = appProxy.state.media.every(
      (item) =>
        !item.compressedFile?.isSuccessful || !!item.compressedFile?.isSaved,
    )
    if (savedFile) savedFile.isSaving = false
    return
  }

  const pathToSave = await save({
    title: t('save.chooseLocation'),
    defaultPath: applyFileNameTemplate(
      compressedFile.fileNameToDisplay ?? mediaFile.fileName ?? '',
      getMediaOutput(mediaFile).fileNameTemplate,
      { presetName: getPresetNameForTemplate(mediaFile.config?.presetId) },
    ),
  })
  if (!pathToSave || !compressedFile.pathRaw) return

  // The dialog gives the exact path (the name may have been edited), so it's used as is. Even if
  // "Replace" was confirmed in it, an existing file isn't replaced; a numbered name is used instead,
  // except the original with "Replace original files" on (Settings -> Output), which goes to the
  // Trash.
  if (isSingle) appProxy.state.isSaving = true
  compressedFile.isSaving = true
  try {
    const { path: savedPath, replacedOriginal } = await moveFile(
      compressedFile.pathRaw,
      pathToSave,
      {
        replaceOriginal: settingsStore.replaceOriginalFiles
          ? mediaFile.pathRaw
          : null,
      },
    )
    appProxy.state.media[index].compressedFile = {
      ...(snapshot(appProxy).state.media[index].compressedFile ?? {}),
      savedPath,
      replacedOriginal,
      isSaved: true,
      isSaving: false,
    }
    recordSavedOutput(
      snapshot(appProxy).state.media[index].compressedFile ?? {},
      mediaFile.id,
    )
    if (isSingle) {
      appProxy.state.savedPath = savedPath
      appProxy.state.isSaved = true
    } else {
      // The batch is saved once each of its outputs is
      appProxy.state.isSaved = appProxy.state.media.every(
        (item) =>
          !item.compressedFile?.isSuccessful || !!item.compressedFile?.isSaved,
      )
    }
  } catch (_) {
    toast.error(t('save.failed'))
  } finally {
    if (isSingle) appProxy.state.isSaving = false
    const file = appProxy.state.media[index]?.compressedFile
    if (file) file.isSaving = false
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
  const { saveLargerOutputs } = settingsStore
  // Each media is saved where its preset saves; those whose preset asks are left for the Save button
  if (
    !appProxy.state.media.some((mediaFile) =>
      savesAutomatically(getMediaOutput(mediaFile)),
    )
  ) {
    return
  }

  // Keep the output preview on its thumbnail while the save destination is resolved and the
  // cached file is moved. The player must not open the soon-to-be-removed cache path.
  appProxy.state.isSaving = true
  const appDataDirectory = await appDataDir().catch(() => null)
  let largerCount = 0

  await saveCompressedMedia(
    (mediaFile) => {
      const output = getMediaOutput(mediaFile)
      if (
        !savesAutomatically(output) ||
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

      if (output.saveLocation === 'fixedFolder') {
        return output.saveFolder
      }
      // Same folder: right next to the original, in its own folder (also for a dropped folder's
      // files), e.g. `/a/Vacation/Day1/clip.mp4` -> `/a/Vacation/Day1`
      return getParentDirectory(mediaFile.pathRaw, 1)
    },
    {
      isAutomatic: true,
      // No new folders next to the originals; only a fixed folder mirrors dropped folders (when
      // "Preserve folder structure" is on)
      keepFolderStructure: (mediaFile) =>
        getMediaOutput(mediaFile).saveLocation === 'fixedFolder' &&
        settingsStore.preserveFolderStructure,
    },
  )

  if (largerCount > 0) {
    toast.info(t('save.largerSkipped', { count: largerCount }))
  }
}

/**
 * A media's outputs as they are copied to the clipboard: each clip when it was split, or the one
 * output. From where it was saved, or (not saved yet) pasted under the name it would be saved with
 * (prefix & original name), not its generated cache name.
 */
export function getOutputClipboardFiles(
  mediaFile: Pick<Media, 'type' | 'compressedFile' | 'fileName' | 'config'>,
): { path: string; fileName?: string }[] {
  const { compressedFile } = mediaFile
  const fileNameTemplate = getMediaOutput(mediaFile).fileNameTemplate
  const presetName = getPresetNameForTemplate(mediaFile.config?.presetId)
  const clips = mediaFile.type === 'video' ? compressedFile?.clips : undefined
  if (clips?.length) {
    return clips.flatMap((clip) => {
      if (clip.savedPath) return [{ path: clip.savedPath }]
      if (!clip.pathRaw) return []
      return [
        {
          path: clip.pathRaw,
          fileName: applyFileNameTemplate(
            clip.fileNameToDisplay || clip.fileName,
            fileNameTemplate,
            { presetName },
          ),
        },
      ]
    })
  }
  const single = getOutputClipboardFile(mediaFile)
  return single ? [single] : []
}

/**
 * One clip as it is copied to the clipboard: from where it was saved, or (not saved yet) pasted
 * under the name it would be saved with (template & clip name), not its generated cache name.
 */
export function getClipClipboardFile(
  mediaFile: { config?: { presetId?: string | null } | null },
  clip: {
    savedPath?: string
    pathRaw: string
    fileName: string
    fileNameToDisplay?: string | null
  },
): { path: string; fileName?: string } | null {
  if (clip.savedPath) return { path: clip.savedPath }
  if (!clip.pathRaw) return null
  return {
    path: clip.pathRaw,
    fileName: applyFileNameTemplate(
      clip.fileNameToDisplay || clip.fileName,
      getPresetOutput(mediaFile.config?.presetId).fileNameTemplate,
      { presetName: getPresetNameForTemplate(mediaFile.config?.presetId) },
    ),
  }
}

/**
 * A media's output as it is copied to the clipboard: from where it was saved, or (not saved yet)
 * pasted under the name it would be saved with (template & original name), not its generated cache
 * name. `null` without an output.
 */
export function getOutputClipboardFile(
  mediaFile: Pick<Media, 'compressedFile' | 'fileName' | 'config'>,
): { path: string; fileName?: string } | null {
  const { compressedFile } = mediaFile
  if (compressedFile?.savedPath) return { path: compressedFile.savedPath }
  if (!compressedFile?.pathRaw) return null
  const name = compressedFile.fileNameToDisplay || mediaFile.fileName
  return {
    path: compressedFile.pathRaw,
    fileName: name
      ? applyFileNameTemplate(
          name,
          getMediaOutput(mediaFile).fileNameTemplate,
          { presetName: getPresetNameForTemplate(mediaFile.config?.presetId) },
        )
      : undefined,
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

  const files = media.flatMap((mediaFile) =>
    mediaFile.compressedFile?.isSuccessful
      ? getOutputClipboardFiles(mediaFile)
      : [],
  )
  if (!files.length) return

  try {
    await copyFilesToClipboard(files)
  } catch {
    toast.error(t('save.copyFailed'))
  }
}

/** An output of the menu bar's queue, saved on its own (see `saveQueueOutput`) */
export type QueueOutputFile = {
  /** The output in the app's cache */
  path: string
  /** Its size in bytes */
  size: number
  /** Name to save it under, without the prefix */
  fileName: string
}

export type QueueOutput = {
  /** The original media */
  sourcePath: string
  /** Folder relative to the dropped folder (e.g. `Vacation/Day1`), mirrored when saving */
  relativeDir: string
  originalSize: number
  /** The compressed output(s) in the app's cache: one, or a video's clips */
  outputs: QueueOutputFile[]
  /** The preset it was compressed with, whose save location & prefix are used */
  presetId?: string | null
  /** Inline contract output override (for one-shot CLI contracts) */
  presetOutput?: PresetOutput | null
  /** Inline contract display name for `{preset}` template token */
  presetName?: string | null
  /**
   * Output settings chosen instead of the app's & the preset's (on the command line, see
   * `CliJob`); each one left out (`null`) follows them
   */
  settings?: QueueSaveSettings | null
}

/** See `QueueOutput['settings']` */
export type QueueSaveSettings = {
  /** Saved here instead of the preset's save location */
  outputFolder?: string | null
  /** The exact name it is saved under in `outputFolder`, instead of its own with the prefix */
  outputFileName?: string | null
  skipLargerOutputs?: boolean | null
  preserveFolderStructure?: boolean | null
  replaceOriginalFiles?: boolean | null
  fileNamePrefix?: string | null
  fileNameTemplate?: string | null
}

/**
 * Saves an output of the menu bar's queue automatically, like `autoSaveCompressedMedia`: to the save
 * location of its preset, with its file name prefix (next to the original, or in the fixed
 * folder, mirroring dropped folders). Media of
 * a drop share their top folder through `topFolders` (by `groupKey`). Returns where it was saved,
 * or why it was not.
 */
export async function saveQueueOutput(
  output: QueueOutput,
  {
    groupKey,
    topFolders,
  }: { groupKey: string; topFolders: Map<string, Promise<string>> },
): Promise<
  | { savedPaths: string[]; replacedOriginal: boolean }
  | { reason: 'no-save-location' | 'larger' | 'failed' }
> {
  const settings = output.settings ?? {}
  const outputSize = output.outputs.reduce(
    (total, file) => total + file.size,
    0,
  )
  const saveLargerOutputs =
    settings.skipLargerOutputs != null
      ? !settings.skipLargerOutputs
      : settingsStore.saveLargerOutputs
  const presetOutput = output.presetOutput ?? getPresetOutput(output.presetId)
  const saveLocation = settings.outputFolder
    ? ('fixedFolder' as const)
    : presetOutput.saveLocation
  const saveFolder = settings.outputFolder ?? presetOutput.saveFolder
  const outputFileNameTemplate =
    settings.fileNameTemplate != null
      ? sanitizeFileNamePart(settings.fileNameTemplate)
      : settings.fileNamePrefix != null
        ? migratePrefixToTemplate(sanitizeFileNamePart(settings.fileNamePrefix))
        : presetOutput.fileNameTemplate
  if (
    !savesAutomatically({
      saveLocation,
      saveFolder,
      fileNameTemplate: outputFileNameTemplate,
      filePrefix: getLegacyPrefixFromTemplate(outputFileNameTemplate),
    })
  ) {
    return { reason: 'no-save-location' }
  }
  const preserveFolderStructure =
    settings.preserveFolderStructure ?? settingsStore.preserveFolderStructure
  const replaceOriginalFiles =
    settings.replaceOriginalFiles ?? settingsStore.replaceOriginalFiles
  if (
    !saveLargerOutputs &&
    output.originalSize > 0 &&
    outputSize > output.originalSize
  ) {
    return { reason: 'larger' }
  }
  if (!output.outputs.length) {
    return { reason: 'failed' }
  }

  // Same folder: right next to the original, in its own folder, e.g. `/a/Vacation/Day1/clip.mp4`
  // -> `/a/Vacation/Day1`; a fixed folder mirrors dropped folders (when "Preserve folder structure"
  // is on, otherwise every file goes straight into it)
  const isFixedFolder = saveLocation === 'fixedFolder'
  const baseDirectory = isFixedFolder
    ? saveFolder!
    : getParentDirectory(output.sourcePath, 1)

  try {
    let destinationDirectory = baseDirectory
    if (isFixedFolder && preserveFolderStructure && output.relativeDir) {
      const [topFolder, ...subFolders] = output.relativeDir.split('/')
      // Existing folders are never merged into; a numbered name is used instead (once per drop)
      const topFolderKey = `${groupKey}\n${baseDirectory}\n${topFolder}`
      // The lookup itself is shared: media saved at the same time (see `runDropQueue`'s lanes)
      // get the same folder
      let destinationTopFolder = topFolders.get(topFolderKey)
      if (!destinationTopFolder) {
        destinationTopFolder = getAvailablePath(
          `${baseDirectory}/${topFolder}`,
          true,
        ).catch((error) => {
          // Tried again by the next media
          topFolders.delete(topFolderKey)
          throw error
        })
        topFolders.set(topFolderKey, destinationTopFolder)
      }
      destinationDirectory = [await destinationTopFolder, ...subFolders].join(
        '/',
      )
    }
    // A single output (e.g. the command line's `--output=file.mp4`) keeps its exact name;
    // clips keep each clip's own name after the preset's prefix
    const exactFileName =
      settings.outputFolder &&
      settings.outputFileName &&
      output.outputs.length === 1
        ? settings.outputFileName
        : null
    const presetName =
      output.presetName ?? getPresetNameForTemplate(output.presetId)
    const savedPaths: string[] = []
    let replacedOriginal = false
    for (const file of output.outputs) {
      const fileName =
        exactFileName ??
        applyFileNameTemplate(file.fileName, outputFileNameTemplate, {
          presetName,
        })
      try {
        const moved = await moveFile(
          file.path,
          `${destinationDirectory}/${fileName}`,
          {
            replaceOriginal: replaceOriginalFiles ? output.sourcePath : null,
          },
        )
        savedPaths.push(moved.path)
        if (moved.replacedOriginal) replacedOriginal = true
      } catch (error) {
        if (isFixedFolder) throw error
        // Next to an original in a folder the app cannot write to (e.g. a file copied from another
        // computer, kept in a shared folder): saved where images copied in a browser are, the app's
        // own folder (see `save_clipboard_image`), instead of not at all
        const moved = await moveFile(
          file.path,
          await join(await appDataDir(), 'assets', fileName),
        )
        savedPaths.push(moved.path)
      }
    }
    return { savedPaths, replacedOriginal }
  } catch {
    return { reason: 'failed' }
  }
}
