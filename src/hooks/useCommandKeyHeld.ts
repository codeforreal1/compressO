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
      setIsHeld(e.ctrlKey || (!!isMacOS && e.metaKey))
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
