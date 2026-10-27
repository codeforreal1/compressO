import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import {
  DEFAULT_PRESET_CHOICE,
  type Preset,
  type PresetMediaType,
  type PresetOutput,
  STANDARD_PRESET_ID,
} from '@/types/preset'

/** The stores outputs are read from (their snapshots, to re-render when they change) */
type OutputSources = {
  presets: readonly Preset[]
  settings: Pick<
    typeof settingsStore,
    'saveLocation' | 'saveFolder' | 'outputFilePrefix'
  >
}

/** The presets & the default ones, a choice of preset is read with (or their snapshots) */
export type PresetsState = Pick<
  typeof presetsStore,
  'presets' | 'defaultPresetIds'
>

/**
 * A stored choice of preset for a type of media (of the drop zone or a watched folder): the preset
 * chosen, or Default (following the default preset, starred in Settings -> Presets) when none is
 * chosen or the chosen one was deleted
 */
export function getPresetChoice(
  id: string | null | undefined,
  mediaType: PresetMediaType,
  presets: readonly Preset[] = presetsStore.presets,
) {
  return id &&
    (id === STANDARD_PRESET_ID ||
      presets.some(
        (preset) => preset.id === id && preset.mediaType === mediaType,
      ))
    ? id
    : DEFAULT_PRESET_CHOICE
}

/**
 * The preset a choice of preset stands for (see `getPresetChoice`). Read when compressing, so
 * Default follows the preset starred at that moment.
 */
export function resolvePresetChoice(
  id: string | null | undefined,
  mediaType: PresetMediaType,
  { presets, defaultPresetIds }: PresetsState = presetsStore,
) {
  const choice = getPresetChoice(id, mediaType, presets)
  return choice === DEFAULT_PRESET_CHOICE ? defaultPresetIds[mediaType] : choice
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
