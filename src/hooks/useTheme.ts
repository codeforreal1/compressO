import { useEffect } from 'react'
import { proxy, subscribe, useSnapshot } from 'valtio'

import * as constants from '@/constants'

export type ThemeVariant = 'light' | 'dark'

export type ThemeProxy = {
  theme: ThemeVariant
  setTheme: (newTheme: ThemeVariant) => void
  toggleTheme: () => void
}

let persistedTheme: ThemeVariant | null = localStorage.getItem(
  constants.theme,
) as ThemeVariant

if (persistedTheme && !['dark', 'light'].includes(persistedTheme)) {
  localStorage.removeItem(constants.theme)
  persistedTheme = null
}

const themeProxy: ThemeProxy = proxy({
  theme: persistedTheme ?? 'dark',
  setTheme(newTheme) {
    themeProxy.theme = newTheme
  },
  toggleTheme() {
    themeProxy.theme = themeProxy.theme === 'dark' ? 'light' : 'dark'
  },
})

export function useTheme() {
  const snapshot = useSnapshot(themeProxy)

  useEffect(() => {
    if (snapshot.theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [snapshot.theme])

  useEffect(() => {
    const unsubscribe = subscribe(themeProxy, () => {
      localStorage.setItem(constants.theme, themeProxy.theme)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  return snapshot
}
