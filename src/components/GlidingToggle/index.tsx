import { motion, useReducedMotion } from 'framer-motion'
import React from 'react'

import { glassSurface, glassTrack } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

type GlidingToggleOption<T extends string> = {
  value: T
  label: React.ReactNode
}

type GlidingToggleProps<T extends string> = {
  /** Two choices, side by side */
  options: readonly [GlidingToggleOption<T>, GlidingToggleOption<T>]
  value: T
  onChange: (value: T) => void
  isDisabled?: boolean
  'aria-label': string
  className?: string
}

/**
 * A choice between two options in one rounded track: a frosted glass pill (like the website's
 * buttons) glides behind the chosen one, which reads as normal text while the other is dimmed
 */
function GlidingToggle<T extends string>(props: GlidingToggleProps<T>) {
  const { options, value, onChange, isDisabled, className, ...rest } = props
  const reduceMotion = useReducedMotion()
  const chosenIndex = options.findIndex((option) => option.value === value)

  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      aria-disabled={isDisabled}
      className={cn(
        'relative inline-grid grid-cols-2 rounded-full p-0.5',
        glassTrack,
        isDisabled && 'opacity-60',
        className,
      )}
      onKeyDown={(event) => {
        if (isDisabled) return
        if (event.key === 'ArrowLeft') onChange(options[0].value)
        if (event.key === 'ArrowRight') onChange(options[1].value)
      }}
    >
      {/* The pill, behind the chosen option */}
      <motion.span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2px)] rounded-full',
          glassSurface,
          'backdrop-blur-md',
        )}
        initial={false}
        animate={{ x: chosenIndex === 1 ? '100%' : '0%' }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }
        }
      />
      {options.map((option) => {
        const isChosen = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isChosen}
            tabIndex={isChosen ? 0 : -1}
            disabled={isDisabled}
            onClick={() => {
              if (!isChosen) onChange(option.value)
            }}
            className={cn(
              'relative z-10 flex h-[22px] items-center justify-center rounded-full px-3 text-[11px]',
              'transition-colors duration-200 disabled:cursor-default',
              isChosen
                ? 'text-zinc-900 dark:text-white'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default GlidingToggle
