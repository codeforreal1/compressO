import React, { useCallback, useRef, useState } from 'react'

import { glassTrack } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

type SliderValue = number | number[]

type SliderMark = { value: number; label: React.ReactNode }

type SliderProps = {
  /** Shown inside the bar, on its left */
  label?: React.ReactNode
  'aria-label'?: string
  value?: number
  defaultValue?: number
  /** Called with a number (an array is never given; the type matches HeroUI's for callers) */
  onChange?: (value: SliderValue) => void
  /** Called once the value is chosen (dragging ends, a key is released) */
  onChangeEnd?: (value: SliderValue) => void
  minValue?: number
  maxValue?: number
  /** How much the value changes at a time (1 by default); a given step is a faint tick each */
  step?: number
  /** Values named under the bar (e.g. Low, Medium, High) */
  marks?: SliderMark[]
  /** The value as text, shown on the right (& read by screen readers) */
  getValue?: (value: SliderValue) => string
  /** What is shown on the right instead of the value (`children` is the value as text) */
  renderValue?: (props: {
    value: number
    children: React.ReactNode
  }) => React.ReactNode
  isDisabled?: boolean
  name?: string
  /** Kept for callers; every slider has the same size */
  size?: 'sm' | 'md' | 'lg'
  className?: string
  classNames?: Partial<
    Record<'base' | 'label' | 'value' | 'mark' | 'track', string>
  >
}

/** At most this many steps are drawn as ticks (more would be a blur) */
const MAX_TICKS = 40

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

/** The number of decimals of a step, so values snap without float noise (e.g. 0.01 → 2) */
const getDecimals = (step: number) => {
  const text = `${step}`
  return text.includes('.') ? text.split('.')[1].length : 0
}

/**
 * A frosted bar with its label inside on the left & its value on the right: the part up to the
 * value is a lighter frosted block, ending in a thin handle that grows while hovered or dragged.
 * Sliders with steps show a faint tick for each. Dragged anywhere on the bar, or changed with the
 * arrow keys, Home & End.
 */
