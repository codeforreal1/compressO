import React, { ComponentProps } from 'react'

import { LayoutContext } from './context'

function Footer(props: ComponentProps<'div'>) {
  const { isValid } = React.useContext(LayoutContext)

  if (!isValid) {
    throw new Error('`Layout.Footer` must be used inside `Layout` component.')
  }

  return <div {...(props ?? {})} />
}

export default Footer
