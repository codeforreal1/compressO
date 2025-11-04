import React from 'react'

import registry from './registry'

export interface IconProps {
  name: keyof typeof registry
  size?: number
  className?: string
}

function Icon(props: IconProps & React.SVGProps<SVGElement>) {
  const { name, size = 20, className } = props

  const SVGComponent = registry[name]

  if (SVGComponent == null) {
    // biome-ignore lint/suspicious/noConsole: <>
    console.warn(`No such icon named ${name}`)
    return null
  }

  return (
    <SVGComponent
      className={className}
      style={{ width: `${size / 20}rem`, height: `${size / 20}rem` }}
    />
  )
}

export default Icon
