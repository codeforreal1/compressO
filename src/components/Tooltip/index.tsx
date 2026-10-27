import {
  Tooltip as NextUITooltip,
  type TooltipProps as NextUITooltipProps,
} from '@heroui/react'

import { cn } from '@/utils/tailwind'

interface TooltipProps extends NextUITooltipProps {}
function Tooltip(props: TooltipProps) {
  return (
    <NextUITooltip
      delay={1000}
      showArrow
      size="sm"
      {...props}
      // Long text wraps instead of stretching across the window
      className={cn('max-w-64', props.className)}
    >
      <span>{props?.children}</span>
    </NextUITooltip>
  )
}

export default Tooltip
