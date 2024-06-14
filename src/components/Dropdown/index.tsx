import React from 'react'
import {
  Dropdown as NextUIDropdown,
  DropdownTrigger as NextUIDropdownTrigger,
  DropdownMenu as NextUIDropdownMenu,
  DropdownItem as NextUIDropdownItem,
  type DropdownProps as NextUIDropdownProps,
  type DropdownTriggerProps as NextUIDropdownTriggerProps,
  type DropdownMenuProps as NextUIDropdownMenuProps,
  type DropdownItemProps as NextUIDropdownItemProps,
} from '@nextui-org/dropdown'
import { cn } from '@/utils/tailwind'
import { blurCSS } from '@/ui/BackdropBlur'
import { getPlatform } from '@/utils/fs'

const { isWindows, isMacOS } = getPlatform()

interface DropdownProps extends NextUIDropdownProps {}
function Dropdown(props: DropdownProps) {
  return (
    <NextUIDropdown
      {...props}
      className={cn([isMacOS || isWindows ? blurCSS : '', props?.className])}
    />
  )
}

interface DropdownTriggerProps extends NextUIDropdownTriggerProps {}
export function DropdownTrigger(props: DropdownTriggerProps) {
  return <NextUIDropdownTrigger {...props} />
}

interface DropdownMenuProps extends NextUIDropdownMenuProps {}
export function DropdownMenu(props: DropdownMenuProps) {
  return <NextUIDropdownMenu {...props} />
}

interface DropdownItemProps extends NextUIDropdownItemProps {}
export function DropdownItem(props: DropdownItemProps) {
  return <NextUIDropdownItem {...props} />
}

export default Dropdown
