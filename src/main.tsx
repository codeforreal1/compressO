/* eslint-disable no-console */
import { createRouter, RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'
import './global.css'

import { routeTree } from './routeTree.gen'

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// See `vite.config.ts` for all defined values.
if (typeof window !== 'undefined') {
  window.__appVersion = __appVersion
  window.__envMode = __envMode
}

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<RouterProvider router={router} />)
}
