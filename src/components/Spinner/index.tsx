import {
  Spinner as NextUISpinner,
  type SpinnerProps as NextUISpinnerProps,
} from "@nextui-org/spinner";

interface SpinnerPros extends NextUISpinnerProps {}

function Spinner(props: SpinnerPros) {
  return <NextUISpinner {...props} />;
}

export default Spinner;
