import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import type { Preset, PresetMediaType, PresetOutput } from '@/types/preset'

/** The stores outputs are read from (their snapshots, to re-render when they change) */
type OutputSources = {
  presets: readonly Preset[]
  settings: Pick<
    typeof settingsStore,
    'saveLocation' | 'saveFolder' | 'outputFilePrefix'
  >
}

/** Setting of the preset each type of media is compressed with by the drop zone */
export const DROP_ZONE_PRESET_SETTINGS = {
  video: 'dropZoneVideoPresetId',
  image: 'dropZoneImagePresetId',
  audio: 'dropZoneAudioPresetId',
} as const satisfies Record<PresetMediaType, keyof typeof settingsStore>

/** The Standard preset's output: the one of Settings -> Output */
export function getStandardOutput(
  settings: OutputSources['settings'] = settingsStore,
): PresetOutput {
  return {
    saveLocation: settings.saveLocation,
    saveFolder: settings.saveFolder,
    filePrefix: settings.outputFilePrefix,
  }
}

/**
 * Where the outputs of media compressed with a preset are saved, & their file name prefix: the
 * preset's own, or the Standard preset's for it, presets following it & a deleted preset
 */
export function getPresetOutput(
  presetId: string | null | undefined,
  {
    presets = presetsStore.presets,
    settings = settingsStore,
  }: Partial<OutputSources> = {},
): PresetOutput {
  const preset = presetId ? presets.find((p) => p.id === presetId) : null
  return preset?.output ?? getStandardOutput(settings)
}

/** Whether outputs are saved without asking where (to a folder chosen, or next to the original) */
export function savesAutomatically(output: PresetOutput) {
  return (
    output.saveLocation === 'sameFolder' ||
    (output.saveLocation === 'fixedFolder' && !!output.saveFolder)
  )
}
