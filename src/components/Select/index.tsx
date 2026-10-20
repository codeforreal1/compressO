import {
  Select as NextUISelect,
  SelectItem as NextUISelectItem,
  type SelectItemProps as NextUISelectItemProps,
  type SelectProps as NextUISelectProps,
} from '@heroui/react'

import {
  glassBorder,
  glassMenuItem,
  glassTrack,
  glassTrackHover,
  mergeClassNames,
} from '@/utils/glass'
import { cn } from '@/utils/tailwind'

interface SelectProps extends NextUISelectProps {}
/**
 * A field with a thin grey border, & a menu with one, its options only faintly highlighted (see
 * `utils/glass.ts`)
 */
function Select(props: SelectProps) {
  return (
    <NextUISelect
      radius="md"
      size="sm"
      labelPlacement="outside"
      {...props}
      classNames={mergeClassNames(
        {
          trigger: cn(glassTrack, glassTrackHover, 'shadow-none'),
          popoverContent: glassBorder,
        },
        props.classNames,
      )}
      listboxProps={{
        ...props.listboxProps,
        itemClasses: mergeClassNames(
          { base: glassMenuItem },
          props.listboxProps?.itemClasses,
        ),
      }}
    />
  )
}

interface SelectItemProps extends NextUISelectItemProps {}
export function SelectItem(props: SelectItemProps) {
  return <NextUISelectItem {...props} />
}

export default Select
