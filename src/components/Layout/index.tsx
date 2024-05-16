'use client'

import React from 'react'
import { ClassValue } from 'clsx'

import { cn } from '@/utils/tailwind'
import Header from './Header'
import Footer from './Footer'
import { LayoutContext } from './context'

interface LayoutProps {
  children: React.ReactNode
  containerClassName?: ClassValue
  className?: ClassValue
}

const Layout = (props: LayoutProps) => {
  const { children, containerClassName, className } = props

  const main: React.ReactNode[] = []
  const header: React.ReactNode[] = []
  const footer: React.ReactNode[] = []

  ;(function iife() {
    React.Children.forEach(children, (child) => {
      const _child = child as React.ReactNode & Record<'type', React.ReactNode>

      switch (_child.type) {
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
      <section className={cn(['w-full', containerClassName])}>
        {header}
        <div className={cn(['max-w-2xl mx-auto', className])}>{main}</div>
        {footer}
      </section>
    </LayoutContext.Provider>
  )
}

Layout.Header = Header
Layout.Footer = Footer

export default Layout
