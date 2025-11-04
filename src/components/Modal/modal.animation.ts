import { Variants } from 'framer-motion'

export const zoomIn: Variants = {
  enter: {
    scale: 1,
    opacity: 1,
    transition: {
      type: 'spring',
      bounce: 0.3,
      duration: 0.5,
    },
  },
  exit: {
    scale: 0.8,
    opacity: 0,
    transition: {
      type: 'spring',
      bounce: 0.3,
      duration: 0.5,
    },
  },
}

export const bottomToTop: Variants = {
  enter: {
    y: 0,
    transition: {
      type: 'spring',
      bounce: 0,
      duration: 0.4,
    },
  },
  exit: {
    y: '100vh',
    transition: {
      type: 'spring',
      bounce: 0.2,
      duration: 0.5,
    },
  },
}