function Slider(props: SliderProps) {
  const {
    label,
    value: controlledValue,
    defaultValue,
    onChange,
    onChangeEnd,
    minValue = 0,
    maxValue = 100,
    step,
    marks,
    getValue,
    renderValue,
    isDisabled,
    name,
    className,
    classNames,
  } = props

  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? minValue,
  )
  const value = clamp(controlledValue ?? uncontrolledValue, minValue, maxValue)
  const range = maxValue - minValue || 1
  // Whole numbers by default (as before); only sliders given a step show its ticks
  const valueStep = step ?? 1
  const decimals = getDecimals(valueStep)
  const position = (value - minValue) / range

  const barRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  // The value as last changed, so a drag's end reports it before the next render
  const latestValue = useRef(value)
  latestValue.current = value

  const setValue = useCallback(
    (next: number) => {
      const snapped =
        Math.round((next - minValue) / valueStep) * valueStep + minValue
      const rounded = Number(
        clamp(snapped, minValue, maxValue).toFixed(decimals),
      )
      if (rounded === latestValue.current) return
      latestValue.current = rounded
      if (controlledValue === undefined) setUncontrolledValue(rounded)
      onChange?.(rounded)
    },
    [valueStep, minValue, maxValue, decimals, controlledValue, onChange],
  )

  const valueAt = (clientX: number) => {
    const bar = barRef.current
    if (!bar) return value
    const { left, width } = bar.getBoundingClientRect()
    return minValue + clamp((clientX - left) / width, 0, 1) * range
  }

  const tickCount = step ? Math.round(range / step) : 0
  const ticks =
    tickCount > 1 && tickCount <= MAX_TICKS
      ? Array.from({ length: tickCount - 1 }, (_, i) => (i + 1) / tickCount)
      : []

  const valueText = getValue?.(value)
  const shownValue = renderValue
    ? renderValue({ value, children: valueText ?? `${value}` })
    : (valueText ?? `${value}`)
  const isActive = (isDragging || isHovered) && !isDisabled

  return (
    <div className={cn('w-full', className, classNames?.base)}>
      <div
        ref={barRef}
        role="slider"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={props['aria-label']}
        aria-valuemin={minValue}
        aria-valuemax={maxValue}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-disabled={isDisabled}
        className={cn(
          'relative h-8 select-none overflow-hidden rounded-xl outline-none touch-none',
          glassTrack,
          'focus-visible:ring-2 focus-visible:ring-primary/60',
          isDisabled ? 'opacity-50' : 'cursor-ew-resize',
          classNames?.track,
        )}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        onPointerDown={(event) => {
          if (isDisabled) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setIsDragging(true)
          setValue(valueAt(event.clientX))
        }}
        onPointerMove={(event) => {
          if (isDragging) setValue(valueAt(event.clientX))
        }}
        onPointerUp={() => {
          if (!isDragging) return
          setIsDragging(false)
          onChangeEnd?.(latestValue.current)
        }}
        onPointerCancel={() => setIsDragging(false)}
        onKeyDown={(event) => {
          if (isDisabled) return
          const next =
            event.key === 'ArrowRight' || event.key === 'ArrowUp'
              ? value + valueStep
              : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                ? value - valueStep
                : event.key === 'Home'
                  ? minValue
                  : event.key === 'End'
                    ? maxValue
                    : null
          if (next === null) return
          event.preventDefault()
          setValue(next)
        }}
        onKeyUp={() => onChangeEnd?.(latestValue.current)}
      >
        {/* A tick for each step */}
        {ticks.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-zinc-400/40 dark:bg-white/[0.12]"
            style={{ left: `${tick * 100}%` }}
          />
        ))}

        {/* Up to the value: a lighter frosted block, ending in the handle */}
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-0 rounded-xl',
            'bg-zinc-300/60 dark:bg-white/[0.09]',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
          )}
          style={{ width: `max(${position * 100}%, 14px)` }}
        >
          <span
            className={cn(
              'absolute right-1.5 top-1/2 w-1 -translate-y-1/2 rounded-full',
              'transition-[height,background-color] duration-200 ease-out',
              isActive
                ? 'h-5 bg-zinc-700 dark:bg-white'
                : 'h-3.5 bg-zinc-500/80 dark:bg-white/60',
            )}
          />
        </span>

        {/* The label & the value, inside the bar */}
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-zinc-600 dark:text-zinc-400',
            classNames?.label,
          )}
        >
          {label}
        </span>
        <span
          className={cn(
            'pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-zinc-900 tabular-nums dark:text-white',
            classNames?.value,
          )}
        >
          {shownValue}
        </span>
        {name ? <input type="hidden" name={name} value={value} /> : null}
      </div>

      {/* Named values, under the bar (chosen by clicking them) */}
      {marks?.length ? (
        <div className="relative mt-1.5 h-4">
          {marks.map((mark) => {
            const markPosition = (mark.value - minValue) / range
            return (
              <button
                key={mark.value}
                type="button"
                // Choosing a named value jumps to it
                onClick={() => {
                  setValue(mark.value)
                  onChangeEnd?.(latestValue.current)
                }}
                disabled={isDisabled}
                tabIndex={-1}
                className={cn(
                  'absolute top-0 whitespace-nowrap text-[11px] text-zinc-500 dark:text-zinc-400',
                  'transition-colors hover:text-zinc-800 dark:hover:text-zinc-100 disabled:pointer-events-none',
                  // Those at the ends stay inside the bar's width
                  markPosition <= 0.05
                    ? 'translate-x-0'
                    : markPosition >= 0.95
                      ? '-translate-x-full'
                      : '-translate-x-1/2',
                  classNames?.mark,
                )}
                style={{ left: `${markPosition * 100}%` }}
              >
                {mark.label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default Slider
