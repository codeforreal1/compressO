import prettyBytes from 'pretty-bytes'

const BINARY_SIZE_UNITS = [
  'B',
  'KB',
  'MB',
  'GB',
  'TB',
  'PB',
  'EB',
  'ZB',
  'YB',
] as const

/**
 * Formats bytes the way Windows Explorer (`StrFormatByteSize`) does: dividing by 1024, promoting
 * to the next KB/MB/GB unit at 1000, and keeping up to 3 digits truncated (e.g. `1,055,668,335`
 * bytes -> `0.98 GB`, `486,302,795` bytes -> `463 MB`).
 */
function formatWindowsBytes(bytes: number): string {
  if (bytes < 0) return `-${formatWindowsBytes(-bytes)}`
  if (bytes < 1000) return `${Math.round(bytes)} B`

  let value = bytes
  let unitIndex = 0
  while (value >= 1000 && unitIndex < BINARY_SIZE_UNITS.length - 1) {
    value /= 1024
    unitIndex++
  }

  const decimals = value < 10 ? 2 : value < 100 ? 1 : 0
  const factor = 10 ** decimals
  const truncated = Math.floor(value * factor + 1e-9) / factor
  return `${truncated} ${BINARY_SIZE_UNITS[unitIndex]}`
}

/**
 * Formats bytes to a human-readable size (KB, MB, GB, etc.). Windows Explorer divides by 1024
 * with KB/MB/GB labels, whereas macOS/Linux file managers use 1000.
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0'
  if (getPlatform().isWindows) {
    return formatWindowsBytes(bytes)
  }
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

/**
 * Whether two paths name the same file, whatever their separators (`/` or `\`) & letter case
 * (macOS & Windows ignore it)
 */
export function isSamePath(
  pathA: string | null | undefined,
  pathB: string | null | undefined,
) {
  if (!pathA || !pathB) return false
  const normalize = (path: string) => {
    const unified = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return getPlatform().isLinux ? unified : unified.toLowerCase()
  }
  return normalize(pathA) === normalize(pathB)
}
