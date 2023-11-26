'use client'

import React from 'react'
import { NextUIProvider } from '@nextui-org/system'

function Provider({ children }: { children: React.ReactNode }) {
  return (
    <NextUIProvider>
      <main>{children}</main>
    </NextUIProvider>
  )
}

export default Provider
