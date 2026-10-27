import { animate, useReducedMotion } from 'framer-motion'
import React, { useEffect, useLayoutEffect, useRef } from 'react'

import { cn } from '@/utils/tailwind'

type AnimatedNumberProps = {
  value: number
  /** Where it counts from when it first shows (it counts from the last value after that) */
  from?: number
  /** The number as text, e.g. a size or a percentage */
  format: (value: number) => string
  /** In seconds */
  duration?: number
  delay?: number
  /** Shows the value at once, without counting */
  isStatic?: boolean
  className?: string
}

/** Fast, then slowing down at the end, so the number settles quickly on its value */
const EASE_OUT = [0.33, 1, 0.68, 1] as const

/**
 * A number that counts to its value (easing out), & from one value to the next when it changes. It
 * keeps the width of its value while counting, so the text around it does not move.
 */
function AnimatedNumber(props: AnimatedNumberProps) {
  const {
    value,
    from,
    format,
    duration = 0.3,
    delay = 0,
    isStatic,
    className,
  } = props
  const reduceMotion = useReducedMotion()
  const textRef = useRef<HTMLSpanElement>(null)
  // The value shown, which the next count starts from
  // (a static number starts at its value, so it never shows another for a moment)
  const shownRef = useRef(isStatic || reduceMotion ? value : (from ?? value))
  const formatRef = useRef(format)
  formatRef.current = format

  // The text is only written here & while counting (not by React), so both never clash; before
  // each paint, so it never shows empty
  useLayoutEffect(() => {
    if (textRef.current) {
      textRef.current.textContent = formatRef.current(shownRef.current)
    }
  })

  useEffect(() => {
    const show = (next: number) => {
      shownRef.current = next
      if (textRef.current) textRef.current.textContent = formatRef.current(next)
    }
    if (isStatic || reduceMotion || shownRef.current === value) {
      show(value)
      return
    }
    const controls = animate(shownRef.current, value, {
      duration,
      delay,
      ease: EASE_OUT,
      onUpdate: show,
    })
    return () => controls.stop()
  }, [value, isStatic, reduceMotion, duration, delay])

  return (
    <span className={cn('inline-grid tabular-nums', className)}>
      {/* Keeps the width of the value while counting */}
      <span aria-hidden="true" className="invisible col-start-1 row-start-1">
        {format(value)}
      </span>
      <span
        ref={textRef}
        className="col-start-1 row-start-1 whitespace-nowrap text-center"
      />
    </span>
  )
}

export default React.memo(AnimatedNumber)
