import { proxy } from 'valtio'

import { toast } from '@/components/Toast'
import { checkUpdate, downloadAndInstallUpdate } from '@/tauri/commands/updater'

export type UpdateState = {
  isUpdateAvailable: boolean
  currentVersion: string
  latestVersion: string | null
  body: string | null
  date: string | null
  isChecking: boolean
  isInstalling: boolean
  installProgress: number
  hasChecked: boolean
}

export const updateStore = proxy<UpdateState>({
  isUpdateAvailable: false,
  currentVersion: '',
  latestVersion: null,
  body: null,
  date: null,
  isChecking: false,
  isInstalling: false,
  installProgress: 0,
  hasChecked: false,
})

export async function checkForUpdates() {
  if (updateStore.isChecking || updateStore.isInstalling) return

  updateStore.isChecking = true

  try {
    const info = await checkUpdate()
    updateStore.isUpdateAvailable = info.isUpdateAvailable
    updateStore.currentVersion = info.currentVersion
    updateStore.latestVersion = info.latestVersion
    updateStore.body = info.body
    updateStore.date = info.date
    updateStore.hasChecked = true
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: <>
    console.error('Failed to check for updates:', error)
  } finally {
    updateStore.isChecking = false
  }
}

export async function downloadAndInstallUpdateApp() {
  if (updateStore.isInstalling) return

  updateStore.isInstalling = true
  updateStore.installProgress = 0

  try {
    await downloadAndInstallUpdate()
    toast.success('更新安装成功。请重启应用以使用新版本。')
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: <>
    console.error('Failed to install update:', error)
    toast.error('更新安装失败，请重试。')
  } finally {
    setTimeout(() => {
      updateStore.isUpdateAvailable = false
      updateStore.isInstalling = false
    }, 2000)
  }
}

export function setupUpdateListeners() {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen('update-event', (event) => {
      const payload = event.payload

      if (typeof payload === 'string') {
        const progressNum = Number.parseInt(payload, 10)
        if (!Number.isNaN(progressNum)) {
          updateStore.installProgress = progressNum
        }
      }
    })

    listen('update-error', (event) => {
      toast.error(`更新错误：${event.payload}`)
      updateStore.isInstalling = false
    })
  })
}
