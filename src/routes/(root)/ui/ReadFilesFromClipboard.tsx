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
      // Pasting into a text field is just text, and media can't be added while compressing or
      // after compression
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable ||
        !canAddMedia()
      ) {
        return
      }

      // Large blob files from clipboard can take some time, so we need a blocking UI (only when
      // nothing is selected yet; otherwise the current media stays visible while adding)
      const isFirstSelection = appProxy.state.media.length === 0
      if (isFirstSelection) {
        appProxy.state.isLoadingMediaFiles = true
      }
      try {
        const files = await withTimeout(
          readFilesFromClipboard(),
          CLIPBOARD_READ_TIMEOUT,
        )
        if (Array.isArray(files)) {
          await onFiles?.(files)
        }
      } catch {
        // ignore
      } finally {
        if (isFirstSelection) {
          appProxy.state.isLoadingMediaFiles = false
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
