import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { proxy, useSnapshot } from 'valtio'

import * as constants from '@/constants'
import { getSystemDarkMode } from '@/tauri/commands/window'

/** The look in use */
export type ThemeVariant = 'light' | 'dark'

/** The look chosen: the system's (the default), or always light or dark */
export type ThemePreference = 'system' | ThemeVariant

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)')

function readPreference(): ThemePreference {
  const stored = localStorage.getItem(constants.theme)
  return THEME_PREFERENCES.includes(stored as ThemePreference)
    ? (stored as ThemePreference)
    : 'system'
}

type ThemeProxy = {
  preference: ThemePreference
  /** The look in use: the preference, or the system's look with "system" */
  theme: ThemeVariant
}

const preference = readPreference()
const themeProxy: ThemeProxy = proxy({
  preference,
  // As applied before the first render (see `main.tsx`)
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
})

/** The system's look, from the system where it can be read (see `getSystemDarkMode`) */
export async function getSystemTheme(): Promise<ThemeVariant> {
  const isDark = await getSystemDarkMode().catch(() => null)
  return (isDark ?? systemDarkQuery.matches) ? 'dark' : 'light'
}

/** The look a preference gives */
export async function resolveTheme(
  preference: ThemePreference,
): Promise<ThemeVariant> {
  return preference === 'system' ? getSystemTheme() : preference
}

/** Shows a look, at once (e.g. inside a view transition, see `ThemeSwitcher`) */
export function applyTheme(theme: ThemeVariant) {
  themeProxy.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/** Chooses the look; `theme` is the one it gives (see `resolveTheme`), shown at once */
export function setThemePreference(
  preference: ThemePreference,
  theme: ThemeVariant,
) {
  themeProxy.preference = preference
  localStorage.setItem(constants.theme, preference)
  applyTheme(theme)
}

/**
 * Follows the system's look while "system" is chosen, also when it changes (e.g. macOS' "Auto"
 * switching at sunset). Used once, by the main window: the menu bar's follows the system itself.
 */
export function useThemeSync() {
  useEffect(() => {
    const followSystem = () => {
      if (themeProxy.preference !== 'system') return
      getSystemTheme().then((theme) => {
        if (themeProxy.preference === 'system') applyTheme(theme)
      })
    }
    // Corrects the guess made before the first render, which the webview may get wrong
    followSystem()
    // The window's theme follows the system's while the app does (see `setWindowTint`)
    const unlisten = getCurrentWindow()
      .onThemeChanged(followSystem)
      .catch(() => undefined)
    // Where the window's theme is not reported (Linux), the webview's
    systemDarkQuery.addEventListener('change', followSystem)
    return () => {
      unlisten.then((stop) => stop?.())
      systemDarkQuery.removeEventListener('change', followSystem)
    }
  }, [])
}

export function useTheme() {
  return useSnapshot(themeProxy)
}
