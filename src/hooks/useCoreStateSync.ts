import { event } from '@tauri-apps/api'
import isEqual from 'lodash/isEqual'
import { useEffect } from 'react'
import { snapshot, subscribe } from 'valtio'

import { PRESET_CONTRACTS_SCHEMA_VERSION } from '@/stores/presetMigration'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import { logError, logInfo } from '@/tauri/commands/app'
import {
  type CorePresetsData,
  type DomainSettings,
  migrateCoreState,
  saveCorePresets,
  saveCoreSettings,
} from '@/tauri/commands/coreState'
import { CustomEvents } from '@/types/compression'

const DOMAIN_SETTING_KEYS: readonly (keyof DomainSettings)[] = [
  'outputFileNameTemplate',
  'saveLocation',
  'saveFolder',
  'preserveFolderStructure',
  'saveLargerOutputs',
  'replaceOriginalFiles',
  'copyOutputToClipboard',
  'copyBatchOutputToClipboard',
  'showMenuBarIcon',
  'watchClipboard',
  'playCompletionSound',
  'enableAudioWaveforms',
  'autoCompress',
  'dropZoneVideoPresetId',
  'dropZoneImagePresetId',
  'dropZoneAudioPresetId',
  'watchedFolders',
  'useHardwareAcceleration',
  'cpuThreadLimit',
  'retryTargetSizeOnCpu',
  'enableVideoPreviews',
  'preventSleepWhileCompressing',
  'keepScreenOnWhileCompressing',
  'openInMenuBarOnly',
]

function extractDomainSettings(): DomainSettings {
  const snap = snapshot(settingsStore)
  return {
    outputFileNameTemplate: snap.outputFileNameTemplate,
    saveLocation: snap.saveLocation,
    saveFolder: snap.saveFolder,
    preserveFolderStructure: snap.preserveFolderStructure,
    saveLargerOutputs: snap.saveLargerOutputs,
    replaceOriginalFiles: snap.replaceOriginalFiles,
    copyOutputToClipboard: snap.copyOutputToClipboard,
    copyBatchOutputToClipboard: snap.copyBatchOutputToClipboard,
    showMenuBarIcon: snap.showMenuBarIcon,
    watchClipboard: snap.watchClipboard,
    playCompletionSound: snap.playCompletionSound,
    enableAudioWaveforms: snap.enableAudioWaveforms,
    autoCompress: snap.autoCompress,
    dropZoneVideoPresetId: snap.dropZoneVideoPresetId,
    dropZoneImagePresetId: snap.dropZoneImagePresetId,
    dropZoneAudioPresetId: snap.dropZoneAudioPresetId,
    watchedFolders: snap.watchedFolders.map((folder) => ({
      ...folder,
      ...(folder.presetIds ? { presetIds: { ...folder.presetIds } } : {}),
    })),
    useHardwareAcceleration: snap.useHardwareAcceleration,
    cpuThreadLimit: snap.cpuThreadLimit,
    retryTargetSizeOnCpu: snap.retryTargetSizeOnCpu,
    enableVideoPreviews: snap.enableVideoPreviews,
    preventSleepWhileCompressing: snap.preventSleepWhileCompressing,
    keepScreenOnWhileCompressing: snap.keepScreenOnWhileCompressing,
    openInMenuBarOnly: snap.openInMenuBarOnly,
  }
}

function extractCorePresets(): CorePresetsData {
  const snap = snapshot(presetsStore)
  return {
    schemaVersion: PRESET_CONTRACTS_SCHEMA_VERSION,
    presets: snap.presets.map((preset) => structuredClone(preset)),
    defaultPresetIds: { ...snap.defaultPresetIds },
  }
}

function applyDomainSettings(next: DomainSettings) {
  const target = settingsStore as Record<string, unknown>
  for (const key of DOMAIN_SETTING_KEYS) {
    if (!isEqual(settingsStore[key], next[key])) {
      target[key] =
        key === 'watchedFolders'
          ? next.watchedFolders.map((folder) => ({
              ...folder,
              ...(folder.presetIds
                ? { presetIds: { ...folder.presetIds } }
                : {}),
            }))
          : next[key]
    }
  }
}

