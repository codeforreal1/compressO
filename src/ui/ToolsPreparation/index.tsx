import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type ReactNode, useEffect, useState } from 'react'

import Button from '@/components/Button'
import Spinner from '@/components/Spinner'
import UIProvider from '@/providers/UIProvider'

type ToolStatus = {
  phase: string
  message: string
  ready: boolean
  error: string | null
}

const preparationWindow = getCurrentWindow().label === 'preparation'

// Mount the router only after Rust has verified the tools. This also gates tray hooks,
// watched folders, encoder probing, and frontend-ready/open-with delivery.
export function ToolPreparation({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let timeout: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const next = await invoke<ToolStatus>('get_tool_status')
        if (stopped) return
        setStatus(next)
        setConnectionError(null)
        if (next.ready) {
          if (preparationWindow) await getCurrentWindow().close()
          return
        }
      } catch (error) {
        if (!stopped) setConnectionError(String(error))
      }
      if (!stopped) timeout = setTimeout(check, 250)
    }
    void check()
    return () => {
      stopped = true
      clearTimeout(timeout)
    }
  }, [])

  if (status?.ready && !preparationWindow) return children
  // The main window remains hidden; only the separate preparation window shows progress.
  if (!preparationWindow) return null

  const error = connectionError || status?.error
  return (
    <UIProvider>
      <main className="flex h-screen flex-col items-center justify-center gap-5 px-8 text-center text-neutral-900 dark:text-neutral-100">
        <img src="/logo.png" width="48" height="48" alt="" />
        <h1 className="text-xl font-semibold">Preparing CompressO</h1>
        {error ? (
          <>
            <p
              role="alert"
              className="max-h-24 overflow-auto text-sm text-red-600 dark:text-red-400"
            >
              {error}
            </p>
            <Button
              onPress={() => {
                setStatus(null)
                setConnectionError(null)
                invoke('prepare_tools').catch((reason) =>
                  setConnectionError(String(reason)),
                )
              }}
            >
              Retry
            </Button>
          </>
        ) : (
          <>
            <Spinner aria-label="Preparing compression tools" />
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-neutral-600 dark:text-neutral-300"
            >
              {status?.message || 'Checking compression tools…'}
            </p>
            <p className="text-xs text-neutral-500">
              Everything is included. No download is needed.
            </p>
          </>
        )}
      </main>
    </UIProvider>
  )
}
