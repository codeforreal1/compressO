import React from 'react'
import { Toaster as NativeToaster, toast } from 'sonner'
import { useTheme } from 'next-themes'

export function Toaster() {
  const { theme } = useTheme()
  return (
    <NativeToaster
      position="bottom-center"
      richColors
      theme={theme === 'dark' ? 'dark' : 'light'}
    />
  )
}

export { toast }
