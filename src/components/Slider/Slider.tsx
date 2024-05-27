import React from 'react'
import {
  Slider as NextUISlider,
  type SliderProps as NextUISliderProps,
} from '@nextui-org/slider'

interface SliderProps extends NextUISliderProps {}

function Slider(props: SliderProps) {
  return <NextUISlider {...props} />
}

export default Slider
