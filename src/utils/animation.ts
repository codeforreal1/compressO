import { Variants } from 'framer-motion'

export const defaultEntryExitTransition: Variants = {
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
