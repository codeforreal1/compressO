import { core } from '@tauri-apps/api'

import type { PresetMediaType, PresetOutput } from '@/types/preset'

/** A preset as the command line sees it (see `CliSettings`) */
export type CliPreset = {
  id: string
  name: string
  mediaType: PresetMediaType
  /** The default preset of its media type (starred in Settings -> Presets) */
  isDefault: boolean
  /** Where its outputs are saved: its own, or the Standard preset's */
  output: PresetOutput
  /** What it changes, in English, e.g. `["MP4", "Quality 70%"]` */
  summary: string[]
}

/**
 * The settings the command line (`compresso`) works with, sent to the backend (see
 * `cli_settings.rs`), which writes them where the command line reads them
 */
export type CliSettings = {
  schemaVersion: 1
  /** Every preset, the Standard preset of each media type first */
  presets: CliPreset[]
  defaultPresetIds: Record<PresetMediaType, string>
  /** Settings -> Output, by the names the command line uses */
  output: {
    skipLargerOutputs: boolean
    preserveFolderStructure: boolean
    replaceOriginalFiles: boolean
    useHardwareAcceleration: boolean
    reachTargetSizesWithoutAcceleration: boolean
  }
  /** The formats each media type is opened in */
  extensions: Record<PresetMediaType, string[]>
  /** The formats each media type can be saved in (a video also as audio) */
  outputExtensions: Record<PresetMediaType, string[]>
}

/**
 * Whether the command line started the app in the background (see `cli_server.rs`): true once, for
 * the first main window only, which then stays hidden
 */
export function takeBackgroundLaunch() {
  return core.invoke<boolean>('take_background_launch')
}

export function syncCliSettings(settings: CliSettings) {
  return core.invoke<void>('sync_cli_settings', { settings })
}

/** Whether the `compresso` command can be typed in a terminal (see `cli_install.rs`) */
export type CliInstallStatus = {
  /** `installed`, `notInstalled`, `broken` (pointing to a moved app), or `unavailable` */
  state: 'installed' | 'notInstalled' | 'broken' | 'unavailable'
  /** Where the command is (or would be) installed */
  path: string | null
  /** Whether the app can install or remove it (otherwise the installer does) */
  canInstall: boolean
}

export function getCliInstallStatus() {
  return core.invoke<CliInstallStatus>('get_cli_install_status')
}

export function installCli() {
  return core.invoke<CliInstallStatus>('install_cli')
}

export function uninstallCli() {
  return core.invoke<CliInstallStatus>('uninstall_cli')
}
