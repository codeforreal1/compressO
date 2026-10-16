import { core } from '@tauri-apps/api'

/**
 * Restarts the app, e.g. to apply a setting read when it starts. Asks first while media is being
 * compressed or not saved yet.
 */
export function restartApp() {
  return core.invoke<void>('restart_app')
}
