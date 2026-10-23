import type React from 'react'
import { useRef } from 'react'

import Icon from '@/components/Icon'
import Tooltip from '@/components/Tooltip'
import { cn } from '@/utils/tailwind'

type InfoTooltipProps = {
  /**
   * Text shown on hover (e.g. why the control beside it is disabled); nothing is shown without one.
   * It can have links (e.g. a `SettingLink` to the setting to change), which stay reachable.
   */
  content?: React.ReactNode
  /** `warning` for something to fix (e.g. a setting that stops a feature from working) */
  variant?: 'info' | 'warning'
  className?: string
}

/**
 * An info icon beside a control, telling more about it on hover. Its space is always kept & it
 * fades in, so the control does not move when the icon appears.
 */
function InfoTooltip({
  content,
  variant = 'info',
  className,
}: InfoTooltipProps) {
  // The last text stays while the icon fades out
  const lastContent = useRef(content)
  if (content) lastContent.current = content
  const shownContent = lastContent.current

  return (
    <span
      className={cn(
        // Centered beside the control; `leading-none` keeps the icon off the text baseline
        'inline-flex items-center justify-center w-5 h-5 leading-none flex-shrink-0 transition-opacity duration-200',
        // Hoverable even inside a parent that is not (e.g. a field's label)
        content
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none',
        className,
      )}
      aria-hidden={!content}
    >
      {shownContent ? (
        <Tooltip
          // One block, so text with a link flows as one paragraph (the tooltip lays out its children
          // as a column)
          content={<div>{shownContent}</div>}
          isDisabled={!content}
          delay={150}
          // Text with links stays open long enough to move onto it (it stays open while hovered)
          closeDelay={typeof shownContent === 'string' ? 0 : 300}
        >
          <span
            // Focusable, so the text can also be read with the keyboard
            tabIndex={content ? 0 : -1}
            aria-label={
              typeof shownContent === 'string' ? shownContent : undefined
            }
            className="flex items-center justify-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 outline-none"
          >
            {variant === 'warning' ? (
              <Icon name="warning" size={18} className="text-warning-400" />
            ) : (
              <Icon name="info" size={18} className="text-warning-300" />
            )}
          </span>
        </Tooltip>
      ) : null}
    </span>
  )
}

export default InfoTooltip
