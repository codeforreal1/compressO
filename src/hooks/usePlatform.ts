// import { platform as getPlatform } from '@tauri-apps/plugin-os'

export function usePlatform() {
  const platform = 'linux'
  return {
    name: platform,
    isLinux: platform === 'linux',
    isMac: platform === 'macos',
    isWindows: platform === 'windows',
  }
}
