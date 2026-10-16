import { useRef } from 'react'

import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { cn } from '@/utils/tailwind'

type InfoTooltipProps = {
  /** Text shown on hover (e.g. why the control beside it is disabled); nothing is shown without one */
  content?: string | null | false
  className?: string
}

/**
 * An info icon beside a control, telling more about it on hover. Its space is always kept & it
 * fades in, so the control does not move when the icon appears.
 */
function InfoTooltip({ content, className }: InfoTooltipProps) {
  // The last text stays while the icon fades out
  const lastContent = useRef(content)
  if (content) lastContent.current = content
  const shownContent = lastContent.current

  return (
    <span
      className={cn(
        // Centered beside the control; `leading-none` keeps the icon off the text baseline
        'inline-flex items-center justify-center w-5 h-5 leading-none flex-shrink-0 transition-opacity duration-200',
        content ? 'opacity-100' : 'opacity-0 pointer-events-none',
        className,
      )}
      aria-hidden={!content}
    >
      {shownContent ? (
        <Tooltip
          content={shownContent}
          isDisabled={!content}
          delay={150}
          closeDelay={0}
          className="max-w-64"
        >
          <span
            // Focusable, so the text can also be read with the keyboard
            tabIndex={content ? 0 : -1}
            aria-label={shownContent}
            className="flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 outline-none"
          >
            <Icon name="info" size={18} className="text-warning-300" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
}

export default InfoTooltip
