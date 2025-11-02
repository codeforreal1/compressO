import {
  Switch as NextUISwitch,
  type SwitchProps as NextUISwitchProps,
} from '@heroui/switch'

interface SwitchProps extends NextUISwitchProps {}

function Switch(props: SwitchProps) {
  return <NextUISwitch size="sm" {...props} />
}

export default Switch
