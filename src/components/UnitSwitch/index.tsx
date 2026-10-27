import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import React from 'react'

/**
 * The switch: to the larger unit, the new one comes up from below as the old one goes up; back to
 * the smaller unit, the other way (`custom` is whether the larger unit is now shown)
 */
const unitVariants = {
  enter: (isLarger: boolean) => ({ y: isLarger ? 12 : -12, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (isLarger: boolean) => ({ y: isLarger ? -12 : 12, opacity: 0 }),
}

type UnitSwitchProps = Omit<
  React.ComponentProps<'button'>,
  'onClick' | 'children'
> & {
  /** The smaller & the larger unit, e.g. `['MB', 'GB']` */
  units: readonly [string, string]
  /** Whether the larger unit is shown */
  isLarger: boolean
  onToggle: () => void
}

/**
 * A unit shown beside a number (e.g. in a `StepperInput`) that switches to the other unit when
 * clicked, sliding between them
 */
const UnitSwitch = React.forwardRef<HTMLButtonElement, UnitSwitchProps>(
  (props, ref) => {
    const { units, isLarger, onToggle, ...rest } = props
    const reduceMotion = useReducedMotion()
    const unit = isLarger ? units[1] : units[0]

    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        className="relative inline-grid h-4 overflow-hidden rounded px-0.5 transition-colors hover:text-zinc-900 disabled:pointer-events-none dark:hover:text-white"
        {...rest}
      >
        <AnimatePresence initial={false} mode="popLayout" custom={isLarger}>
          <motion.span
            key={unit}
            className="col-start-1 row-start-1 leading-4"
            custom={isLarger}
            variants={unitVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 420, damping: 32 }
            }
          >
            {unit}
          </motion.span>
        </AnimatePresence>
      </button>
    )
  },
)

UnitSwitch.displayName = 'UnitSwitch'

export default UnitSwitch
