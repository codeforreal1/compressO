import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import eslint from 'vite-plugin-eslint'
import svgr from 'vite-plugin-svgr'
import packageJSON from './package.json'

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routeFileIgnorePattern: '(^[A-Z].*)',
    }),
    react(),
    svgr(),
    eslint(),
  ],
  resolve: {
    alias: {
      '@': resolve('./src'),
    },
  },
  define: {
    __appVersion: JSON.stringify(packageJSON.version),
  },
})
