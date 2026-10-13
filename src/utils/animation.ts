import { Variants } from 'framer-motion'

export const zoomInTransition: Variants = {
  initial: { scale: 0.9, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: {
      duration: 0.6,
      bounce: 0.3,
      type: 'spring',
    },
  },
  exit: {
    scale: 0.9,
    opacity: 0,
    transition: {
      duration: 0.2,
      bounce: 0.2,
      type: 'spring',
    },
  },
} as const

const easeOut = [0.4, 0, 0.2, 1] as const

/**
 * Expands content that appears below a switch (e.g. the quality under Lossless Compression) and
 * collapses it again. The height is animated too, so the content below moves smoothly instead of
 * jumping when the space is added or removed. Spacing must be padding (`pt-*`), not a margin: a
 * margin is kept at 0 height. The overflow is hidden while animating only, so focus rings & slider
 * thumbs are not cut off.
 */
export const slideDownTransition: Variants = {
  initial: { height: 0, opacity: 0, y: -6, overflow: 'hidden' },
  animate: {
    height: 'auto',
    opacity: 1,
    y: 0,
    transition: {
      height: { duration: 0.25, ease: easeOut },
      opacity: { duration: 0.2, delay: 0.05 },
      y: { duration: 0.25, ease: easeOut },
    },
    transitionEnd: { overflow: 'visible' },
  },
  exit: {
    height: 0,
    opacity: 0,
    y: -6,
    overflow: 'hidden',
    transition: {
      height: { duration: 0.2, ease: easeOut },
      opacity: { duration: 0.12 },
      y: { duration: 0.2, ease: easeOut },
    },
  },
}

export const slideUpTransition: Variants = {
  initial: { y: 10, opacity: 0 },
  animate: {
    y: 0,
    opacity: 1,
    transition: {
      duration: 0.6,
      bounce: 0.3,
      type: 'spring',
    },
  },
  exit: {
    y: 10,
    opacity: 0,
    transition: {
      duration: 0.2,
      bounce: 0.2,
      type: 'spring',
    },
  },
} as const

export const zoomInStaggerAnimation: { container: Variants; item: Variants } = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  },
  item: {
    hidden: { opacity: 0, scale: 0.9 },
    show: { opacity: 1, scale: 1, transition: { bounce: 0.3, damping: 100 } },
    exit: { opacity: 0, scale: 0.9 },
  },
}

export const slideUpStaggerAnimation: {
  container: Variants
  item: Variants
} = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  },
  item: {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { bounce: 0.3, damping: 100 } },
    exit: { opacity: 0, y: 10 },
  },
}

export const slideDownStaggerAnimation: {
  container: Variants
  item: Variants
} = {
  container: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
      },
    },
  },
  item: {
    hidden: { opacity: 0, y: -10 },
    show: { opacity: 1, y: 0, transition: { bounce: 0.3, damping: 100 } },
    exit: { opacity: 0, y: -10 },
  },
}
