import {
  Switch as NextUISwitch,
  type SwitchProps as NextUISwitchProps,
} from '@heroui/switch'
import React from 'react'

interface SwitchProps extends NextUISwitchProps {}

function Switch(props: SwitchProps) {
  return <NextUISwitch size="sm" {...props} />
}

export default Switch
