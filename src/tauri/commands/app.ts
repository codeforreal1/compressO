import { core } from '@tauri-apps/api'

/**
 * Restarts the app, e.g. to apply a setting read when it starts. Asks first while media is being
 * compressed or not saved yet.
 */
export function restartApp() {
  return core.invoke<void>('restart_app')
}

/**
 * Whether the computer (and the screen) is kept awake while compressing (Settings -> General),
 * for the compressions started from now on
 */
export function setKeepAwakeSettings(
  preventSleep: boolean,
  keepDisplayOn: boolean,
) {
  return core.invoke<void>('set_keep_awake_settings', {
    preventSleep,
    keepDisplayOn,
  })
}

export type OpenAtLoginState = {
  isEnabled: boolean
  /**
   * Kept but switched off in the system's settings, which the app cannot switch on again (macOS:
   * System Settings > General > Login Items > Allow in the Background)
   */
  needsApproval: boolean
}

/**
 * Whether the system opens the app at login (Settings -> General), read from the system each time
 * so it is right when changed outside the app
 */
export function getOpenAtLogin() {
  return core.invoke<OpenAtLoginState>('get_open_at_login')
}

/** Opens the system's login items (macOS), where a login item switched off there is allowed again */
export function openFilesAccessSettings() {
  return core.invoke<void>('open_files_access_settings')
}

export function openLoginItemsSettings() {
  return core.invoke<void>('open_login_items_settings')
}

export function setOpenAtLogin(enabled: boolean) {
  return core.invoke<void>('set_open_at_login', { enabled })
}

/**
 * Whether the system opened the app at login: true once, for the first main window only (a main
 * window opened later is always shown)
 */
export function takeOpenedAtLogin() {
  return core.invoke<boolean>('take_opened_at_login')
}

/** The current log file (Settings -> About -> Show log files) */
/** Writes a failure to the log file, without failing itself */
export function logError(message: string, error?: unknown) {
  core
    .invoke<void>('log_error', {
      message: error === undefined ? message : `${message}: ${String(error)}`,
    })
    .catch(() => {})
}

export function getLogFilePath() {
  return core.invoke<string>('get_log_file_path')
}

/**
 * The native interface's texts (the menus, the quit confirmation) in the app's language, which the
 * backend shows from now on
 */
export function setNativeTexts(texts: Record<string, string>) {
  return core.invoke<void>('set_native_texts', { texts })
}
