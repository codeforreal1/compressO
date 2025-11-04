/**
 * Current platform
 * @returns {string}: 'linux', 'macos', 'ios', 'freebsd', 'dragonfly', 'netbsd', 'openbsd', 'solaris', 'android', 'windows'. Returns null for unsupported platform.
 */
export function usePlatform() {
  const platform = window.navigator.userAgent.toLowerCase()
  return {
    name: platform,
    isLinux: platform.includes('linux'),
    isMac: platform.includes('mac'),
    isWindows: platform.includes('windows'),
  }
}
