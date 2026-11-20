import { core } from '@tauri-apps/api'

import type { PresetMediaType } from '@/types/preset'

/**
 * A watched folder as the command line sees it (see `cli-settings.json`): the presets chosen for
 * its media types are `default` or a preset id.
 */
export type WatchedFolderChoice = {
  id: string
  path: string
  isEnabled: boolean
  presetIds: Record<PresetMediaType, string>
}

/** The presets to change on a watched folder; omitted media types stay unchanged */
export type WatchedFolderPresetChanges = Partial<
  Record<PresetMediaType, string>
>

/** A change to the watched folders asked for by the command line */
export type WatchedFolderCommand =
  | {
      type: 'addWatchedFolder'
      path: string
      isEnabled?: boolean
      presetIds?: WatchedFolderPresetChanges
    }
  | {
      type: 'updateWatchedFolder'
      id?: string
      path?: string
      isEnabled?: boolean
      presetIds?: WatchedFolderPresetChanges
    }
  | {
      type: 'removeWatchedFolder'
      id?: string
      path?: string
    }

export type WatchedFolderCommandPayload = {
  /** Matches the answer to the command line's request (a retry reuses it) */
  requestId: string
  command: WatchedFolderCommand
}

export type WatchedFolderCommandResult =
  | {
      ok: true
      /** The folders as they are after the change */
      watchedFolders: WatchedFolderChoice[]
      /** The folder that was added or updated */
      folderId?: string
      added?: boolean
      updated?: boolean
      removed?: boolean
    }
  | { ok: false; code: string; message: string }

/** Answers a watched folders command, so the command line can return (see `watch_folders_bridge.rs`) */
export function completeWatchedFoldersCommand(
  requestId: string,
  result: WatchedFolderCommandResult,
) {
  return core.invoke<void>('complete_watched_folders_command', {
    requestId,
    result,
  })
}
