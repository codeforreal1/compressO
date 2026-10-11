import { createFileRoute } from '@tanstack/react-router'
import { event } from '@tauri-apps/api'
import { useEffect, useState } from 'react'

import Button from '@/components/Button'
import Image from '@/components/Image'
import Progress from '@/components/Progress'
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
    <div className="w-screen h-screen overflow-auto p-4 flex flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Image
          disableAnimation
          src="/logo.png"
          alt="logo"
          width={64}
          height={64}
        />
        <div className="text-center">
          <h2 className="text-lg font-bold text-primary">CompressO</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Version {window.__appVersion}
          </p>
        </div>
        {status?.state === 'compressing' ? (
          <div className="w-full mt-2">
            <div className="flex justify-between gap-2 text-xs mb-1">
              <span className="truncate">
                Compressing {getMediaLabel(status)}
              </span>
              <span className="tabular-nums">{status.progress}%</span>
            </div>
            <Progress
              aria-label="Compression progress"
              size="sm"
              value={status.progress}
              classNames={{ indicator: 'bg-primary' }}
            />
          </div>
        ) : status?.state === 'completed' ? (
          <p className="w-full mt-2 text-xs text-center truncate">
            Compression of {getMediaLabel(status)} is complete.
          </p>
        ) : null}
        <Button size="sm" className="mt-2" onPress={handleOpenMainWindow}>
          Open CompressO
        </Button>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="light"
          color="danger"
          onPress={handleQuitApp}
        >
          Quit CompressO
        </Button>
      </div>
    </div>
  )
}
