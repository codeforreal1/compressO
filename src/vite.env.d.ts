/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

declare global {
  interface Window {
    __appVersion: string
  }
}

export {}
