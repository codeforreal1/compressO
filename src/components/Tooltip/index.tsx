import React from 'react'
import {
  Tooltip as NextUITooltip,
  type TooltipProps as NextUITooltipProps,
} from '@nextui-org/tooltip'
import { blurCSS } from '@/ui/BackdropBlur'
import { cn } from '@/utils/tailwind'
import { getPlatform } from '@/utils/fs'

const { isWindows, isMacOS } = getPlatform()

interface TooltipProps extends NextUITooltipProps {}
function Tooltip(props: TooltipProps) {
  return (
    <NextUITooltip
      delay={1000}
      showArrow
      size="sm"
      {...props}
      className={cn(isMacOS || isWindows ? blurCSS : '', props?.className)}
    >
      <span>{props?.children}</span>
    </NextUITooltip>
  )
}

export default Tooltip
