import { blurCSS } from '@/ui/BackdropBlur'
import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'
import {
  Select as NextUISelect,
  SelectItem as NextUISelectItem,
  type SelectItemProps as NextUISelectItemProps,
  type SelectProps as NextUISelectProps,
} from '@heroui/select'
import React from 'react'

const { isWindows, isMacOS } = getPlatform()

interface SelectProps extends NextUISelectProps {}
function Select(props: SelectProps) {
  return (
    <NextUISelect
      radius="sm"
      size="sm"
      labelPlacement="outside"
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
