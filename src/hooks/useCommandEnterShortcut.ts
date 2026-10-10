import { useEffect, useRef } from 'react'

import { getPlatform } from '@/utils/fs'

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'color',
  'file',
])

/** Whether the element takes typed text, where the shortcut should not trigger actions */
function isTextEntryElement(element: HTMLElement | null) {
  if (!element) return false
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type)
  }
  return element instanceof HTMLTextAreaElement || element.isContentEditable
}

/**
 * Runs `onShortcut` on ⌘+Shift+Enter (Ctrl+Shift+Enter on other platforms; also accepted on macOS),
 * except while typing in a text field or while a dialog (e.g. settings) is open.
 *
 * Handled in the capture phase and swallowed on both keydown & keyup, so a focused element never
 * receives it (e.g. the video player's focused play/pause button would otherwise toggle playback).
 */
export function useCommandEnterShortcut(
  isEnabled: boolean,
  onShortcut: () => void,
) {
  // Latest callback, so the listener is not re-attached on every render
  const onShortcutRef = useRef(onShortcut)
  onShortcutRef.current = onShortcut

  useEffect(() => {
    if (!isEnabled) return

    const { isMacOS } = getPlatform()
    const isShortcut = (e: KeyboardEvent) =>
      e.key === 'Enter' &&
      e.shiftKey &&
      !e.altKey &&
      (e.ctrlKey || (isMacOS && e.metaKey)) &&
      !isTextEntryElement(e.target as HTMLElement | null) &&
      !document.querySelector('[role="dialog"]')

    // The keyup of a handled shortcut is swallowed too (the modifiers may be released first)
    let isShortcutPressed = false

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return
      e.preventDefault()
      e.stopPropagation()
      isShortcutPressed = true
      if (!e.repeat) {
        onShortcutRef.current()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !isShortcutPressed) return
      isShortcutPressed = false
      e.preventDefault()
      e.stopPropagation()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [isEnabled])
}
