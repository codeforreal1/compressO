import {
  Slider as NextUISlider,
  type SliderProps as NextUISliderProps,
} from '@heroui/react'

interface SliderProps extends NextUISliderProps {}

function Slider(props: SliderProps) {
  return <NextUISlider size="sm" {...props} />
}

export default Slider
