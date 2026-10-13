import { createFileRoute } from '@tanstack/react-router'
import { event } from '@tauri-apps/api'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import { CircularProgress } from '@/components/Progress'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import { settingsStore } from '@/stores/settingsStore'
import {
  COMPRESSION_STATUS_EVENT,
  type CompressionStatus,
  getCompressionStatus,
} from '@/tauri/commands/compression'
import {
  addDroppedFiles,
  clearDroppedFiles,
  closeTrayPopover,
  DROPPED_FILES_EVENT,
  focusMainWindow,
  getDroppedFiles,
  quitApp,
  removeDroppedFile,
  setSupportedDropExtensions,
  setTrayPopoverPinned,
} from '@/tauri/commands/tray'
import { inputExtensions } from '@/types/compression'
import { cn } from '@/utils/tailwind'

export const Route = createFileRoute('/webviews/tray/')({
  component: TrayWindow,
})

/**
 * Files & folders dropped on the popover are collected (see `useDroppedFiles`), unless `isEnabled`
 * is off. Returns whether files are being dragged over the popover.
 */
function useFileDrop(isEnabled: boolean) {
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    let unlisten: event.UnlistenFn | undefined
    let isMounted = true
    ;(async () => {
      unlisten = await getCurrentWebview().onDragDropEvent(async (evt) => {
        const { type } = evt.payload
        if (type === 'enter' || type === 'over') {
          setIsDragging(true)
          return
        }
        setIsDragging(false)
        if (type !== 'drop' || !isEnabled) return
        try {
          const { paths } = evt.payload
          const skippedCount = await addDroppedFiles(paths)
          if (skippedCount > 0) {
            toast.error(
              skippedCount === paths.length
                ? 'This file type is not supported.'
                : 'Unsupported files were skipped.',
              { classNames: { toast: 'scale-[0.75]' } },
            )
          }
        } catch {
          toast.error('The media could not be added.')
        }
      })
      // Unmounted while the listener was being added
      if (!isMounted) unlisten()
    })()
    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [isEnabled])

  return isDragging
}

