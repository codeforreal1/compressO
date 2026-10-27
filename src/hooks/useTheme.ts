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

/**
 * Shows the system's look in this window, also when it changes, whatever the app's own choice
 * (e.g. the first-time setup window, open before anything is chosen)
 */
export function useSystemThemeClass() {
  useEffect(() => {
    const window = getCurrentWindow()
    const apply = (theme: ThemeVariant) =>
      document.documentElement.classList.toggle('dark', theme === 'dark')
    // This window is never set to a theme, so its own is the system's
    window
      .theme()
      .then((theme) =>
        apply(theme ?? (systemDarkQuery.matches ? 'dark' : 'light')),
      )
      .catch(() => apply(systemDarkQuery.matches ? 'dark' : 'light'))
    const unlisten = window
      .onThemeChanged(({ payload }) => apply(payload))
      .catch(() => undefined)
    // Where the window's theme is not reported (Linux), the webview's
    const applyQuery = () => apply(systemDarkQuery.matches ? 'dark' : 'light')
    systemDarkQuery.addEventListener('change', applyQuery)
    return () => {
      unlisten.then((stop) => stop?.())
      systemDarkQuery.removeEventListener('change', applyQuery)
    }
  }, [])
}
