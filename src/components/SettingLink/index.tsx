import type React from 'react'

import type { SettingsTarget } from '@/constants/settingsIndex'
import { openSettings } from '@/stores/settingsDialogStore'

type SettingLinkProps = {
  /** The page or setting opened, which is then highlighted */
  target: SettingsTarget
  /** Given by `Trans`, from the text's `<setting>` tag (not `<link>`, an empty HTML element) */
  children?: React.ReactNode
}

/**
 * A link in text to a setting (or a page of the settings), e.g. "Turn on Show menu bar icon": a
 * button without a button's look, the size of the text around it, also in a tooltip
 */
function SettingLink({ target, children }: SettingLinkProps) {
  return (
    <button
      type="button"
      className="inline p-0 m-0 border-0 bg-transparent font-[inherit] text-[length:inherit] leading-[inherit] align-baseline text-primary underline-offset-2 hover:underline focus-visible:underline outline-none cursor-pointer"
      // Keeps the focus where it is, so a tooltip it is in does not close before the click
      onMouseDown={(evt) => evt.preventDefault()}
      onClick={(evt) => {
        evt.stopPropagation()
        openSettings(target).catch(() => {})
      }}
    >
      {children}
    </button>
  )
}

export default SettingLink
