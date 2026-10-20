import { motion, useReducedMotion } from 'framer-motion'
import React, { useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/utils/tailwind'

type SlidingPanelsProps = {
  /** The panels, side by side, from the left */
  panels: readonly React.ReactNode[]
  /** The panel shown */
  index: number
  className?: string
  /** E.g. room for what reaches a panel's edges (a slider's thumb), which would be cut off */
  panelClassName?: string
}

const SLIDE_TRANSITION = {
  type: 'spring',
  stiffness: 320,
  damping: 34,
  mass: 0.9,
} as const

/**
 * Panels side by side, sliding left & right to the one shown (e.g. under a `GlidingToggle`): the
 * next one comes in from the side it is on. The height glides to the shown panel's; the others
 * cannot be reached with the keyboard while hidden.
 */
function SlidingPanels({
  panels,
  index,
  className,
  panelClassName,
}: SlidingPanelsProps) {
  const reduceMotion = useReducedMotion()
  const panelRefs = useRef<(HTMLDivElement | null)[]>([])
  const [height, setHeight] = useState<number | null>(null)

  // Follows the shown panel's height (it changes, e.g. when a setting opens inside it)
  useLayoutEffect(() => {
    const panel = panelRefs.current[index]
    if (!panel) return
    const observer = new ResizeObserver(() => setHeight(panel.offsetHeight))
    observer.observe(panel)
    setHeight(panel.offsetHeight)
    return () => observer.disconnect()
  }, [index])

  return (
    <motion.div
      className={cn('[overflow-x:clip]', className)}
      initial={false}
      animate={height === null ? undefined : { height }}
      transition={reduceMotion ? { duration: 0 } : SLIDE_TRANSITION}
    >
      <motion.div
        className="flex items-start"
        initial={false}
        animate={{ x: `${-index * 100}%` }}
        transition={reduceMotion ? { duration: 0 } : SLIDE_TRANSITION}
      >
        {panels.map((panel, panelIndex) => (
          <div
            // Panels are fixed, so their position is their identity
            key={panelIndex}
            ref={(element) => {
              panelRefs.current[panelIndex] = element
            }}
            className={cn('w-full shrink-0', panelClassName)}
            aria-hidden={panelIndex !== index}
            // Hidden panels are out of the keyboard's reach
            {...(panelIndex !== index ? { inert: '' } : {})}
          >
            {panel}
          </div>
        ))}
      </motion.div>
    </motion.div>
  )
}

export default SlidingPanels
