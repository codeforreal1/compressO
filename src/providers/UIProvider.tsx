import React from 'react'
import { NextUIProvider } from '@nextui-org/react'

function UIProvider({ children }: { children: React.ReactNode }) {
  return (
    // vaul-drawer-wrapper="" is required here for scaling effect for drawer effect. See @/components/Drawer
    <NextUIProvider id="main" vaul-drawer-wrapper="" className="w-full h-full">
      {children}
    </NextUIProvider>
  )
}

export default UIProvider
