/* eslint-disable no-console */
import { createRouter, RouterProvider } from '@tanstack/react-router'
import ReactDOM from 'react-dom/client'
import './global.css'
// Before anything is rendered, so the first frame is in the right language
import './i18n'

import { routeTree } from './routeTree.gen'
import { getServerUrl } from './utils/video'

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

  // Starts Linux's video server, with video previews on (see `isVideoPreviewAvailable`)
  getServerUrl().catch(() => {})
}

const storedColor = localStorage.getItem('primaryColor')
if (storedColor) {
  document.documentElement.style.setProperty('--color-primary', storedColor)
}

// Apply the theme before the first render (`useTheme` only applies it in an effect, after the
// first paint), so the first frame shown when the window appears already matches it
document.documentElement.classList.toggle(
  'dark',
  localStorage.getItem('theme') !== 'light',
)

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<RouterProvider router={router} />)
}
