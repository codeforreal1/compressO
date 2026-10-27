import { core } from '@tauri-apps/api'
import { useEffect, useMemo, useState } from 'react'

import { logError } from '@/tauri/commands/app'
import {
  getWebImageDimensions,
  needsImagePreview,
  prepareImagePreview,
} from '@/tauri/commands/image'

/** Try the original in this WebView; decode a PNG only when it cannot render it. */
export function useImagePreview(
  path: string | null | undefined,
  revision?: unknown,
  placeholderSrc?: string | null,
) {
  const [preview, setPreview] = useState<{
    directSrc: string
    src: string
  }>()
  const directSrc = useMemo(
    () =>
      path && needsImagePreview(path)
        ? `${core.convertFileSrc(path)}?v=${revision == null ? 0 : Date.now()}`
        : undefined,
    [path, revision],
  )

  useEffect(() => {
    if (!path || !directSrc) return
    let current = true
    getWebImageDimensions(directSrc)
      .then(() => {
        if (current) setPreview({ directSrc, src: directSrc })
      })
      .catch(() =>
        prepareImagePreview(path)
          .then((decoded) => {
            if (current)
              setPreview({ directSrc, src: core.convertFileSrc(decoded) })
          })
          .catch((error) => logError('Could not prepare image preview', error)),
      )
    return () => {
      current = false
    }
  }, [path, directSrc])
  if (!directSrc) return undefined
  return preview && preview.directSrc === directSrc
    ? preview.src
    : (placeholderSrc ?? undefined)
}
