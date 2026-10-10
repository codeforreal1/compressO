import prettyBytes from 'pretty-bytes'

/**
 * Formats bytes to appropriate human readable format like KB, MB, GB, etc
 * @param {number} bytes: Bytes to format
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0'
  return prettyBytes(bytes)
}

/**
 * Current platform
 * @returns {string}: 'linux', 'macos', 'ios', 'freebsd', 'dragonfly', 'netbsd', 'openbsd', 'solaris', 'android', 'windows'. Returns null for unsupported platform.
 */
export function getPlatform() {
  const userAgent =
    typeof window === 'object' ? window?.navigator?.userAgent : undefined
  return {
    isLinux: userAgent?.includes?.('Linux'),
    isMacOS: userAgent?.includes?.('Mac'),
    isWindows: userAgent?.includes?.('Win'),
  }
}

/**
 * Name to save a compressed file under: the original's name with the output's extension (outputs
 * themselves are stored under generated ids, e.g. `clip.mov` -> `clip.mp4`).
 */
export function getOutputFileName(
  originalFileName: string | null | undefined,
  originalExtension: string | null | undefined,
  outputExtension: string | null | undefined,
) {
  const baseName = originalExtension
    ? (originalFileName ?? '').slice(0, -(originalExtension.length + 1))
    : (originalFileName ?? '')
  return outputExtension ? `${baseName}.${outputExtension}` : baseName
}

/**
 * Parent directory of a path, `levels` folders up. Handles both `/` and `\` separators.
 */
export function getParentDirectory(path: string, levels = 1) {
  let directory = path.replace(/[\\/]+$/, '')
  for (let i = 0; i < levels; i++) {
    const index = Math.max(
      directory.lastIndexOf('/'),
      directory.lastIndexOf('\\'),
    )
    if (index < 0) return ''
    // Keep the root separator (e.g. `/file.mp4` -> `/`)
    directory = index === 0 ? directory.slice(0, 1) : directory.slice(0, index)
  }
  return directory
}
