import React from 'react'
import {
  Checkbox as NextUICheckbox,
  type CheckboxProps as NextUICheckboxProps,
} from '@heroui/checkbox'

interface CheckboxProps extends NextUICheckboxProps {}

function Checkbox(props: CheckboxProps) {
  return <NextUICheckbox {...props} />
}

export default Checkbox
