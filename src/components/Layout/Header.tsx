import React, { ComponentProps } from 'react'

import { LayoutContext } from './context'

function Header(props: ComponentProps<'div'>) {
  const { isValid } = React.useContext(LayoutContext)

  if (!isValid) {
    throw new Error('`Layout.Header` must be used inside `Layout` component.')
  }

  return <div {...(props ?? {})} />
}

export default Header
