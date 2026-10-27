import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'

import { cn } from '@/utils/tailwind'

const easeOut = [0.4, 0, 0.2, 1] as const

type AnimatedLabelProps = {
  /**
   * Changing it crossfades to the new text, while the width moves smoothly to fit it. Empty, the
   * label shrinks away (e.g. an icon button growing into "Delete" to confirm)
   */
  children: string
  className?: string
  /** For the text, measured with it (e.g. `pl-1.5` to space it from an icon) */
  textClassName?: string
}

/**
 * Text that changes smoothly (e.g. a button's "Clear cache" -> "Clear now"): its width is animated
 * to the new text, so the button grows or shrinks without jumping, & the texts crossfade
 */
const AnimatedLabel = React.forwardRef<HTMLSpanElement, AnimatedLabelProps>(
  (props, ref) => {
    const { children, className, textClassName } = props
    const measureRef = React.useRef<HTMLSpanElement>(null)
    const [width, setWidth] = React.useState<number | null>(null)

    // Measured before paint, so the first frame already animates from the old width
    React.useLayoutEffect(() => {
      const measure = measureRef.current
      if (measure) setWidth(children ? measure.offsetWidth : 0)
    }, [children])

    return (
      <motion.span
        ref={ref}
        className={cn(
          'relative inline-flex overflow-hidden whitespace-nowrap',
          className,
        )}
        initial={false}
        animate={width == null ? undefined : { width }}
        transition={{ duration: 0.25, ease: easeOut }}
      >
        {/* The new text's width, never shown */}
        <span
          ref={measureRef}
          aria-hidden
          className={cn(
            'invisible absolute left-0 top-0 whitespace-nowrap',
            textClassName,
          )}
        >
          {children}
        </span>
        <AnimatePresence initial={false} mode="popLayout">
          {children ? (
            <motion.span
              key={children}
              className={cn('whitespace-nowrap', textClassName)}
              initial={{ opacity: 0, filter: 'blur(2px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: 'blur(2px)' }}
              transition={{ duration: 0.18 }}
            >
              {children}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.span>
    )
  },
)

AnimatedLabel.displayName = 'AnimatedLabel'

export default AnimatedLabel
