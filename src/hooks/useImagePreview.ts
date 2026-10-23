import { core } from '@tauri-apps/api'
import { useEffect, useState } from 'react'

import { logError } from '@/tauri/commands/app'
import { needsImagePreview, prepareImagePreview } from '@/tauri/commands/image'

/** The full output is still saved/copied; only its displayed representation is decoded. */
export function useImagePreview(
  path: string | null | undefined,
  revision?: unknown,
) {
  const [preview, setPreview] = useState<{
    input: string
    src: string
    revision: unknown
  }>()
  useEffect(() => {
    if (!path || !needsImagePreview(path)) return
    let current = true
    prepareImagePreview(path)
      .then((decoded) => {
        if (current)
          setPreview({
            input: path,
            src: core.convertFileSrc(decoded),
            revision,
          })
      })
      .catch((error) => logError('Could not prepare image preview', error))
    return () => {
      current = false
    }
  }, [path, revision])
  return preview && preview.input === path && preview.revision === revision
    ? preview.src
    : undefined
}
