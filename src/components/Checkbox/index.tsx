import {
  Checkbox as NextUICheckbox,
  type CheckboxProps as NextUICheckboxProps,
} from '@heroui/checkbox'
import React from 'react'

interface CheckboxProps extends NextUICheckboxProps {}

function Checkbox(props: CheckboxProps) {
  return <NextUICheckbox size="sm" {...props} />
}

export default Checkbox
