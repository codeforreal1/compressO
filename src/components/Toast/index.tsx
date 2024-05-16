import React from 'react'
import { Toaster as NativeToaster, toast } from 'sonner'
import { useTheme } from 'next-themes'

export function Toaster() {
  const { theme } = useTheme()
  return (
    <NativeToaster richColors theme={theme === 'dark' ? 'dark' : 'light'} />
  )
}

export { toast }
