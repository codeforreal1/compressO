import { getPlatform } from '@/utils/fs'

const { isMacOS, isWindows } = getPlatform()

/**
 * Whether the app has a tray icon with the drop zone: the macOS menu bar or the Windows system tray
 * (not Linux)
 */
export const hasTray = !!(isMacOS || isWindows)

/**
 * Which tray the text is about, as i18next's context (`t(key, { context: TRAY_CONTEXT })` uses
 * `key_macos` or `key_windows`): each language words the menu bar & the system tray its own way
 */
export const TRAY_CONTEXT = isWindows ? 'windows' : 'macos'
