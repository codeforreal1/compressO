import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { event } from '@tauri-apps/api'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { subscribeKey } from 'valtio/utils'

import { Toaster } from '@/components/Toast'
import { settingsStore } from '@/stores/settingsStore'
import { checkForUpdates, setupUpdateListeners } from '@/stores/updateStore'
import { setTrayIconEnabled, TRAY_WINDOW_LABEL } from '@/tauri/commands/tray'
import Titlebar from '@/tauri/components/Titlebar'
import { getPlatform } from '@/utils/fs'
import UIProvider from '../providers/UIProvider'

export const Route = createRootRoute({
  component: RootComponent,
})

const isDev = import.meta.env.DEV

const { isMacOS } = getPlatform()

// The tray popover (macOS status bar) renders this frontend in its own webview window
const isTrayWindow = getCurrentWindow().label === TRAY_WINDOW_LABEL

function RootComponent() {
  return isTrayWindow ? <TrayRoot /> : <MainRoot />
}

function MainRoot() {
  useEffect(() => {
    // Also tells the backend to show the window, which starts hidden to avoid a blank flash
    event.emit('frontend-ready')
    setupUpdateListeners()
    checkForUpdates()
  }, [])

  useEffect(() => {
    if (!isMacOS) return
    // The backend adds the menu bar icon only when the setting (General -> Show menu bar icon) is on
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
      </UIProvider>
      <Toaster />
      {isDev ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </>
  )
}

function TrayRoot() {
  useEffect(() => {
    // The popover's native material follows the system appearance, so its content does too
    const root = document.documentElement
    root.dataset.window = TRAY_WINDOW_LABEL
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applySystemTheme = () =>
      root.classList.toggle('dark', systemTheme.matches)
    applySystemTheme()
    systemTheme.addEventListener('change', applySystemTheme)
    return () => {
      systemTheme.removeEventListener('change', applySystemTheme)
    }
  }, [])

  return (
    <>
      <UIProvider className="bg-transparent dark:bg-transparent">
        <Outlet />
      </UIProvider>
      <Toaster />
    </>
  )
}
