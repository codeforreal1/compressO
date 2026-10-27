import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import { useSystemThemeClass } from '@/hooks/useTheme'
import UIProvider from '@/providers/UIProvider'
import { getLogFilePath, logError } from '@/tauri/commands/app'
import { showItemInFileManager } from '@/tauri/commands/fs'
import { cn } from '@/utils/tailwind'

type ToolStatus = {
  phase: string
  message: string
  ready: boolean
  error: string | null
  /** How far the setup is, from 0 to 1 */
  progress: number
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
  if (!preparationWindow) return null

  return (
    <PreparationWindow
      status={status}
      connectionError={connectionError}
      logAccessError={logAccessError}
      onRetry={() => {
        setStatus(null)
        setConnectionError(null)
        setLogAccessError(null)
        invoke('prepare_tools').catch((reason) =>
          setConnectionError(String(reason)),
        )
      }}
      onExit={() => {
        invoke('exit_tool_preparation').catch((reason) =>
          setConnectionError(String(reason)),
        )
      }}
      onShowLogs={async () => {
        setLogAccessError(null)
        try {
          await showItemInFileManager(await getLogFilePath())
        } catch (reason) {
          logError('Could not show tool preparation logs', reason)
          setLogAccessError(String(reason))
        }
      }}
    />
  )
}

const RING_SIZE = 136
const RING_STROKE = 5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

type PreparationWindowProps = {
  status: ToolStatus | null
  connectionError: string | null
  logAccessError: string | null
  onRetry: () => void
  onExit: () => void
  onShowLogs: () => void
}

/**
 * The first-time setup: the app's icon in a ring filling with its progress, & what it is doing.
 * On a failure the ring stops & turns red, with a way to try again.
 */
function PreparationWindow({
  status,
  connectionError,
  logAccessError,
  onRetry,
  onExit,
  onShowLogs,
}: PreparationWindowProps) {
  const { t } = useTranslation()
  useSystemThemeClass()
  const reduceMotion = useReducedMotion()

  const error = connectionError || status?.error
  const progress = Math.min(Math.max(status?.progress ?? 0, 0), 1)
  const step =
    status?.phase === 'verifying'
      ? t('toolPreparation.verifying')
      : status?.phase === 'extracting'
        ? t('toolPreparation.extracting')
        : status?.phase === 'validating'
          ? t('toolPreparation.validating')
          : t('toolPreparation.checking')

  return (
    <UIProvider>
      {/* Dragged by its background, as its title bar blends into it (macOS) */}
      <main
        data-tauri-drag-region
        className="flex h-screen flex-col items-center justify-center px-8 text-center text-zinc-900 dark:text-zinc-100"
      >
        <h1 className="sr-only">{t('toolPreparation.title')}</h1>
        <div
          className="relative"
          style={{ width: RING_SIZE, height: RING_SIZE }}
          role="progressbar"
          aria-label={t('toolPreparation.title')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            className="-rotate-90"
            aria-hidden="true"
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              className="stroke-zinc-200 dark:stroke-white/10"
            />
            <motion.circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              className={cn(
                'transition-colors duration-300',
                error ? 'stroke-danger' : 'stroke-primary',
              )}
              initial={{ strokeDashoffset: RING_LENGTH }}
              animate={{ strokeDashoffset: RING_LENGTH * (1 - progress) }}
              // Eased, so the steps' updates read as one smooth fill
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.4, ease: 'easeOut' }
              }
            />
          </svg>
          <img
            src="/logo.png"
            alt=""
            className="pointer-events-none absolute inset-0 m-auto h-[92px] w-[92px] select-none"
            draggable={false}
          />
        </div>

        {error ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <p
              role="alert"
              className="max-h-20 overflow-auto text-sm text-danger"
            >
              {connectionError
                ? t('toolPreparation.statusUnavailable')
                : t('toolPreparation.failed')}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                color="primary"
                variant="solid"
                onPress={onRetry}
              >
                {t('toolPreparation.retry')}
              </Button>
              <Button size="sm" onPress={onExit}>
                {t('toolPreparation.exit')}
              </Button>
            </div>
            <Button
              size="sm"
              variant="light"
              className="h-6 min-w-0 px-2 text-xs text-zinc-500 dark:text-zinc-400"
              onPress={onShowLogs}
            >
              {t('toolPreparation.showLogs')}
            </Button>
            {logAccessError ? (
              <p role="alert" className="text-xs text-danger">
                {t('toolPreparation.logOpenFailed')}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <p className="mt-6 text-2xl tabular-nums">
              {Math.round(progress * 100)}%
            </p>
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={step}
                role="status"
                aria-live="polite"
                className="mt-1 text-sm text-zinc-600 dark:text-zinc-400"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {step}
              </motion.p>
            </AnimatePresence>
            <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-500">
              {t('toolPreparation.onlyOnce')}
            </p>
          </>
        )}
      </main>
    </UIProvider>
  )
}
