import { useEffect } from 'react'

import { readFilesFromClipboard } from '@/tauri/commands/fs'
import { CollectedFile } from '@/types/fs'
import { appProxy } from '../-state'

type ReadFilesFromClipboardProps = {
  onFiles: (files: CollectedFile[]) => void
}

function ReadFilesFromClipboard({ onFiles }: ReadFilesFromClipboardProps) {
  useEffect(() => {
    async function handleReadFilesFromClipboard() {
      // Large blob files from clipboard can take some time, so we need a blocking UI
      appProxy.state.isLoadingMediaFiles = true
      try {
        const files = await readFilesFromClipboard()
        if (Array.isArray(files)) {
          onFiles?.(files)
        }
      } catch {
        // ignore
      } finally {
        appProxy.state.isLoadingMediaFiles = false
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
