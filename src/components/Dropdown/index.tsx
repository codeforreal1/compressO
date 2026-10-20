import {
  Dropdown as NextUIDropdown,
  DropdownItem as NextUIDropdownItem,
  type DropdownItemProps as NextUIDropdownItemProps,
  DropdownMenu as NextUIDropdownMenu,
  type DropdownMenuProps as NextUIDropdownMenuProps,
  type DropdownProps as NextUIDropdownProps,
  DropdownTrigger as NextUIDropdownTrigger,
  type DropdownTriggerProps as NextUIDropdownTriggerProps,
} from '@heroui/react'

import { glassBorder, glassMenuItem, mergeClassNames } from '@/utils/glass'

interface DropdownProps extends NextUIDropdownProps {}
/** Its menu has a thin grey border (see `utils/glass.ts`) */
function Dropdown(props: DropdownProps) {
  return (
    <NextUIDropdown
      {...props}
      classNames={mergeClassNames({ content: glassBorder }, props.classNames)}
    />
  )
}

interface DropdownTriggerProps extends NextUIDropdownTriggerProps {}
export function DropdownTrigger(props: DropdownTriggerProps) {
  return <NextUIDropdownTrigger {...props} />
}

interface DropdownMenuProps extends NextUIDropdownMenuProps {}
/** Its options are only faintly highlighted (see `utils/glass.ts`) */
export function DropdownMenu(props: DropdownMenuProps) {
  return (
    <NextUIDropdownMenu
      {...props}
      itemClasses={mergeClassNames({ base: glassMenuItem }, props.itemClasses)}
    />
  )
}

interface DropdownItemProps extends NextUIDropdownItemProps {}
export function DropdownItem(props: DropdownItemProps) {
  return <NextUIDropdownItem {...props} />
}

export default Dropdown
