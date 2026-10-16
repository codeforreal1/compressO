import { createFileRoute } from '@tanstack/react-router'
import { event } from '@tauri-apps/api'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import InfoTooltip from '@/components/InfoTooltip'
import ScrollShadow from '@/components/ScrollShadow'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import { isAutoCompressAvailable } from '@/hooks/useAutoCompressSync'
import { useDropQueue } from '@/hooks/useDropQueue'
import { settingsStore } from '@/stores/settingsStore'
import {
  COMPRESSION_STATUS_EVENT,
  type CompressionStatus,
  getCompressionStatus,
} from '@/tauri/commands/compression'
import type { DropQueueItem } from '@/tauri/commands/dropQueue'
import {
  addDroppedFiles,
  clearDroppedFiles,
  closeTrayPopover,
  DROPPED_FILES_EVENT,
  focusMainWindow,
  getDroppedFiles,
  pasteDroppedFiles,
  quitApp,
  removeDroppedFile,
  setSupportedDropExtensions,
  setTrayPopoverPinned,
} from '@/tauri/commands/tray'
import { inputExtensions } from '@/types/compression'
import DropQueueList from '@/ui/DropQueueList'
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

/**
 * Pasting (⌘V) in the popover adds the copied media, like dropping it: for those who do not watch
 * the clipboard (Settings -> Drop Zone)
 */
