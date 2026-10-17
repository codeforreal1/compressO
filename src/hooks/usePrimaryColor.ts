import { useEffect } from 'react'
import { proxy, subscribe, useSnapshot } from 'valtio'

import * as constants from '@/constants'

export type PrimaryColorProxy = {
  color: string
  setColor: (newColor: string) => void
}

export const DEFAULT_PRIMARY_COLOR = '255 132 0' // rgb based

let persistedColor: string | null = localStorage.getItem(constants.primaryColor)

const primaryColorProxy: PrimaryColorProxy = proxy({
  color: persistedColor ?? DEFAULT_PRIMARY_COLOR,
  setColor(newColor) {
    primaryColorProxy.color = newColor
  },
})

function setPrimaryColorCSSVariables(color: string) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.style.setProperty('--color-primary', color)
}

if (typeof document !== 'undefined') {
  setPrimaryColorCSSVariables(primaryColorProxy.color)
}

// Changed in another window (e.g. the main window's settings, while the menu bar's popover stays
// open in the background): the storage is shared, so it is applied here too
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (evt) => {
    if (evt.storageArea !== localStorage) return
    if (evt.key !== constants.primaryColor) return
    const color = evt.newValue ?? DEFAULT_PRIMARY_COLOR
    primaryColorProxy.color = color
    setPrimaryColorCSSVariables(color)
  })
}

export function usePrimaryColor() {
  const snapshot = useSnapshot(primaryColorProxy)

  useEffect(() => {
    setPrimaryColorCSSVariables(snapshot.color)
  }, [snapshot.color])

  useEffect(() => {
    const unsubscribe = subscribe(primaryColorProxy, () => {
      localStorage.setItem(constants.primaryColor, primaryColorProxy.color)
    })
    return () => {
      unsubscribe()
    }
  }, [])

  return snapshot
}

/**
 * Calls `onChange` with the accent color now & whenever it changes, also from another window.
 * Returns a function that stops it.
 */
export function watchPrimaryColor(onChange: (color: string) => void) {
  onChange(primaryColorProxy.color)
  return subscribe(primaryColorProxy, () => onChange(primaryColorProxy.color))
}
