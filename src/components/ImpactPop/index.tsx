import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import React, { useEffect } from 'react'

import { cn } from '@/utils/tailwind'

type ImpactPopProps = {
  children: React.ReactNode
  /** Plays again whenever this changes (e.g. the value shown) */
  trigger: unknown
  /** In seconds, e.g. until a count lands */
  delay?: number
  isDisabled?: boolean
  className?: string
}

/**
 * Lands its content with a hit: it punches up & springs back, while a splash in the primary color
 * bursts out behind it & fades (like something thrown against a wall)
 */
function ImpactPop(props: ImpactPopProps) {
  const { children, trigger, delay = 0, isDisabled, className } = props
  const reduceMotion = useReducedMotion()
  const content = useAnimationControls()
  const splash = useAnimationControls()

  // biome-ignore lint/correctness/useExhaustiveDependencies: plays when `trigger` changes
  useEffect(() => {
    if (isDisabled || reduceMotion) return
    content.start({
      scale: [1, 1.28, 0.94, 1],
      transition: {
        delay,
        duration: 0.2,
        times: [0, 0.35, 0.7, 1],
        ease: 'easeOut',
      },
    })
    splash.start({
      scale: [0.4, 1.9],
      opacity: [0.45, 0],
      transition: { delay, duration: 0.2, ease: 'easeOut' },
    })
  }, [trigger, isDisabled, reduceMotion])

  return (
    <span className={cn('relative inline-block', className)}>
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto h-20 w-20 rounded-full bg-primary/40 blur-md"
        initial={{ opacity: 0, scale: 0.4 }}
        animate={splash}
      />
      <motion.span className="relative inline-block" animate={content}>
        {children}
      </motion.span>
    </span>
  )
}

export default ImpactPop
