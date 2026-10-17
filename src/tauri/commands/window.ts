import { core } from '@tauri-apps/api'
import { version } from '@tauri-apps/plugin-os'

import { getPlatform } from '@/utils/fs'

/**
 * Turns the tinted window (native translucent material behind the app) on or off. `dark` matches
 * the material to the app's theme. Only call when `isWindowTintSupported()`.
 */
export function setWindowTint(enabled: boolean, dark: boolean) {
  return core.invoke<void>('set_window_tint', { enabled, dark })
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
