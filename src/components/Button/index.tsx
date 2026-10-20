import {
  Button as NextButton,
  type ButtonProps as NextButtonProps,
} from '@heroui/react'
import React from 'react'

import { glassSurface, glassSurfaceHover, glassTint } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

export interface ButtonProps extends NextButtonProps {
  color?: NextButtonProps['color']
  variant?: NextButtonProps['variant']
}

const Button = React.forwardRef(
  (props: ButtonProps, ref: NextButtonProps['ref']) => {
    const { color, variant, ...nextButtonProps } = props
    const buttonColor = color ?? 'default'
    const buttonVariant = variant ?? 'flat'
    // The frosted glass look (see `utils/glass.ts`): plain grey buttons are glass, & solid colored
    // ones get its finish over their color. Icon-like (light, ghost) & colored outlined or flat
    // buttons stay as they are.
    // A button with its own background (e.g. a dark circle over a thumbnail) keeps it: the glass's
    // gradient would be drawn over it
    const hasOwnBackground = /(^|\s|:)bg-/.test(
      String(nextButtonProps.className ?? ''),
    )
    const isGlass =
      !hasOwnBackground &&
      buttonColor === 'default' &&
      buttonVariant !== 'light' &&
      buttonVariant !== 'ghost'
    const isTinted =
      !hasOwnBackground &&
      buttonColor !== 'default' &&
      buttonVariant === 'solid'

    return (
      <NextButton
        ref={ref}
        disableRipple
        color={buttonColor}
        variant={buttonVariant}
        radius="md"
        {...nextButtonProps}
        className={cn([
          'font-medium',
          isGlass && [glassSurface, glassSurfaceHover, 'bg-transparent'],
          isTinted && glassTint,
          nextButtonProps.className,
        ])}
      />
    )
  },
)
Button.displayName = 'Button'

export default Button
