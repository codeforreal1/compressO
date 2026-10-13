import {
  Switch as NextUISwitch,
  type SwitchProps as NextUISwitchProps,
} from '@heroui/react'

import { cn } from '@/utils/tailwind'

type SwitchSize = NonNullable<NextUISwitchProps['size']> | 'xs'

interface SwitchProps extends Omit<NextUISwitchProps, 'size'> {
  /** `xs` is a compact switch (e.g. for the menu bar popover); others are HeroUI's sizes */
  size?: SwitchSize
}

type SwitchClassNames = NonNullable<NextUISwitchProps['classNames']>

const sizeClassNames: Partial<Record<SwitchSize, SwitchClassNames>> = {
  sm: { wrapper: 'w-11 h-6', thumb: 'w-5 h-4' },
  // HeroUI has no `xs`: the `sm` switch is shrunk, including how far the thumb moves (the track's
  // inner width minus the thumb's)
  xs: {
    wrapper: 'w-9 h-[18px] px-[2px] me-1.5',
    thumb: cn(
      'w-4 h-3 group-data-[selected=true]:ms-3.5',
      // No widening while pressed, which would push the thumb past the track
      'group-data-[pressed=true]:w-3.5 group-data-[selected=true]:group-data-[pressed=true]:ms-3.5',
    ),
    label: 'text-tiny',
  },
}

function Switch(props: SwitchProps) {
  const { size = 'sm', classNames, ...switchProps } = props
  const sizeClasses = sizeClassNames[size] ?? {}

  // Merged per slot, so passed class names add to the size's instead of replacing them
  const mergedClassNames = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(sizeClasses),
        ...Object.keys(classNames ?? {}),
      ]),
    ].map((slot) => [
      slot,
      cn(
        sizeClasses[slot as keyof SwitchClassNames],
        classNames?.[slot as keyof SwitchClassNames],
      ),
    ]),
  ) as SwitchClassNames

  return (
    <NextUISwitch
      size={size === 'xs' ? 'sm' : size}
      classNames={mergedClassNames}
      {...switchProps}
    />
  )
}

export default Switch
