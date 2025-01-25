import {
  Spinner as NextUISpinner,
  type SpinnerProps as NextUISpinnerProps,
} from '@heroui/spinner'

interface SpinnerPros extends NextUISpinnerProps {}

function Spinner(props: SpinnerPros) {
  return <NextUISpinner {...props} />
}

export default Spinner
