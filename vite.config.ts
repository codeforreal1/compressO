import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'

import packageJSON from './package.json'

export default defineConfig(({ mode }) => ({
  plugins: [
    TanStackRouterVite({
      routeFileIgnorePattern: '(^[A-Z].*)',
    }),
    react(),
    svgr(),
  ],
  resolve: {
    alias: {
      '@': resolve('./src'),
    },
  },
  // See `src/main.tsx` file to assign these defined values to window.
  define: {
    __appVersion: JSON.stringify(packageJSON.version),
    __envMode: JSON.stringify(mode),
  },
}))
