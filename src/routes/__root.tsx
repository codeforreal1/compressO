import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import * as React from 'react'

import { Toaster } from '@/components/Toast'
import UIProvider from '../providers/UIProvider'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <UIProvider>
        <Outlet />
      </UIProvider>
      <Toaster />
      <TanStackRouterDevtools position="bottom-right" />
    </>
  )
}
