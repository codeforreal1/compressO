import {
  NumberInput as NextUINumberInput,
  type NumberInputProps as NextUINumberInputProps,
} from '@heroui/react'

interface NumberInputProps extends NextUINumberInputProps {}

function NumberInput(props: NumberInputProps) {
  return <NextUINumberInput size="sm" {...props} />
}

export default NumberInput
