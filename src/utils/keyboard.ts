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

/** Whether the element takes typed text, where shortcuts should not trigger actions */
export function isTextEntryElement(element: HTMLElement | null) {
  if (!element) return false
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type)
  }
  return element instanceof HTMLTextAreaElement || element.isContentEditable
}

/** Whether a dialog (e.g. settings), menu or dropdown list is open, which owns the keyboard */
export function isOverlayOpen() {
  return !!document.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
  )
}
