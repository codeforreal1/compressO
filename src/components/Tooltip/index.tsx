import {
  Tooltip as NextUITooltip,
  type TooltipProps as NextUITooltipProps,
} from '@heroui/tooltip'

import { blurCSS, getBlurPseudoCSS } from '@/ui/BackdropBlur'
import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'

const { isWindows, isMacOS } = getPlatform()

const blurCSSBefore = getBlurPseudoCSS('before')

interface TooltipProps extends NextUITooltipProps {}
function Tooltip(props: TooltipProps) {
  return (
    <NextUITooltip
      delay={1000}
      showArrow
      size="sm"
      {...props}
      className={cn(isMacOS || isWindows ? blurCSS : '', props?.className)}
      classNames={{
        base: cn([
          isMacOS || isWindows ? blurCSSBefore : '',
          props?.classNames?.arrow ?? '',
        ]),
        ...(props?.classNames ?? {}),
      }}
    >
      <span>{props?.children}</span>
    </NextUITooltip>
  )
}

export default Tooltip
