import React from 'react'

import GlidingToggle from '@/components/GlidingToggle'
import SlidingPanels from '@/components/SlidingPanels'
import { cn } from '@/utils/tailwind'

type ToggleSectionOption<T extends string> = {
  value: T
  label: React.ReactNode
  /** The settings shown for this choice */
  content: React.ReactNode
}

type ToggleSectionProps<T extends string> = {
  options: readonly [ToggleSectionOption<T>, ToggleSectionOption<T>]
  value: T
  onChange: (value: T) => void
  isDisabled?: boolean
  'aria-label': string
  className?: string
}

/**
 * One setting with two ways of doing it (e.g. by quality or to a size), grouped in a panel: a
 * centered `GlidingToggle` on top, and each choice's settings below, sliding to the chosen side
 */
function ToggleSection<T extends string>(props: ToggleSectionProps<T>) {
  const { options, value, onChange, isDisabled, className, ...rest } = props
  const index = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  )

  return (
    <section
      className={cn(
        'rounded-xl border px-3 pt-3',
        'border-zinc-200 bg-zinc-50/60 dark:border-white/[0.06] dark:bg-white/[0.02]',
        className,
      )}
    >
      <div className="flex justify-center">
        <GlidingToggle
          aria-label={rest['aria-label']}
          options={[
            { value: options[0].value, label: options[0].label },
            { value: options[1].value, label: options[1].label },
          ]}
          value={value}
          onChange={onChange}
          isDisabled={isDisabled}
        />
      </div>
      <SlidingPanels
        // Edge to edge, with the section's padding inside each panel instead, so a slider's thumb
        // at either end is not cut off while sliding
        className="mt-4 -mx-3"
        panelClassName="px-3 pb-2"
        index={index}
        panels={options.map((option) => option.content)}
      />
    </section>
  )
}

export default ToggleSection
