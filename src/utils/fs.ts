import prettyBytes from 'pretty-bytes'

/**
 * Formats bytes to appropriate human readable format like KB, MB, GB, etc
 * @param {number} bytes: Bytes to format
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return ''
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
