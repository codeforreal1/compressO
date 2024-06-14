import React from 'react'
import {
  Select as NextUISelect,
  SelectItem as NextUISelectItem,
  type SelectProps as NextUISelectProps,
  type SelectItemProps as NextUISelectItemProps,
} from '@nextui-org/select'
import { blurCSS } from '@/ui/BackdropBlur'
import { cn } from '@/utils/tailwind'
import { getPlatform } from '@/utils/fs'

const { isWindows, isMacOS } = getPlatform()

interface SelectProps extends NextUISelectProps {}
function Select(props: SelectProps) {
  return (
    <NextUISelect
      radius="lg"
      {...props}
      classNames={{
        popoverContent: cn([
          isWindows || isMacOS ? blurCSS : '',
          props?.classNames?.popoverContent ?? '',
        ]),
        ...(props?.classNames ?? {}),
      }}
    />
  )
}

interface SelectItemProps extends NextUISelectItemProps {}
export function SelectItem(props: SelectItemProps) {
  return <NextUISelectItem {...props} />
}

export default Select
