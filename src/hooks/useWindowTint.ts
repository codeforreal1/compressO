import { useEffect } from 'react'
import { useSnapshot } from 'valtio'

import { useTheme } from '@/hooks/useTheme'
import { settingsStore } from '@/stores/settingsStore'
import { isWindowTintSupported, setWindowTint } from '@/tauri/commands/window'

const isSupported = isWindowTintSupported()

/**
 * Applies the tinted window setting (General -> Tinted window) to the current window, following
 * the app's theme. The page background is made translucent via `data-tinted` & the
 * `--tint-opacity` variable (see `global.css`).
 */
export function useWindowTint() {
  const { tintedWindow, tintOpacity } = useSnapshot(settingsStore)
  const { theme, preference } = useTheme()
  const followsSystem = preference === 'system'
  const isTinted = isSupported && tintedWindow

  useEffect(() => {
    if (!isSupported) return
    const root = document.documentElement
    if (isTinted) {
      root.dataset.tinted = 'true'
    } else {
      delete root.dataset.tinted
    }
    setWindowTint(isTinted, theme === 'dark', followsSystem).catch(() => {
      delete root.dataset.tinted
    })
  }, [isTinted, theme, followsSystem])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--tint-opacity',
      String(tintOpacity / 100),
    )
  }, [tintOpacity])
}

export { isSupported as isWindowTintSupported }
