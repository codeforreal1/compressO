import React from 'react'

import { LayoutContext } from './index'

interface FooterProps {
  children: React.ReactNode
}

function Footer(props: FooterProps) {
  const { children } = props

  const { isValid } = React.useContext(LayoutContext)

  if (!isValid) {
    throw new Error('`Layout.Header` must be used inside `Layout` component.')
  }

  return <div>{children}</div>
}

export default Footer
