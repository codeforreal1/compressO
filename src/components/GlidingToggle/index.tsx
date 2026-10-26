import { motion, useReducedMotion } from 'framer-motion'
import React from 'react'

import { glassSurface, glassTrack } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

type GlidingToggleOption<T extends string> = {
  value: T
  label: React.ReactNode
  /** Its name, for a label that has no text (e.g. an icon) */
  'aria-label'?: string
}

type GlidingToggleProps<T extends string> = {
  /** The choices, side by side (two or more) */
  options: readonly GlidingToggleOption<T>[]
  value: T
  /** With the option's button, e.g. to start an animation from it */
  onChange: (value: T, target: HTMLButtonElement) => void
  isDisabled?: boolean
  'aria-label': string
  className?: string
}

/**
 * A choice between options in one rounded track: a frosted glass pill (like the website's
 * buttons) glides behind the chosen one, which reads as normal text while the others are dimmed
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
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
      className={cn(
        'relative inline-grid rounded-full p-0.5',
        glassTrack,
        isDisabled && 'opacity-60',
        className,
      )}
      onKeyDown={(event) => {
        if (isDisabled) return
        const step =
          event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
        const next = options[chosenIndex + step]
        if (!step || !next) return
        const buttons =
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button')
        const target = buttons[chosenIndex + step]
        target.focus()
        onChange(next.value, target)
      }}
    >
      {/* The pill, behind the chosen option */}
      <motion.span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 bottom-0.5 left-0.5 rounded-full',
          glassSurface,
          'backdrop-blur-md',
        )}
        style={{ width: `calc((100% - 4px) / ${options.length})` }}
        initial={false}
        animate={{ x: `${Math.max(chosenIndex, 0) * 100}%` }}
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
            aria-label={option['aria-label']}
            tabIndex={isChosen ? 0 : -1}
            disabled={isDisabled}
            onClick={(event) => {
              if (!isChosen) onChange(option.value, event.currentTarget)
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