function usePasteFiles() {
  useEffect(() => {
    const handlePaste = async () => {
      try {
        const skippedCount = await pasteDroppedFiles()
        if (skippedCount > 0) {
          toast.error('Unsupported files were skipped.', {
            classNames: { toast: 'scale-[0.75]' },
          })
        }
      } catch {
        // Nothing to add, e.g. copied text
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])
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

function TrayWindow() {
  const status = useCompressionStatus()
  const [isPinned, setIsPinned] = useState(false)
  // With "Compress automatically", dropped media is queued instead (Settings -> Drop Zone), also
  // while the main window is busy
  const { autoCompress, saveLocation, saveFolder } = useSnapshot(settingsStore)
  const isAutoCompressing =
    autoCompress && isAutoCompressAvailable({ saveLocation, saveFolder })
  const queueItems = useDropQueue()
  // The drop zone is separate from the main window, so media can always be dropped: queued, or
  // stored until the main window is free
  const isDragging = useFileDrop(true)
  usePasteFiles()
  const droppedFiles = useDroppedFiles()
  const isMainWindowBusy =
    status?.state === 'compressing' || !!status?.hasUnsavedOutput

  useEffect(() => {
    // Files dropped on the menu bar (also on the icon, handled by the backend) are checked against
    // the media that can be compressed
    setSupportedDropExtensions([
      ...inputExtensions.video,
      ...inputExtensions.image,
      ...inputExtensions.audio,
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
        {isAutoCompressing && queueItems.length > 0 ? (
          <DropQueue items={queueItems} isDragging={isDragging} />
        ) : droppedFiles.length > 0 ? (
          <DroppedFiles
            files={droppedFiles}
            isDragging={isDragging}
            isMainWindowBusy={isMainWindowBusy}
          />
        ) : (
          <DropZone
            isDragging={isDragging}
            isAutoCompressing={isAutoCompressing}
          />
        )}
      </div>
      <div className="flex items-center justify-around gap-2 px-6 pb-6">
        <Button
          size="sm"
          variant="bordered"
          radius="md"
          className="relative overflow-hidden gap-1 px-2 text-[10px] font-normal border-1"
          onPress={handleOpenMainWindow}
          fullWidth
          aria-label={
            status?.state === 'compressing'
              ? `Open App, ${status.isPaused ? 'paused' : 'compressing'} ${Math.round(status.progress)}%`
              : 'Open App'
          }
        >
          <MainWindowProgress status={status} />
          <Icon name="compresso" size={18} className="relative" />
          <span className="relative">Open App</span>
        </Button>
        <Button
          size="sm"
          variant="bordered"
          radius="md"
          className="gap-1 px-2 text-[10px] font-normal border-1"
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

/** Media can be dropped here (or on the menu bar icon), also while the main window is busy */
function DropZone({
  isDragging,
  isAutoCompressing,
}: {
  isDragging: boolean
  isAutoCompressing: boolean
}) {
  return (
    <div
      className={cn(
        'w-full flex-1 my-2 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition-colors',
        isDragging
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-black/15 dark:border-white/15 text-zinc-500 dark:text-zinc-400',
      )}
    >
      <Icon name="dropzone" size={50} className="text-primary" />
      <p className="text-[13px] text-center px-8 my-[-5px]">
        {isDragging
          ? 'Release to add the media'
          : isAutoCompressing
            ? 'Drop or paste media here to compress'
            : 'Drop or paste media here to store'}
      </p>
      <p className="text-[11px] text-center px-4 opacity-70">
        Videos, images, or folders...
      </p>
      {/* Settings -> Drop Zone, here too while nothing is dropped */}
      <div className="mt-1 flex flex-col items-start gap-1.5">
        <AutoCompressSwitch />
        <ClipboardWatchSwitch />
      </div>
    </div>
  )
}

/** The queue compressed automatically (see `-queue.ts`); more can be dropped */
function DropQueue({
  items,
  isDragging,
}: {
  items: readonly DropQueueItem[]
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
      <DropQueueList items={items} isCompact className="flex-1" />
      <p
        className={cn(
          'px-3 py-2 text-[11px] text-center',
          isDragging ? 'text-primary' : 'text-zinc-500 dark:text-zinc-400',
        )}
      >
        {isDragging ? 'Release to add the media' : ''}
      </p>
      <div className="flex justify-center pb-2">
        <ClipboardWatchSwitch />
      </div>
    </div>
  )
}

/**
 * Fills the "Open App" button from behind with the main window's progress, so it is visible that the
 * main window is busy: compressing (with a moving sheen), paused, or with compressed media not saved
 * yet (full). Nothing is shown while it is idle.
 */
function MainWindowProgress({ status }: { status: CompressionStatus | null }) {
  const isCompressing = status?.state === 'compressing'
  const isUnsaved = !isCompressing && !!status?.hasUnsavedOutput
  const isVisible = isCompressing || isUnsaved
  const isPaused = isCompressing && !!status?.isPaused
  const progress = isCompressing ? Math.max(4, status?.progress ?? 0) : 100

  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.span
            className={cn(
              'absolute inset-y-0 left-0 overflow-hidden transition-colors duration-300',
              isUnsaved
                ? 'bg-success/40'
                : isPaused
                  ? 'bg-zinc-500/40'
                  : 'bg-primary/45',
            )}
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          >
            {/* Bright edge where the fill ends */}
            <span
              className={cn(
                'absolute inset-y-0 right-0 w-px transition-colors duration-300',
                isUnsaved || progress >= 100
                  ? 'bg-transparent'
                  : isPaused
                    ? 'bg-zinc-400/60'
                    : 'bg-primary',
              )}
            />
            {isCompressing && !isPaused ? (
              <motion.span
                className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                initial={{ left: '-50%' }}
                animate={{ left: '100%' }}
                transition={{
                  duration: 1.6,
                  ease: 'easeInOut',
                  repeat: Number.POSITIVE_INFINITY,
                }}
              />
            ) : null}
          </motion.span>
        </motion.span>
      ) : null}
    </AnimatePresence>
  )
}

/** Media dropped so far, opened in the main window with "Open App"; more can be dropped */
function DroppedFiles({
  files,
  isDragging,
  isMainWindowBusy,
}: {
  files: string[]
  isDragging: boolean
  /** Compressing, or with unsaved media: the files open once it is free */
  isMainWindowBusy: boolean
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
          isIconOnly
          size="sm"
          variant="light"
          radius="md"
          className="h-6 min-w-0 pl-2 text-[11px] font-normal"
          aria-label="Discard all"
          onPress={() => {
            clearDroppedFiles().catch(() => {})
          }}
        >
          <Icon name="cross" size={14} />
        </Button>
      </div>
      <ScrollShadow
        as="ul"
        size={24}
        hideScrollBar
        className="flex-1 min-h-0 overflow-y-auto px-1.5"
      >
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
      </ScrollShadow>
      <p
        className={cn(
          'px-3 py-2 text-[11px] text-center',
          isDragging ? 'text-primary' : 'text-zinc-500 dark:text-zinc-400',
        )}
      >
        {isDragging
          ? 'Release to add the media'
          : isMainWindowBusy
            ? 'Stored. Open the app to compress them after the current media.'
            : 'Drop more media, or open the app to start compression.'}
      </p>
      <div className="flex justify-center pb-2">
        <ClipboardWatchSwitch />
      </div>
    </div>
  )
}

/** Switches compressing the dropped media automatically (Settings -> Drop Zone) */
function AutoCompressSwitch() {
  const { autoCompress, saveLocation, saveFolder } = useSnapshot(settingsStore)
  // Only with a save location, as nothing can ask where to save
  const canAutoCompress = isAutoCompressAvailable({ saveLocation, saveFolder })

  return (
    <div className="flex items-center gap-1.5">
      <Switch
        size="xs"
        isSelected={autoCompress && canAutoCompress}
        isDisabled={!canAutoCompress}
        onValueChange={(isSelected) => {
          settingsStore.autoCompress = isSelected
        }}
        classNames={{ label: 'text-[11px] text-zinc-500 dark:text-zinc-400' }}
      >
        Compress automatically
      </Switch>
      <InfoTooltip
        content={
          !canAutoCompress &&
          'Choose a save location in Settings, under Output, so the compressed media can be saved without asking.'
        }
      />
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
