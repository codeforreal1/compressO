'use client'

import React from 'react'
import Script from 'next/script'

import './globals.css'

import { Toaster } from '@/components/Toast'
import { combinedFonts } from '@/assets/fonts'
import UIProvider from '../providers/UIProvider'
import ThemeProvider from '../providers/ThemeProvider'
import Head from './head'

const version = process.env.version
const env = process.env.NODE_ENV

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <Head />
      <body className={`antialiased ${combinedFonts}`}>
        <ThemeProvider>
          <UIProvider>{children}</UIProvider>
          <Toaster />
        </ThemeProvider>
        <Script
          src={`/scripts/accessibility-only-when-focused.js?nonce=${version}`}
          data-env={env}
        />
        <Script
          src={`/scripts/disable-context-menu.js?nonce=${version}`}
          data-env={env}
        />
        <Script
          src={`/scripts/disable-zoom.js?nonce=${version}`}
          data-env={env}
        />
        <Script
          src={`/scripts/disable-reload.js?nonce=${version}`}
          data-env={env}
        />
        <div id="portal" />
      </body>
    </html>
  )
}
