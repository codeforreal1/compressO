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
      toastOptions={{
        classNames: {
          default: 'rounded-[3rem] px-4 py-2 w-fit',
        },
        duration: 3000,
      }}
    />
  )
}

export { toast }
