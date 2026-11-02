import { useEffect } from 'react'
import { subscribe } from 'valtio'

import i18n from '@/i18n'
import {
  describeAudioPresetSettings,
  describeImagePresetSettings,
  describeVideoPresetSettings,
  getPresets,
} from '@/routes/(root)/-presets'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import {
  type CliPreset,
  type CliSettings,
  syncCliSettings,
} from '@/tauri/commands/cli'
import { extensions, inputExtensions } from '@/types/compression'
import {
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import { getPresetOutput } from '@/utils/presetOutput'

const MEDIA_TYPES: PresetMediaType[] = ['video', 'image', 'audio']

/** What a preset changes, in English (the command line's language) */
function describePreset(preset: Preset) {
  const english = i18n.getFixedT('en')
  switch (preset.mediaType) {
    case 'video':
      return describeVideoPresetSettings(preset.settings, english)
    case 'audio':
      return describeAudioPresetSettings(preset.settings, english)
    default:
      return describeImagePresetSettings(preset.settings, english)
  }
}

function getCliSettings(): CliSettings {
  const presets: CliPreset[] = MEDIA_TYPES.flatMap((mediaType) =>
    getPresets(mediaType).map((preset) => ({
      id: preset.id,
      // The Standard preset's name, as the command line takes it
      name: preset.id === STANDARD_PRESET_ID ? 'Standard' : preset.name,
      mediaType,
      isDefault: presetsStore.defaultPresetIds[mediaType] === preset.id,
      output: getPresetOutput(preset.id),
      summary: describePreset(preset),
    })),
  )
  return {
    schemaVersion: 1,
    presets,
    defaultPresetIds: { ...presetsStore.defaultPresetIds },
    output: {
      skipLargerOutputs: !settingsStore.saveLargerOutputs,
      preserveFolderStructure: settingsStore.preserveFolderStructure,
      replaceOriginalFiles: settingsStore.replaceOriginalFiles,
      useHardwareAcceleration: settingsStore.useHardwareAcceleration,
      reachTargetSizesWithoutAcceleration: settingsStore.retryTargetSizeOnCpu,
    },
    extensions: {
      video: [...inputExtensions.video],
      image: [...inputExtensions.image],
      audio: [...inputExtensions.audio],
    },
    outputExtensions: {
      video: [
        ...Object.keys(extensions.video),
        ...Object.keys(extensions.audio),
      ],
      image: Object.keys(extensions.image),
      audio: Object.keys(extensions.audio),
    },
  }
}

/**
 * Sends the presets & the output settings to the backend for the command line (`compresso`, see
 * `cli_settings.rs`), when the app starts & each time they change
 */
export function useCliSettingsSync() {
  useEffect(() => {
    let sent: string | null = null
    const apply = () => {
      const settings = getCliSettings()
      const next = JSON.stringify(settings)
      if (next === sent) return
      sent = next
      syncCliSettings(settings).catch(() => {})
    }
    apply()
    const unsubscribeSettings = subscribe(settingsStore, apply)
    const unsubscribePresets = subscribe(presetsStore, apply)
    return () => {
      unsubscribeSettings()
      unsubscribePresets()
    }
  }, [])
}
