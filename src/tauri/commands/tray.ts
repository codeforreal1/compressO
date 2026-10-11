import { core } from '@tauri-apps/api'

/** Label of the webview window shown inside the macOS status bar (tray) popover */
export const TRAY_WINDOW_LABEL = 'tray'

export function openTrayPopover() {
  return core.invoke<void>('open_tray_popover')
}

/**
 * Closes the tray popover. `suspend` also destroys the tray webview, which is recreated the next
 * time the tray icon is clicked.
 */
export function closeTrayPopover(suspend = false) {
  return core.invoke<void>('close_tray_popover', { suspend })
}

export function resizeTrayPopover(
  width: number,
  height: number,
  options?: { animate?: boolean; blurOverlayOnResize?: boolean },
) {
  return core.invoke<void>('resize_tray_popover', {
    width,
    height,
    animate: options?.animate,
    blurOverlayOnResize: options?.blurOverlayOnResize,
  })
}

export function isTrayPopoverVisible() {
  return core.invoke<boolean>('is_tray_popover_visible')
}

/** Shows or removes the menu bar (tray) icon */
export function setTrayIconEnabled(enabled: boolean) {
  return core.invoke<void>('set_tray_icon_enabled', { enabled })
}

/** Shows & focuses the main window, recreating it if it was closed */
export function focusMainWindow() {
  return core.invoke<void>('focus_main_window')
}

export function quitApp() {
  return core.invoke<void>('quit_app')
}
