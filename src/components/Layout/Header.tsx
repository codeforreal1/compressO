import React from 'react'

import { LayoutContext } from './index'

interface HeaderProps {
  children: React.ReactNode
}

function Header(props: HeaderProps) {
  const { children } = props

  const { isValid } = React.useContext(LayoutContext)

  if (!isValid) {
    throw new Error('`Layout.Header` must be used inside `Layout` component.')
  }

  return <div>{children}</div>
}

export default Header
