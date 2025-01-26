import { HeroUIProvider } from '@heroui/react'
import React from 'react'

function UIProvider({ children }: { children: React.ReactNode }) {
  return (
    // vaul-drawer-wrapper="" is required here for scaling effect for drawer effect. See @/components/Drawer
    <HeroUIProvider id="main" vaul-drawer-wrapper="" className="w-full h-full">
      {children}
    </HeroUIProvider>
  )
}

export default UIProvider
