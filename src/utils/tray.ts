import { getPlatform } from '@/utils/fs'

const { isMacOS, isWindows } = getPlatform()

/**
 * Whether the app has a tray icon with the drop zone: the macOS menu bar or the Windows system tray
 * (not Linux)
 */
export const hasTray = !!(isMacOS || isWindows)

/** The tray's name in the interface, e.g. "The drop zone is in the menu bar" */
export const TRAY_NAME = isWindows ? 'system tray' : 'menu bar'

/** The setting that shows the tray icon (Settings -> General) */
export const TRAY_ICON_SETTING_TITLE = isWindows
  ? 'Show system tray icon'
  : 'Show menu bar icon'
