import { Kbd } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'

import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'

const { isMacOS } = getPlatform()

/** ⌘+Shift+Enter on macOS, Ctrl+Shift+Enter elsewhere */
const COMMAND_ENTER_KEYS = isMacOS
  ? ['⌘', '⇧', '↵']
  : ['Ctrl', 'Shift', 'Enter']

export interface ShortcutHintProps {
  isVisible: boolean
  keys?: string[]
  className?: string
}

/** Keys of a keyboard shortcut, revealed inline (e.g. inside a button) while `isVisible` */
const ShortcutHint = React.forwardRef<HTMLSpanElement, ShortcutHintProps>(
  (props, ref) => {
    const { isVisible, keys = COMMAND_ENTER_KEYS, className } = props

    return (
      <AnimatePresence initial={false}>
        {isVisible ? (
          <motion.span
            ref={ref}
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            className={cn('inline-flex overflow-hidden', className)}
          >
            <Kbd
              classNames={{
                base: 'ml-1 gap-1 bg-black/15 text-current shadow-none dark:bg-white/15',
              }}
            >
              {keys.join(' ')}
            </Kbd>
          </motion.span>
        ) : null}
      </AnimatePresence>
    )
  },
)
ShortcutHint.displayName = 'ShortcutHint'

export default ShortcutHint
