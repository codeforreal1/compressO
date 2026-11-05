import { useEffect } from 'react'

import { readFilesFromClipboard } from '@/tauri/commands/fs'
import { CollectedFile } from '@/types/fs'
import { withTimeout } from '@/utils/promise'
import { canAddMedia } from '../-media'
import { appProxy } from '../-state'

/** Large pasted files are written to disk first, which can take a while */
const CLIPBOARD_READ_TIMEOUT = 120_000

type ReadFilesFromClipboardProps = {
  onFiles: (files: CollectedFile[]) => void | Promise<void>
}

function ReadFilesFromClipboard({ onFiles }: ReadFilesFromClipboardProps) {
  useEffect(() => {
    async function handleReadFilesFromClipboard(event: ClipboardEvent) {
      // Pasting into a text field is just text; completed queues keep their outputs.
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        !canAddMedia()
      ) {
        return
      }

      // Keep a running queue open while clipboard files are being written to disk.
      const selectionState = appProxy.state
      selectionState.isLoadingMediaFiles = true
      selectionState.isAppendingMedia = selectionState.media.length > 0
      try {
        const files = await withTimeout(
          readFilesFromClipboard(),
          CLIPBOARD_READ_TIMEOUT,
        )
        if (appProxy.state !== selectionState) return
        selectionState.isLoadingMediaFiles = false
        if (Array.isArray(files)) {
          await onFiles?.(files)
        }
      } catch {
        // ignore
      } finally {
        if (appProxy.state === selectionState) {
          selectionState.isLoadingMediaFiles = false
          selectionState.isAppendingMedia = false
        }
      }
    }

    window.addEventListener('paste', handleReadFilesFromClipboard)

    return () => {
      window.removeEventListener('paste', handleReadFilesFromClipboard)
    }
  }, [onFiles])

  return null
}

export default ReadFilesFromClipboard
