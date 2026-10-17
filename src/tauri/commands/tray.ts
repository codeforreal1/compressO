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

/** Sent to every window when watching the clipboard is turned on or off */
export const CLIPBOARD_WATCH_EVENT = 'clipboard-watch-changed'

/**
 * Adds files copied to the clipboard to the media dropped on the menu bar (or stops doing so).
 * Only while the menu bar icon is shown.
 */
export function setClipboardWatchEnabled(enabled: boolean) {
  return core.invoke<void>('set_clipboard_watch_enabled', { enabled })
}

export function isClipboardWatchEnabled() {
  return core.invoke<boolean>('is_clipboard_watch_enabled')
}

/** Shows or removes the menu bar (tray) icon */
export function setTrayIconEnabled(enabled: boolean) {
  return core.invoke<void>('set_tray_icon_enabled', { enabled })
}

/**
 * Shows & focuses the main window, recreating it if it was closed, with the files dropped on the
 * menu bar (if any)
 */
export function focusMainWindow() {
  return core.invoke<void>('focus_main_window')
}

/** Sent to the tray window whenever the files dropped on the menu bar change */
export const DROPPED_FILES_EVENT = 'tray-dropped-files'

/**
 * Collects files & folders dropped on the menu bar; they are opened in the main window with
 * `focusMainWindow`. Refused while compressing or while compressed media is unsaved.
 */
/**
 * Adds what is on the clipboard, pasted in the popover: copied files, or a copied image (e.g. in a
 * browser). Resolves to the number of unsupported files that were skipped; rejects with nothing to
 * add (e.g. copied text).
 */
export function pasteDroppedFiles() {
  return core.invoke<number>('paste_dropped_files')
}

export function addDroppedFiles(paths: string[]) {
  // Resolves to the number of unsupported files that were skipped
  return core.invoke<number>('add_dropped_files', { paths })
}

/** Media extensions accepted when dropped on the menu bar (folders are always accepted) */
export function setSupportedDropExtensions(extensions: string[]) {
  return core.invoke<void>('set_supported_drop_extensions', { extensions })
}

export function removeDroppedFile(path: string) {
  return core.invoke<void>('remove_dropped_file', { path })
}

export function clearDroppedFiles() {
  return core.invoke<void>('clear_dropped_files')
}

export function getDroppedFiles() {
  return core.invoke<string[]>('get_dropped_files')
}

/** Pins the popover (stays open when clicking outside it) or restores the default behavior */
export function setTrayPopoverPinned(pinned: boolean) {
  return core.invoke<void>('set_tray_popover_pinned', { pinned })
}

/** The accent color (as `"255 132 0"`), which the Windows tray icon's progress ring fills with */
export function setTrayProgressColor(color: string) {
  return core.invoke<void>('set_tray_progress_color', { color })
}

export function quitApp() {
  return core.invoke<void>('quit_app')
}
