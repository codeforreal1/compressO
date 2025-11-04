import { open } from '@tauri-apps/plugin-shell'
import React from 'react'

import { cn } from '@/utils/tailwind'

type LinkProps = {
  children: React.ReactNode
  href: string
  className?: string | string[] | undefined
}

function Link({ children, href, className }: LinkProps) {
  return (
    <button
      type="button"
      className={cn(['font-bold text-primary', className])}
      onClick={() => {
        open(href)
      }}
    >
      {children}
    </button>
  )
}

export default Link
