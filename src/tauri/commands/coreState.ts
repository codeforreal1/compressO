import { core } from '@tauri-apps/api'

import type { SaveLocation, WatchedFolder } from '@/stores/settingsStore'
import type { Preset, PresetMediaType } from '@/types/preset'

export type DomainSettings = {
  outputFileNameTemplate: string
  saveLocation: SaveLocation
  saveFolder: string | null
  preserveFolderStructure: boolean
  saveLargerOutputs: boolean
  replaceOriginalFiles: boolean
  copyOutputToClipboard: boolean
  copyBatchOutputToClipboard: boolean
  showMenuBarIcon: boolean
  watchClipboard: boolean
  playCompletionSound: boolean
  enableAudioWaveforms: boolean
  autoCompress: boolean
  dropZoneVideoPresetId: string
  dropZoneImagePresetId: string
  dropZoneAudioPresetId: string
  watchedFolders: WatchedFolder[]
  useHardwareAcceleration: boolean
  cpuThreadLimit: number | null
  retryTargetSizeOnCpu: boolean
  enableVideoPreviews: boolean
  preventSleepWhileCompressing: boolean
  keepScreenOnWhileCompressing: boolean
  openInMenuBarOnly: boolean
}

export type CorePresetsData = {
  schemaVersion: number
  presets: Preset[]
  defaultPresetIds: Record<PresetMediaType, string>
}

export type CoreMigrationResult = {
  settings: DomainSettings
  presets: CorePresetsData
  migratedSettings: boolean
  migratedPresets: boolean
}

export function migrateCoreState(
  settings: DomainSettings,
  presets: CorePresetsData,
) {
  return core.invoke<CoreMigrationResult>('migrate_core_state', {
    settings,
    presets,
  })
}

export function getCoreSettings() {
  return core.invoke<DomainSettings>('get_core_settings')
}

export function saveCoreSettings(settings: DomainSettings) {
  return core.invoke<DomainSettings>('save_core_settings', { settings })
}

export function getCorePresets() {
  return core.invoke<CorePresetsData>('get_core_presets')
}

export function saveCorePresets(presets: CorePresetsData) {
  return core.invoke<CorePresetsData>('save_core_presets', { presets })
}
