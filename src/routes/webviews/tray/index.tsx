import { createFileRoute } from '@tanstack/react-router'
import { event } from '@tauri-apps/api'
import { useEffect, useState } from 'react'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { CircularProgress } from '@/components/Progress'
import { toast } from '@/components/Toast'
import {
  COMPRESSION_STATUS_EVENT,
  type CompressionStatus,
  getCompressionStatus,
} from '@/tauri/commands/compression'
import {
  closeTrayPopover,
  focusMainWindow,
  quitApp,
} from '@/tauri/commands/tray'

export const Route = createFileRoute('/webviews/tray/')({
  component: TrayWindow,
})

/** The main window's compression status, kept up to date by the backend */
function useCompressionStatus() {
  const [status, setStatus] = useState<CompressionStatus | null>(null)

  useEffect(() => {
    let unlisten: event.UnlistenFn | undefined
    let isMounted = true
    ;(async () => {
      unlisten = await event.listen<CompressionStatus>(
        COMPRESSION_STATUS_EVENT,
        (evt) => setStatus(evt.payload),
      )
      // Unmounted while the listener was being added
      if (!isMounted) {
        unlisten()
        return
      }
      const currentStatus = await getCompressionStatus().catch(() => null)
      if (isMounted && currentStatus) {
        setStatus((latestStatus) => latestStatus ?? currentStatus)
      }
    })()
    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [])

  return status
}

/** What is being compressed: the file for a single media, only the count for a batch */
function getMediaLabel(status: CompressionStatus) {
  if (status.mediaCount === 1 && status.fileName) return status.fileName
  return `${status.mediaCount} ${status.mediaCount === 1 ? 'file' : 'files'}`
}

function TrayWindow() {
  const status = useCompressionStatus()

  const handleOpenMainWindow = async () => {
    try {
      await focusMainWindow()
      await closeTrayPopover()
    } catch {
      toast.error('CompressO could not be opened.')
    }
  }

  const handleQuitApp = async () => {
    try {
      await quitApp()
    } catch {
      toast.error('CompressO could not be quit.')
    }
  }

  return (
    <div className="w-screen h-screen flex flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 min-h-0">
        {status?.state === 'compressing' ? (
          <>
            <CircularProgress
              aria-label="Compression progress"
              value={status.progress}
              showValueLabel
              strokeWidth={3}
              classNames={{
                svg: 'w-20 h-20',
                indicator: 'stroke-primary',
                track: 'stroke-black/10 dark:stroke-white/10',
                value: 'text-base font-semibold',
              }}
            />
            <p className="w-full text-xs text-center truncate text-zinc-600 dark:text-zinc-300">
              Compressing...
            </p>
          </>
        ) : status?.state === 'completed' ? (
          <>
            <div className="w-20 h-20 flex items-center justify-center rounded-full bg-success/15 text-success">
              <Icon name="tick" size={44} />
            </div>
            <p className="text-sm font-semibold">Completed</p>
            <p className="w-full text-xs text-center truncate text-zinc-600 dark:text-zinc-300">
              {getMediaLabel(status)}
            </p>
          </>
        ) : (
          <p className="text-xs text-center text-zinc-500 dark:text-zinc-400">
            No compression in progress.
          </p>
        )}
      </div>
      <div className="flex items-center justify-around gap-2 px-6 py-6">
        <Button
          size="sm"
          variant="bordered"
          radius="md"
          className="gap-1.5 px-2 text-[11px] font-normal border-1"
          onPress={handleOpenMainWindow}
          fullWidth
        >
          <Icon name="openApp" size={20} />
          Open App
        </Button>
        <Button
          size="sm"
          variant="bordered"
          radius="md"
          className="gap-1.5 px-2 text-[11px] font-normal border-1 text-red-400"
          onPress={handleQuitApp}
          fullWidth
        >
          <Icon name="power" size={20} />
          Quit App
        </Button>
      </div>
    </div>
  )
}
