import { event } from '@tauri-apps/api'
import { useEffect } from 'react'

import { presetsStore } from '@/stores/presetsStore'
import { settingsStore, type WatchedFolder } from '@/stores/settingsStore'
import { logError } from '@/tauri/commands/app'
import { getMissingWatchedFolders } from '@/tauri/commands/dropQueue'
import {
  completeWatchedFoldersCommand,
  type WatchedFolderCommand,
  type WatchedFolderCommandPayload,
  type WatchedFolderCommandResult,
  type WatchedFolderPresetChanges,
} from '@/tauri/commands/watchedFolders'
import { CustomEvents } from '@/types/compression'
import type { Preset } from '@/types/preset'
import {
  findWatchedFolder,
  generateWatchedFolderId,
  getWatchedFolderChoices,
  getWatchedFolderPresetNames,
  isWatchedFolderRoot,
  normalizeWatchedFolderPath,
  resolveWatchedFolderPresetId,
  WATCHED_FOLDER_MEDIA_TYPES,
} from '@/utils/watchedFolders'

function rawFolders() {
  return getWatchedFolderChoices(
    settingsStore.watchedFolders,
    presetsStore.presets as Preset[],
  )
}

function success(
  result: Omit<
    Extract<WatchedFolderCommandResult, { ok: true }>,
    'ok' | 'watchedFolders'
  > = {},
): WatchedFolderCommandResult {
  return { ok: true, watchedFolders: rawFolders(), ...result }
}

function failure(code: string, message: string): WatchedFolderCommandResult {
  return { ok: false, code, message }
}

/** The presets to set, or the error to answer with when one of them does not exist */
function resolvePresetChanges(changes?: WatchedFolderPresetChanges) {
  const presets = presetsStore.presets as Preset[]
  const presetIds: WatchedFolderPresetChanges = {}
  if (!changes) return { presetIds }
  for (const mediaType of WATCHED_FOLDER_MEDIA_TYPES) {
    const value = changes[mediaType]
    if (value == null) continue
    const id = resolveWatchedFolderPresetId(value, mediaType, presets)
    if (!id) {
      return {
        error: failure(
          'unknownPreset',
          `There is no ${mediaType} preset named "${value}". The ${mediaType} presets are ${getWatchedFolderPresetNames(mediaType, presets).join(', ')}. Use "default" to follow the default preset.`,
        ),
      }
    }
    presetIds[mediaType] = id
  }
  return { presetIds }
}

async function applyCommand(
  command: WatchedFolderCommand,
): Promise<WatchedFolderCommandResult> {
  const changes = resolvePresetChanges(
    'presetIds' in command ? command.presetIds : undefined,
  )
  if (changes.error) return changes.error
  const presetIds = changes.presetIds ?? {}

  switch (command.type) {
    case 'addWatchedFolder': {
      const path = normalizeWatchedFolderPath(command.path)
      if (isWatchedFolderRoot(path)) {
        return failure(
          'rootFolder',
          'Watching a filesystem root is not supported. Choose a folder inside it.',
        )
      }
      const existing = findWatchedFolder(settingsStore.watchedFolders, {
        path,
      })
      if (existing) {
        return success({ folderId: existing.id, added: false })
      }
      const missing = await getMissingWatchedFolders([path])
      if (missing.includes(path)) {
        return failure('missingFolder', `The folder ${path} does not exist.`)
      }
      const folder: WatchedFolder = {
        id: generateWatchedFolderId(),
        path,
        isEnabled: command.isEnabled ?? true,
      }
      if (Object.keys(presetIds).length > 0) folder.presetIds = presetIds
      settingsStore.watchedFolders.push(folder)
      return success({ folderId: folder.id, added: true })
    }
    case 'updateWatchedFolder': {
      const folder = findWatchedFolder(settingsStore.watchedFolders, {
        id: command.id,
        path: command.path,
      })
      if (!folder) {
        return failure(
          'unknownWatchedFolder',
          'There is no watched folder with that id or path. Call list_watched_folders for the current ones.',
        )
      }
      if (command.isEnabled == null && Object.keys(presetIds).length === 0) {
        return failure(
          'invalidRequest',
          'Give enabled, videoPreset, imagePreset or audioPreset to update.',
        )
      }
      // A folder can only be watched while it is there; disabling always works
      if (command.isEnabled === true && !folder.isEnabled) {
        const missing = await getMissingWatchedFolders([folder.path])
        if (missing.includes(folder.path)) {
          return failure(
            'missingFolder',
            `The folder ${folder.path} does not exist.`,
          )
        }
      }
      if (command.isEnabled != null) folder.isEnabled = command.isEnabled
      if (Object.keys(presetIds).length > 0) {
        folder.presetIds = { ...folder.presetIds, ...presetIds }
      }
      return success({ folderId: folder.id, updated: true })
    }
    case 'removeWatchedFolder': {
      const folder = findWatchedFolder(settingsStore.watchedFolders, {
        id: command.id,
        path: command.path,
      })
      if (!folder) {
        return success({ removed: false })
      }
      settingsStore.watchedFolders = settingsStore.watchedFolders.filter(
        (watchedFolder) => watchedFolder.id !== folder.id,
      )
      return success({ removed: true })
    }
  }
}

/**
 * Applies watched folder changes asked for by the command line (`compresso mcp`, see
 * `watch_folders_bridge.rs`): the frontend keeps the folders, so the CLI asks a window to change
 * them & waits for its answer.
 */
export function useWatchedFoldersCommand() {
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let isMounted = true
    // Changes are applied one at a time, & an answer may be sent twice (a retry)
    let queue: Promise<void> = Promise.resolve()
    const results = new Map<string, WatchedFolderCommandResult>()

    const answer = async (
      requestId: string,
      result: WatchedFolderCommandResult,
    ) => {
      try {
        await completeWatchedFoldersCommand(requestId, result)
      } catch (error) {
        logError('Could not answer a watched folders command', error)
      }
    }

    const handle = (payload: WatchedFolderCommandPayload) => {
      const run = queue.then(async () => {
        const cached = results.get(payload.requestId)
        if (cached) {
          await answer(payload.requestId, cached)
          return
        }
        let result: WatchedFolderCommandResult
        try {
          result = await applyCommand(payload.command)
        } catch (error) {
          logError('Could not change the watched folders', error)
          result = failure(
            'appUnavailable',
            'CompressO could not change its watched folders.',
          )
        }
        results.set(payload.requestId, result)
        if (results.size > 50) {
          const oldest = results.keys().next().value
          if (oldest) results.delete(oldest)
        }
        await answer(payload.requestId, result)
      })
      queue = run.catch(() => {})
    }

    ;(async () => {
      unlisten = await event.listen<WatchedFolderCommandPayload>(
        CustomEvents.WatchedFoldersCommand,
        (evt) => handle(evt.payload),
      )
      // Unmounted while the listener was being added
      if (!isMounted) {
        unlisten()
      }
    })()

    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [])
}
