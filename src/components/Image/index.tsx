'use client'

import React from 'react'
import {
  Image as NextUIImage,
  type ImageProps as NextUIImageProps,
} from '@nextui-org/image'

// This Image component is client side only so it only makes sense to use it for remote images.
// Use this Image component for images with string URL. For static images, use Next's built in image component

interface ImageProps {
  src: string
  alt: string
}

function Image(props: ImageProps & Exclude<NextUIImageProps, 'src'>) {
  const { ...nextImageProps } = props
  return <NextUIImage {...nextImageProps} />
}

export default Image
