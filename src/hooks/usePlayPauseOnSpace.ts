import { useEffect, useRef } from 'react'

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'password',
  'url',
  'tel',
  'number',
])

/** Whether Space should type into the element instead of playing/pausing */
function isTextEntryElement(element: HTMLElement) {
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type)
  }
  return element instanceof HTMLTextAreaElement || element.isContentEditable
}

/**
 * Plays/pauses media with Space, even when a switch or button has focus (e.g. right after clicking
 * it). Handled in the capture phase and swallowed on both keydown & keyup, since focused
 * checkboxes/buttons otherwise toggle or click on Space. Typing in text fields and choosing options
 * in listboxes, menus & dialogs keep Space.
 */
export function usePlayPauseOnSpace(
  isEnabled: boolean,
  onPlayPause: () => void,
) {
  // Latest callback, so the listeners are not re-attached on every render
  const onPlayPauseRef = useRef(onPlayPause)
  onPlayPauseRef.current = onPlayPause

  useEffect(() => {
    if (!isEnabled) return

    const shouldHandleSpace = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return false
      const target = e.target as HTMLElement
      return !(
        isTextEntryElement(target) ||
        target.closest?.('[role="listbox"], [role="menu"], [role="dialog"]')
      )
    }

    const handleSpaceKeyDown = (e: KeyboardEvent) => {
      if (!shouldHandleSpace(e)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      onPlayPauseRef.current()
    }

    const handleSpaceKeyUp = (e: KeyboardEvent) => {
      if (!shouldHandleSpace(e)) return
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', handleSpaceKeyDown, true)
    window.addEventListener('keyup', handleSpaceKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleSpaceKeyDown, true)
      window.removeEventListener('keyup', handleSpaceKeyUp, true)
    }
  }, [isEnabled])
}
