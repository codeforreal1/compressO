import React from 'react'

import { cn } from '@/utils/tailwind'

type VideoOnlySectionProps = {
  /** Disabled when only the audio is exported */
  isDisabled?: boolean
  children: React.ReactNode
}

/**
 * Settings that only apply to video outputs. They stay visible but are disabled when extracting
 * audio, so switching the extension does not shift the layout. `inert` blocks pointer, keyboard &
 * assistive-technology interaction with everything inside.
 */
function VideoOnlySection({ isDisabled, children }: VideoOnlySectionProps) {
  return (
    <div
      aria-disabled={isDisabled || undefined}
      className={cn(isDisabled ? 'opacity-40 select-none' : '')}
      // React 18 does not know `inert`; an empty string sets the boolean attribute
      {...(isDisabled ? { inert: '' } : {})}
    >
      {children}
    </div>
  )
}

export default VideoOnlySection
