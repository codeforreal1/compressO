import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { event } from '@tauri-apps/api'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { subscribeKey } from 'valtio/utils'

import { Toaster } from '@/components/Toast'
import {
  useAutoCompressSync,
  useWatchedFoldersSync,
} from '@/hooks/useAutoCompressSync'
import { useClipboardWatchSync } from '@/hooks/useClipboardWatchSync'
import { useHardwareEncodingSync } from '@/hooks/useHardwareEncoding'
import { useKeepAwakeSync } from '@/hooks/useKeepAwakeSync'
import { watchPrimaryColor } from '@/hooks/usePrimaryColor'
import { useWindowTint } from '@/hooks/useWindowTint'
import { settingsStore } from '@/stores/settingsStore'
import { checkForUpdates, setupUpdateListeners } from '@/stores/updateStore'
import { takeOpenedAtLogin } from '@/tauri/commands/app'
import {
  setTrayIconEnabled,
  setTrayProgressColor,
  TRAY_WINDOW_LABEL,
} from '@/tauri/commands/tray'
import { isWindowTintSupported } from '@/tauri/commands/window'
import Titlebar from '@/tauri/components/Titlebar'
import DropZoneIsland from '@/ui/DropZoneIsland'
import { getPlatform } from '@/utils/fs'
import { hasTray } from '@/utils/tray'
import { useDropQueueRunner } from './webviews/tray/-queue'
import UIProvider from '../providers/UIProvider'

export const Route = createRootRoute({
  component: RootComponent,
})

const isDev = import.meta.env.DEV

const { isMacOS, isWindows } = getPlatform()
// The tray popover's translucent material: macOS' popover, or Windows 11's Acrylic
const hasTrayMaterial = isMacOS || (isWindows && isWindowTintSupported())

// The tray popover (macOS status bar) renders this frontend in its own webview window
const isTrayWindow = getCurrentWindow().label === TRAY_WINDOW_LABEL

function RootComponent() {
  return isTrayWindow ? <TrayRoot /> : <MainRoot />
}

function MainRoot() {
  useWindowTint()
  useClipboardWatchSync({ applyOnMount: true })
  useAutoCompressSync()
  // Also from the menu bar's window, which stays open while the main one is closed
  useWatchedFoldersSync()
  useHardwareEncodingSync()
  useKeepAwakeSync()

  useEffect(() => {
    // Also tells the backend to show the window, which starts hidden to avoid a blank flash;
    // opened at login, it stays hidden with "Open in the menu bar only" (macOS, with the menu bar
    // icon), as the app works from the menu bar
    takeOpenedAtLogin()
      .catch(() => false)
      .then((isOpenedAtLogin) => {
        const isMenuBarOnly =
          hasTray &&
          isOpenedAtLogin &&
          settingsStore.openInMenuBarOnly &&
          settingsStore.showMenuBarIcon
        event.emit('frontend-ready', { show: !isMenuBarOnly })
      })
    setupUpdateListeners()
    checkForUpdates()
  }, [])

  useEffect(() => {
    if (!hasTray) return
    // The backend adds the tray icon (the macOS menu bar's or the Windows system tray's) only when the setting (General -> Show menu bar icon) is on
    const applyMenuBarIcon = () => {
      setTrayIconEnabled(settingsStore.showMenuBarIcon).catch(() => {})
    }
    applyMenuBarIcon()
    return subscribeKey(settingsStore, 'showMenuBarIcon', applyMenuBarIcon)
  }, [])

  return (
    <>
      <UIProvider className={isMacOS ? 'pt-4' : ''}>
        {isMacOS ? <Titlebar /> : null}
        <Outlet />
        {/* The drop zone of the tray, while it has media */}
        {/* The drop zone's queue (on Linux, only that of the watched folders) */}
        <DropZoneIsland />
        {/* No menu bar window on Linux: the main window compresses the watched folders' queue */}
        {hasTray ? null : <DropQueueRunner />}
      </UIProvider>
      <Toaster />
      {isDev ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </>
  )
}

/** Compresses the drop zone's queue from this window (see `useDropQueueRunner`) */
function DropQueueRunner() {
  useDropQueueRunner()
  return null
}

function TrayRoot() {
  useClipboardWatchSync({ applyOnMount: false })
  useAutoCompressSync()
  // Also from the menu bar's window, which stays open while the main one is closed
  useWatchedFoldersSync()
  useHardwareEncodingSync()
  useKeepAwakeSync()
  // The menu bar's window compresses the drop zone's queue
  useDropQueueRunner()
  // The Windows tray icon's progress ring fills with the accent color
  useEffect(() => {
    if (!isWindows) return
    return watchPrimaryColor((color) => {
      setTrayProgressColor(color).catch(() => {})
    })
  }, [])
  useEffect(() => {
    // The popover follows the system appearance (as its native material does), so its content
    // does too
    const root = document.documentElement
    // Transparent where the native material shows through (see `global.css`)
    if (hasTrayMaterial) root.dataset.window = TRAY_WINDOW_LABEL
    const applyTheme = (isDark: boolean) =>
      root.classList.toggle('dark', isDark)

    // On Windows, from the tray window's own theme, which follows the system (see `system_theme`
    // in `win/tray_popover.rs`): the page's `prefers-color-scheme` is shared with the main
    // window's webview, which follows the app's theme instead
    if (isWindows) {
      const trayWindow = getCurrentWindow()
      trayWindow
        .theme()
        .then((theme) => applyTheme(theme === 'dark'))
        .catch(() => {})
      const unlisten = trayWindow.onThemeChanged(({ payload }) =>
        applyTheme(payload === 'dark'),
      )
      return () => {
        unlisten.then((fn) => fn()).catch(() => {})
      }
    }

    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applySystemTheme = () => applyTheme(systemTheme.matches)
    applySystemTheme()
    systemTheme.addEventListener('change', applySystemTheme)
    return () => {
      systemTheme.removeEventListener('change', applySystemTheme)
    }
  }, [])

  return (
    <>
      {/* Without the material (Windows 10), a solid background */}
      <UIProvider
        className={
          !hasTrayMaterial
            ? 'bg-zinc-50 dark:bg-zinc-900'
            : isWindows
              ? // Light Acrylic alone turns grey over dark windows: tinted white, as Windows' flyouts
                'bg-white/60 dark:bg-transparent'
              : 'bg-transparent dark:bg-transparent'
        }
      >
        <Outlet />
      </UIProvider>
      <Toaster />
    </>
  )
}
