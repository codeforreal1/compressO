import React, { useEffect, useRef, useState } from 'react'

import Button from '@/components/Button'
import TextInput from '@/components/TextInput'
import { cn } from '@/utils/tailwind'

type StepperInputProps = {
  value: number
  onChange: (value: number) => void
  minValue: number
  maxValue: number
  /** How much − and + change the value */
  step?: number
  /** Shown after the value, e.g. `MB` */
  unit?: React.ReactNode
  /** The most decimals shown (1 by default) */
  decimals?: number
  label?: React.ReactNode
  'aria-label': string
  /** Labels of − and + */
  decreaseLabel: string
  increaseLabel: string
  isDisabled?: boolean
  className?: string
}

/** How long − or + is held before it repeats, then how often it repeats (faster the longer) */
const HOLD_DELAY_MS = 400
const REPEAT_START_MS = 120
const REPEAT_FASTEST_MS = 30

/** A value as shown in the field, with at most `decimals` decimals */
const formatValue = (value: number, decimals: number) =>
  `${Number(value.toFixed(decimals))}`

/**
 * A number that can be typed (used as each digit is typed, once it is within the limits; below the
 * lowest, it is raised to it when the field is left), or changed with a − on its left & a + on its right (held down, they
 * keep changing it, faster the longer), filling the width with the value centered between them
 */
function StepperInput(props: StepperInputProps) {
  const {
    value,
    onChange,
    minValue,
    maxValue,
    step = 1,
    unit,
    decimals = 1,
    label,
    decreaseLabel,
    increaseLabel,
    isDisabled,
    className,
  } = props

  const clamp = (next: number) => Math.min(Math.max(next, minValue), maxValue)

  // The text typed, kept apart from the value so a number can be typed through values outside the
  // limits (e.g. 2 & 20 on the way to 200)
  const [text, setText] = useState(() => formatValue(value, decimals))
  const textRef = useRef(text)
  textRef.current = text
  // A value changed elsewhere (− & +, a lowest value) is shown, unless the text already means it
  useEffect(() => {
    if (Number.parseFloat(textRef.current) !== value)
      setText(formatValue(value, decimals))
  }, [value, decimals])

  const handleTextChange = (next: string) => {
    const cleaned = next.replace(/[^\d.]/g, '')
    setText(cleaned)
    const typed = Number.parseFloat(cleaned)
    if (Number.isNaN(typed)) return
    if (typed > maxValue) {
      setText(formatValue(maxValue, decimals))
      onChange(maxValue)
    } else if (typed >= minValue && typed !== value) {
      onChange(typed)
    }
  }

  /** Leaving the field: an empty or too small number becomes a valid one */
  const commitText = () => {
    const typed = Number.parseFloat(textRef.current)
    const next = Number.isNaN(typed) ? value : clamp(typed)
    setText(formatValue(next, decimals))
    if (next !== value) onChange(next)
  }

  // The value as last changed, so steps while held add up before the next render
  const valueRef = useRef(value)
  valueRef.current = value
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopRepeating = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }
  // Stops repeating when it goes away while held
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  /** One step at once, then repeated while held, faster the longer (until a limit) */
  const startStepping = (direction: 1 | -1) => {
    stopRepeating()
    const stepOnce = () => {
      const next = clamp(valueRef.current + direction * step)
      if (next === valueRef.current) {
        stopRepeating()
        return false
      }
      valueRef.current = next
      onChange(next)
      return true
    }
    if (!stepOnce()) return
    let interval = REPEAT_START_MS
    const repeat = () => {
      if (!stepOnce()) return
      interval = Math.max(REPEAT_FASTEST_MS, interval * 0.85)
      timerRef.current = setTimeout(repeat, interval)
    }
    timerRef.current = setTimeout(repeat, HOLD_DELAY_MS)
  }

  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <p className="mb-1.5 text-xs text-gray-600 dark:text-gray-400">
          {label}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          isIconOnly
          size="sm"
          aria-label={decreaseLabel}
          onPressStart={() => startStepping(-1)}
          onPressEnd={stopRepeating}
          isDisabled={isDisabled || value <= minValue}
          className="text-base"
        >
          −
        </Button>
        <TextInput
          aria-label={props['aria-label']}
          inputMode="decimal"
          value={text}
          onValueChange={handleTextChange}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitText()
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const next = clamp(
                value + (event.key === 'ArrowUp' ? step : -step),
              )
              setText(formatValue(next, decimals))
              onChange(next)
            }
          }}
          endContent={
            unit ? (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {unit}
              </span>
            ) : null
          }
          isDisabled={isDisabled}
          className="flex-1"
          // As tall as the − & + buttons
          classNames={{ inputWrapper: 'h-8 min-h-8', input: 'text-center' }}
        />
        <Button
          isIconOnly
          size="sm"
          aria-label={increaseLabel}
          onPressStart={() => startStepping(1)}
          onPressEnd={stopRepeating}
          isDisabled={isDisabled || value >= maxValue}
          className="text-base"
        >
          +
        </Button>
      </div>
    </div>
  )
}

export default StepperInput
