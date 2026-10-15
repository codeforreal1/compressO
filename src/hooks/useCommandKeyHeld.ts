import { useEffect, useState } from 'react'

import { getPlatform } from '@/utils/fs'

/**
 * Whether ⌘ (macOS) or Ctrl is held down, e.g. to reveal keyboard shortcuts while it is held. Only
 * listens while `isEnabled`.
 */
export function useCommandKeyHeld(isEnabled = true) {
  const [isHeld, setIsHeld] = useState(false)

  useEffect(() => {
    if (!isEnabled) {
      setIsHeld(false)
      return
    }

    const { isMacOS } = getPlatform()
    const handleKeyChange = (e: KeyboardEvent) => {
      // Releasing the key itself still reports it as held in Linux (WebKitGTK gives the state from
      // before the event), so its keyup always counts as released
      const isReleased = e.type === 'keyup'
      const isCtrlHeld = e.ctrlKey && !(isReleased && e.key === 'Control')
      const isCommandHeld =
        !!isMacOS && e.metaKey && !(isReleased && e.key === 'Meta')
      setIsHeld(isCtrlHeld || isCommandHeld)
    }
    // The keyup is missed when the window loses focus while the key is held
    const reset = () => setIsHeld(false)

    window.addEventListener('keydown', handleKeyChange, true)
    window.addEventListener('keyup', handleKeyChange, true)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', handleKeyChange, true)
      window.removeEventListener('keyup', handleKeyChange, true)
      window.removeEventListener('blur', reset)
    }
  }, [isEnabled])

  return isHeld
}
