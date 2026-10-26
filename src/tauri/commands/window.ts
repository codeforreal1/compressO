import { core } from '@tauri-apps/api'
import { version } from '@tauri-apps/plugin-os'

import { getPlatform } from '@/utils/fs'

/**
 * Turns the tinted window (native translucent material behind the app) on or off. `dark` matches
 * the material to the app's theme; with `followsSystem`, the window follows the system's theme
 * instead (as the app does), so its changes are still seen. Only call when `isWindowTintSupported()`.
 */
export function setWindowTint(
  enabled: boolean,
  dark: boolean,
  followsSystem: boolean,
) {
  return core.invoke<void>('set_window_tint', { enabled, dark, followsSystem })
}

/**
 * Whether the system is in dark mode, read from the system itself (`null` where it is not, on
 * Linux): a window set to a theme reports that theme, & Windows' webview can report light in dark
 * mode
 */
export function getSystemDarkMode() {
  return core.invoke<boolean | null>('get_system_dark_mode')
}

/** The tinted window needs macOS, or Windows 11 (build 22000+) for its Acrylic or Mica material */
export function isWindowTintSupported() {
  const { isMacOS, isWindows } = getPlatform()
  if (isMacOS) return true
  if (!isWindows) return false
  try {
    // e.g. `10.0.22631`
    const build = Number(version().split('.')[2])
    return build >= 22000
  } catch {
    return false
  }
}
