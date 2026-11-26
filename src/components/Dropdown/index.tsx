import {
  Dropdown as NextUIDropdown,
  DropdownItem as NextUIDropdownItem,
  DropdownMenu as NextUIDropdownMenu,
  type DropdownMenuProps as NextUIDropdownMenuProps,
  type DropdownProps as NextUIDropdownProps,
  DropdownTrigger as NextUIDropdownTrigger,
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

export const DropdownTrigger = NextUIDropdownTrigger

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
// Preserve React Stately collection static method if Dropdown inspects DropdownMenu
if ('getCollectionNode' in NextUIDropdownMenu) {
  ;(
    DropdownMenu as typeof DropdownMenu & {
      getCollectionNode?: unknown
    }
  ).getCollectionNode = (
    NextUIDropdownMenu as unknown as { getCollectionNode?: unknown }
  ).getCollectionNode
}

// Re-export directly so React Stately's `DropdownItem.getCollectionNode` stays intact
export const DropdownItem = NextUIDropdownItem

export default Dropdown
