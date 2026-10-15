import { useRef } from 'react'

import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { cn } from '@/utils/tailwind'

type DisabledReasonProps = {
  /** Why the control beside it cannot be used; nothing is shown without one */
  reason?: string | null | false
  className?: string
}

/**
 * An info icon beside a control that is disabled for a reason (e.g. a switch that needs another
 * setting), telling why on hover. Its space is always kept & it fades in, so the control does not
 * move when it is disabled.
 */
function DisabledReason({ reason, className }: DisabledReasonProps) {
  // The last reason stays while the icon fades out
  const lastReason = useRef(reason)
  if (reason) lastReason.current = reason
  const shownReason = lastReason.current

  return (
    <span
      className={cn(
        // Centered beside the control; `leading-none` keeps the icon off the text baseline
        'inline-flex items-center justify-center w-5 h-5 leading-none flex-shrink-0 transition-opacity duration-200',
        reason ? 'opacity-100' : 'opacity-0 pointer-events-none',
        className,
      )}
      aria-hidden={!reason}
    >
      {shownReason ? (
        <Tooltip
          content={shownReason}
          isDisabled={!reason}
          delay={150}
          closeDelay={0}
          className="max-w-64"
        >
          <span
            // Focusable, so the reason can also be read with the keyboard
            tabIndex={reason ? 0 : -1}
            aria-label={shownReason}
            className="flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 outline-none"
          >
            <Icon name="info" size={20} className="text-warning-300" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
}

export default DisabledReason
