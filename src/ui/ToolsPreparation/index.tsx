import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Spinner from '@/components/Spinner'
import UIProvider from '@/providers/UIProvider'
import { getLogFilePath, logError } from '@/tauri/commands/app'
import { showItemInFileManager } from '@/tauri/commands/fs'

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
  const { t } = useTranslation()
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [logAccessError, setLogAccessError] = useState<string | null>(null)

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

  useEffect(() => {
    if (preparationWindow) {
      getCurrentWindow()
        .setTitle(t('toolPreparation.title'))
        .catch(() => {})
    }
  }, [t])

  if (status?.ready && !preparationWindow) return children
  // The main window remains hidden; only the separate preparation window shows progress.
  if (!preparationWindow) return null

  const error = connectionError || status?.error
  const progress =
    status?.phase === 'verifying'
      ? t('toolPreparation.verifying')
      : status?.phase === 'extracting'
        ? t('toolPreparation.extracting')
        : status?.phase === 'validating'
          ? t('toolPreparation.validating')
          : t('toolPreparation.checking')
  return (
    <UIProvider>
      <main className="flex h-screen flex-col items-center justify-center gap-5 px-8 text-center text-neutral-900 dark:text-neutral-100">
        <img src="/logo.png" width="48" height="48" alt="" />
        <h1 className="text-xl font-semibold">{t('toolPreparation.title')}</h1>
        {error ? (
          <>
            <p
              role="alert"
              className="max-h-24 overflow-auto text-sm text-red-600 dark:text-red-400"
            >
              {connectionError
                ? t('toolPreparation.statusUnavailable')
                : t('toolPreparation.failed')}
            </p>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onPress={() => {
                  setStatus(null)
                  setConnectionError(null)
                  setLogAccessError(null)
                  invoke('prepare_tools').catch((reason) =>
                    setConnectionError(String(reason)),
                  )
                }}
              >
                {t('toolPreparation.retry')}
              </Button>
              <Button
                size="sm"
                onPress={() => {
                  invoke('exit_tool_preparation').catch((reason) =>
                    setConnectionError(String(reason)),
                  )
                }}
              >
                {t('toolPreparation.exit')}
              </Button>
              <Button
                size="sm"
                onPress={async () => {
                  setLogAccessError(null)
                  try {
                    await showItemInFileManager(await getLogFilePath())
                  } catch (reason) {
                    logError('Could not show tool preparation logs', reason)
                    setLogAccessError(String(reason))
                  }
                }}
              >
                {t('toolPreparation.showLogs')}
              </Button>
            </div>
            {logAccessError ? (
              <p
                role="alert"
                className="max-h-12 overflow-auto text-xs text-red-600 dark:text-red-400"
              >
                {t('toolPreparation.logOpenFailed')}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <Spinner aria-label={t('toolPreparation.title')} />
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-neutral-600 dark:text-neutral-300"
            >
              {progress}
            </p>
            <p className="text-xs text-neutral-500">
              {t('toolPreparation.included')}
            </p>
          </>
        )}
      </main>
    </UIProvider>
  )
}
