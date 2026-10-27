import {
  ScrollShadow as NextUIScrollShadow,
  type ScrollShadowProps as NextUIScrollShadowProps,
} from '@heroui/react'
import React from 'react'

interface ScrollShadowProps extends NextUIScrollShadowProps {}

const ScrollShadow = React.forwardRef<HTMLDivElement, ScrollShadowProps>(
  (props, ref) => {
    return <NextUIScrollShadow ref={ref} {...props} />
  },
)

ScrollShadow.displayName = 'ScrollShadow'

export default ScrollShadow
