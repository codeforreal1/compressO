import {
  Slider as NextUISlider,
  type SliderProps as NextUISliderProps,
} from '@heroui/react'

import { cn } from '@/utils/tailwind'

interface SliderProps extends NextUISliderProps {}

// The first & last marks (siblings of the other marks)
const FIRST_MARK_INWARDS =
  '[&:not([data-slot=mark]+[data-slot=mark])]:translate-x-0'
const LAST_MARK_INWARDS = '[&:not(:has(+[data-slot=mark]))]:-translate-x-full'

function Slider({
  marks,
  classNames,
  minValue = 0,
  maxValue = 100,
  ...props
}: SliderProps) {
  const range = maxValue - minValue || 1
  const getPosition = (value: number | undefined) =>
    value == null ? 0.5 : (value - minValue) / range
  // Mark labels are centered on their value, so those at the ends (e.g. "Mute", "200%") are moved
  // inwards to stay inside the slider; the track keeps its width
  const isFirstMarkAtStart = getPosition(marks?.[0]?.value) <= 0.05
  const isLastMarkAtEnd = getPosition(marks?.[marks.length - 1]?.value) >= 0.95

  return (
    <NextUISlider
      size="sm"
      minValue={minValue}
      maxValue={maxValue}
      marks={marks}
      classNames={{
        ...classNames,
        mark: cn(
          isFirstMarkAtStart && FIRST_MARK_INWARDS,
          isLastMarkAtEnd && LAST_MARK_INWARDS,
          classNames?.mark,
        ),
      }}
      {...props}
    />
  )
}

export default Slider
