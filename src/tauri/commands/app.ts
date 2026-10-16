import { core } from '@tauri-apps/api'

/**
 * Restarts the app, e.g. to apply a setting read when it starts. Asks first while media is being
 * compressed or not saved yet.
 */
export function restartApp() {
  return core.invoke<void>('restart_app')
}

/**
 * Whether the computer (and the screen) is kept awake while compressing (Settings -> General),
 * for the compressions started from now on
 */
export function setKeepAwakeSettings(
  preventSleep: boolean,
  keepDisplayOn: boolean,
) {
  return core.invoke<void>('set_keep_awake_settings', {
    preventSleep,
    keepDisplayOn,
  })
}