function applyCorePresets(next: CorePresetsData) {
  if (!isEqual(snapshot(presetsStore).presets, next.presets)) {
    presetsStore.presets = next.presets
  }
  if (
    !isEqual(snapshot(presetsStore).defaultPresetIds, next.defaultPresetIds)
  ) {
    presetsStore.defaultPresetIds = { ...next.defaultPresetIds }
  }
}

let resolveReady: (() => void) | null = null
let readyPromise: Promise<void> = new Promise((resolve) => {
  resolveReady = resolve
})

/** Resolves once initial Rust `core` migration/hydration completes for this window. */
export function whenCoreStateReady() {
  return readyPromise
}

function markCoreReady() {
  resolveReady?.()
  resolveReady = null
}

/**
 * Keeps domain settings (`settings.json`) and presets (`presets.json`) synchronized between the
 * Rust `core` backend and this WebView, running the one-time `localStorage` migration on first
 * launch.
 */
export function useCoreStateSync() {
  useEffect(() => {
    let isMounted = true
    let isHydrated = false
    let suppressSettingsSave = false
    let suppressPresetsSave = false
    let lastSentSettings = ''
    let lastSentPresets = ''
    let unlistenSettings: (() => void) | undefined
    let unlistenPresets: (() => void) | undefined

    const handleSettingsFromCore = (next: DomainSettings) => {
      if (!isMounted) return
      suppressSettingsSave = true
      try {
        applyDomainSettings(next)
        lastSentSettings = JSON.stringify(next)
      } finally {
        suppressSettingsSave = false
      }
    }

    const handlePresetsFromCore = (next: CorePresetsData) => {
      if (!isMounted) return
      suppressPresetsSave = true
      try {
        applyCorePresets(next)
        lastSentPresets = JSON.stringify(next)
      } finally {
        suppressPresetsSave = false
      }
    }

    ;(async () => {
      try {
        const result = await migrateCoreState(
          extractDomainSettings(),
          extractCorePresets(),
        )
        if (!isMounted) return
        if (result.migratedSettings || result.migratedPresets) {
          logInfo(
            `[core-sync] Migrated local state to Rust core (settings=${result.migratedSettings}, presets=${result.migratedPresets})`,
          )
        }
        handleSettingsFromCore(result.settings)
        handlePresetsFromCore(result.presets)
        isHydrated = true
        markCoreReady()
      } catch (error) {
        logError('[core-sync] Failed to sync initial core state', error)
        isHydrated = true
        markCoreReady()
      }
    })()

    ;(async () => {
      unlistenSettings = await event.listen<DomainSettings>(
        CustomEvents.CoreSettingsChanged,
        (evt) => handleSettingsFromCore(evt.payload),
      )
      if (!isMounted) unlistenSettings()
    })()

    ;(async () => {
      unlistenPresets = await event.listen<CorePresetsData>(
        CustomEvents.CorePresetsChanged,
        (evt) => handlePresetsFromCore(evt.payload),
      )
      if (!isMounted) unlistenPresets()
    })()

    const unsubscribeSettings = subscribe(settingsStore, () => {
      if (!isHydrated || suppressSettingsSave) return
      const payload = extractDomainSettings()
      const serialized = JSON.stringify(payload)
      if (serialized === lastSentSettings) return
      lastSentSettings = serialized
      saveCoreSettings(payload).catch((error) => {
        logError('[core-sync] Could not save domain settings', error)
      })
    })

    const unsubscribePresets = subscribe(presetsStore, () => {
      if (!isHydrated || suppressPresetsSave) return
      const payload = extractCorePresets()
      const serialized = JSON.stringify(payload)
      if (serialized === lastSentPresets) return
      lastSentPresets = serialized
      saveCorePresets(payload).catch((error) => {
        logError('[core-sync] Could not save presets', error)
      })
    })

    return () => {
      isMounted = false
      unlistenSettings?.()
      unlistenPresets?.()
      unsubscribeSettings()
      unsubscribePresets()
    }
  }, [])
}
