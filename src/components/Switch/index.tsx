import {
  Switch as NextUISwitch,
  type SwitchProps as NextUISwitchProps,
} from '@heroui/react'

interface SwitchProps extends NextUISwitchProps {}

function Switch(props: SwitchProps) {
  return (
    <NextUISwitch
      size="sm"
      classNames={{ wrapper: 'w-11 h-6', thumb: 'w-5 h-4' }}
      {...props}
    />
  )
}

export default Switch
