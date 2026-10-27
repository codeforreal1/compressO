import {
  Popover as NextUIPopover,
  PopoverContent as NextUIPopoverContent,
  type PopoverProps as NextUIPopoverProps,
  PopoverTrigger as NextUIPopoverTrigger,
} from '@heroui/react'

import { glassBorder, mergeClassNames } from '@/utils/glass'

interface PopoverProps extends NextUIPopoverProps {}

/** Its content has a thin grey border (see `utils/glass.ts`) */
function Popover(props: PopoverProps) {
  return (
    <NextUIPopover
      {...props}
      classNames={mergeClassNames({ content: glassBorder }, props.classNames)}
    />
  )
}

export function PopoverContent(
  props: React.ComponentProps<typeof NextUIPopoverContent>,
) {
  return <NextUIPopoverContent {...props} />
}

export function PopoverTrigger(
  props: React.ComponentProps<typeof NextUIPopoverTrigger>,
) {
  return <NextUIPopoverTrigger {...props} />
}

export default Popover
