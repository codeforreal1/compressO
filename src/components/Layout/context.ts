import React from 'react'

export const LayoutContext = React.createContext<{
  isValid: boolean
}>({
  isValid: false,
})
LayoutContext.displayName = 'LayoutContext'
