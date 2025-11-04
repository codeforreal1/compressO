'use client'

import React, { ComponentProps } from 'react'

import { cn } from '@/utils/tailwind'
import { LayoutContext } from './context'
import Footer from './Footer'
import Header from './Header'
import Image from '../Image'

interface LayoutProps {
  children: React.ReactNode
  containerProps?: ComponentProps<'section'>
  childrenProps?: ComponentProps<'div'>
  hideLogo?: boolean
}

const Layout = (props: LayoutProps) => {
  const { children, containerProps, childrenProps, hideLogo = false } = props

  const main: React.ReactNode[] = []
  const header: React.ReactNode[] = []
  const footer: React.ReactNode[] = []

  ;(function iife() {
    React.Children.forEach(children, (child) => {
      const _child = child as React.ReactNode & Record<'type', React.ReactNode>

      switch (_child?.type) {
        case Header: {
          header.push(child)
          break
        }
        case Footer: {
          footer.push(child)
          break
        }
        default: {
          main.push(child)
        }
      }
    })
  })()

  const value = React.useMemo(() => ({ isValid: true }), [])

  return (
    <LayoutContext.Provider value={value}>
      <section
        {...(containerProps ?? {})}
        className={cn([
          'w-full h-full flex flex-col overflow-y-auto dark:bg-black1 bg-white1',
          containerProps?.className ?? '',
        ])}
      >
        {!hideLogo ? (
          <div className="absolute top-4 left-4 flex justify-center items-center">
            <Image src="/logo.png" alt="logo" width={40} height={40} />
          </div>
        ) : null}
        {header}
        <div {...childrenProps}>{main}</div>
        {footer}
      </section>
    </LayoutContext.Provider>
  )
}

Layout.Header = Header
Layout.Footer = Footer

export default Layout
