import prettyBytes from 'pretty-bytes'
import { proxy, snapshot } from 'valtio'
import { Platform, platform } from '@tauri-apps/plugin-os'

/**
 * Formats bytes to appropriate human readable format like KB, MB, GB, etc
 * @param {number} bytes: Bytes to format
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return ''
  return prettyBytes(bytes)
}

const platformProxy = proxy<{ platform: Promise<Platform | null> }>({
  platform: new Promise((resolve) => {
    platform?.()
      .then((val) => resolve(val))
      .catch(() => resolve(null))
  }),
})
/**
 * Current platform
 * @returns {string}: 'linux', 'macos', 'ios', 'freebsd', 'dragonfly', 'netbsd', 'openbsd', 'solaris', 'android', 'windows'. Returns null for unsupported platform.
 */
export function getPlatform() {
  const platform_name = snapshot(platformProxy).platform
  return {
    name: platform_name,
    isWindows: platform_name === 'windows',
    isMacOS: platform_name === 'macos',
    isLinux: platform_name === 'linux',
  }
}
