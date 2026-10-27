import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { proxy } from 'valtio'

import {
  SETTINGS_INDEX,
  type SettingId,
  type SettingsPageId,
  type SettingsTarget,
} from '@/constants/settingsIndex'
import { focusMainWindow } from '@/tauri/commands/tray'

/** The main window's settings dialog */
export const settingsDialogStore = proxy({
  isOpen: false,
  pageId: 'general' as SettingsPageId,
  /** The setting to show, flashed once; `key` flashes the same setting again */
  highlight: null as { settingId: SettingId; key: number } | null,
})

/** Opens the settings dialog of this (the main) window, at a page or a setting */
export function showSettings(target?: SettingsTarget | null) {
  if (target && 'settingId' in target) {
    settingsDialogStore.pageId = SETTINGS_INDEX[target.settingId].page
    settingsDialogStore.highlight = {
      settingId: target.settingId,
      key: Date.now(),
    }
  } else if (target) {
    settingsDialogStore.pageId = target.page
  }
  settingsDialogStore.isOpen = true
}

/**
 * Settings opened from another window (e.g. the drop zone's), left for the main window, which
 * may first have to be opened, so it is read when it starts too
 */
const REQUEST_KEY = 'openSettingsRequest'
/** An older request is not acted on (e.g. one the main window never read) */
const REQUEST_MAX_AGE_MS = 30_000

/**
 * Opens the settings at a page or a setting: in this window's dialog, or from another window (e.g.
 * the drop zone's), in the main window's, which is shown
 */
export async function openSettings(target?: SettingsTarget) {
  if (getCurrentWebviewWindow().label === 'main') {
    showSettings(target)
    return
  }
  localStorage.setItem(
    REQUEST_KEY,
    JSON.stringify({ target: target ?? null, at: Date.now() }),
  )
  await focusMainWindow()
}

function readRequest(value: string | null) {
  if (!value) return
  localStorage.removeItem(REQUEST_KEY)
  try {
    const request = JSON.parse(value) as {
      target: SettingsTarget | null
      at: number
    }
    if (Date.now() - request.at > REQUEST_MAX_AGE_MS) return
    const { target } = request
    const isKnown =
      !target ||
      ('settingId' in target
        ? target.settingId in SETTINGS_INDEX
        : typeof target.page === 'string')
    if (isKnown) showSettings(target)
  } catch {
    // Not a request
  }
}

/** In the main window: opens the settings asked for by other windows (see `openSettings`) */
export function listenForSettingsRequests() {
  readRequest(localStorage.getItem(REQUEST_KEY))
  const handleStorage = (evt: StorageEvent) => {
    if (evt.storageArea === localStorage && evt.key === REQUEST_KEY) {
      readRequest(evt.newValue)
    }
  }
  window.addEventListener('storage', handleStorage)
  return () => window.removeEventListener('storage', handleStorage)
}