/** Files dropped on the menu bar (popover or icon), opened in the main window with "Open App" */
function useDroppedFiles() {
  const [files, setFiles] = useState<string[]>([])

  useEffect(() => {
    let unlisten: event.UnlistenFn | undefined
    let isMounted = true
    ;(async () => {
      unlisten = await event.listen<string[]>(DROPPED_FILES_EVENT, (evt) =>
        setFiles(evt.payload),
      )
      if (!isMounted) {
        unlisten()
        return
      }
      const currentFiles = await getDroppedFiles().catch(() => null)
      if (isMounted && currentFiles) setFiles(currentFiles)
    })()
    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [])

  return files
}

/** Name of a file or folder from its path */
function getName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

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
  const [isPinned, setIsPinned] = useState(false)
  // Not while compressing, nor with unsaved media (which the new media would replace)
  const canDropFiles =
    status?.state !== 'compressing' && !status?.hasUnsavedOutput
  const isDragging = useFileDrop(canDropFiles) && canDropFiles
  const droppedFiles = useDroppedFiles()

  useEffect(() => {
    // Files dropped on the menu bar (also on the icon, handled by the backend) are checked against
    // the media that can be compressed
    setSupportedDropExtensions([
      ...inputExtensions.video,
      ...inputExtensions.image,
    ]).catch(() => {})
  }, [])

  const togglePinned = async () => {
    const pinned = !isPinned
    try {
      await setTrayPopoverPinned(pinned)
      setIsPinned(pinned)
    } catch {}
  }

  const handleOpenMainWindow = async () => {
    try {
      await focusMainWindow()
      // Opening the app is done with the popover, so it is also unpinned
      if (isPinned) {
        await setTrayPopoverPinned(false)
        setIsPinned(false)
      }
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
    <div className="relative w-screen h-screen flex flex-col">
      {/* Pinned, the popover stays open when clicking outside it (e.g. to drag files from Finder) */}
      <Button
        isIconOnly
        size="sm"
        variant="light"
        radius="full"
        aria-label={isPinned ? 'Unpin' : 'Pin'}
        title={isPinned ? 'Unpin' : 'Pin'}
        className={cn(
          'absolute top-4 right-4 z-10 min-w-8 w-8 h-8',
          isPinned ? 'text-primary' : 'text-zinc-500 dark:text-zinc-400',
        )}
        onPress={togglePinned}
      >
        <Icon
          name={isPinned ? 'pinFilled' : 'pin'}
          size={22}
          className="rotate-[30deg]"
        />
      </Button>
      {/* Top padding clears the popover's arrow, which overlaps the content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pt-5 min-h-0">
        {canDropFiles && droppedFiles.length > 0 ? (
          <DroppedFiles files={droppedFiles} isDragging={isDragging} />
        ) : status?.state === 'compressing' ? (
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
            <p className="mt-3 text-[11px] text-center text-zinc-500 dark:text-zinc-400">
              {status.hasUnsavedOutput
                ? 'Save the compressed media to add new media.'
                : isDragging
                  ? 'Release to add the media.'
                  : ''}
            </p>
          </>
        ) : (
          <DropZone isDragging={isDragging} />
        )}
      </div>
      <div className="flex items-center justify-around gap-2 px-6 pb-6">
        <Button
          size="sm"
          variant="bordered"
          radius="md"
          className="gap-1 px-2 text-[10px] font-normal border-1"
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
          className="gap-1 px-2 text-[10px] font-normal border-1 text-red-400"
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

/** Shown when nothing is being compressed: media can be dropped here (or on the menu bar icon) */
function DropZone({ isDragging }: { isDragging: boolean }) {
  return (
    <div
      className={cn(
        'w-full flex-1 my-2 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-colors',
        isDragging
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-black/15 dark:border-white/15 text-zinc-500 dark:text-zinc-400',
      )}
    >
      <Icon name="dragAndDrop" size={36} />
      <p className="text-[13px] text-center px-4 my-[-5px]">
        {isDragging ? 'Release to add the media' : 'Drop media here to store'}
      </p>
      <p className="text-[11px] text-center px-4 opacity-70">
        Videos, images, or folders...
      </p>
      <div className="mt-1">
        <ClipboardWatchSwitch />
      </div>
    </div>
  )
}

/** Media dropped so far, opened in the main window with "Open App"; more can be dropped */
function DroppedFiles({
  files,
  isDragging,
}: {
  files: string[]
  isDragging: boolean
}) {
  return (
    <div
      className={cn(
        'w-full flex-1 my-2 flex flex-col min-h-0 rounded-2xl border-2 border-dashed transition-colors',
        isDragging
          ? 'border-primary bg-primary/10'
          : 'border-black/15 dark:border-white/15',
      )}
    >
      <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 pt-2 pb-1">
        <p className="text-xs font-semibold">
          {files.length} {files.length === 1 ? 'item' : 'items'} ready
        </p>
        <Button
          size="sm"
          variant="light"
          radius="md"
          className="h-6 min-w-0 px-2 text-[11px] font-normal text-danger"
          onPress={() => {
            clearDroppedFiles().catch(() => {})
          }}
        >
          Discard All
        </Button>
      </div>
      <ul className="flex-1 min-h-0 overflow-y-auto px-1.5">
        {files.map((path) => (
          <li
            key={path}
            className="group flex items-center gap-1 rounded-lg pl-1.5 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span className="flex-1 truncate text-xs" title={path}>
              {getName(path)}
            </span>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              radius="full"
              aria-label={`Remove ${getName(path)}`}
              className="min-w-6 w-6 h-6 text-zinc-500 dark:text-zinc-400"
              onPress={() => {
                removeDroppedFile(path).catch(() => {})
              }}
            >
              <Icon name="cross" size={12} />
            </Button>
          </li>
        ))}
      </ul>
      <p
        className={cn(
          'px-3 py-2 text-[11px] text-center',
          isDragging ? 'text-primary' : 'text-zinc-500 dark:text-zinc-400',
        )}
      >
        {isDragging
          ? 'Release to add the media'
          : 'Drop more media, or open the app to start compression.'}
      </p>
      <div className="flex justify-center pb-2">
        <ClipboardWatchSwitch />
      </div>
    </div>
  )
}

/** Switches watching the clipboard: copied media files are added to the drop zone */
function ClipboardWatchSwitch() {
  const { watchClipboard } = useSnapshot(settingsStore)

  return (
    <Switch
      size="xs"
      isSelected={watchClipboard}
      onValueChange={(isSelected) => {
        settingsStore.watchClipboard = isSelected
      }}
      classNames={{ label: 'text-[11px] text-zinc-500 dark:text-zinc-400' }}
    >
      Watch clipboard
    </Switch>
  )
}
