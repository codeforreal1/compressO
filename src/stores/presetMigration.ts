import {
  contractToPreset,
  presetToContract,
  validateAndNormalizeContract,
} from '@/contract'
import type { PresetContract } from '@/contract/types'
import {
  type Preset,
  type PresetMediaType,
  type PresetOutput,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import {
  getLegacyPrefixFromTemplate,
  migratePrefixToTemplate,
} from '@/utils/fileNameTemplate'

export const PRESET_CONTRACTS_SCHEMA_VERSION = 2
const LEGACY_PRESETS_SCHEMA_VERSION = 1

export type StoredPresetContractRecord = {
  id: string
  name: string
  mediaType: PresetMediaType
  revision?: number
  updatedAt?: string
  contract: PresetContract
}

export type StoredPresetContracts = {
  schemaVersion: number
  presets: StoredPresetContractRecord[]
  defaultPresetIds: Record<PresetMediaType, string>
}

export type PresetsStateData = {
  presets: Preset[]
  defaultPresetIds: Record<PresetMediaType, string>
}

const DEFAULT_IDS: Record<PresetMediaType, string> = {
  video: STANDARD_PRESET_ID,
  image: STANDARD_PRESET_ID,
  audio: STANDARD_PRESET_ID,
}

function isValidLegacyPreset(preset: unknown): preset is Preset {
  const value = preset as Partial<Preset> | null
  return (
    !!value &&
    typeof value.id === 'string' &&
    value.id !== STANDARD_PRESET_ID &&
    typeof value.name === 'string' &&
    (value.mediaType === 'video' ||
      value.mediaType === 'image' ||
      value.mediaType === 'audio') &&
    typeof value.settings === 'object' &&
    value.settings != null
  )
}

function normalizeLegacyOutput(output: unknown): PresetOutput | null {
  const value = output as Partial<PresetOutput> | null
  if (
    !value ||
    (value.saveLocation !== 'ask' &&
      value.saveLocation !== 'fixedFolder' &&
      value.saveLocation !== 'sameFolder') ||
    (value.saveFolder !== null && typeof value.saveFolder !== 'string') ||
    (typeof value.fileNameTemplate !== 'string' &&
      typeof value.filePrefix !== 'string')
  ) {
    return null
  }
  const fileNameTemplate =
    typeof value.fileNameTemplate === 'string'
      ? value.fileNameTemplate
      : migratePrefixToTemplate(value.filePrefix)
  return {
    saveLocation: value.saveLocation,
    saveFolder: value.saveFolder,
    fileNameTemplate,
    filePrefix: getLegacyPrefixFromTemplate(fileNameTemplate),
  }
}

function resolveDefaultPresetIds(
  presets: readonly Preset[],
  rawDefaults: Partial<Record<PresetMediaType, string>> | undefined,
): Record<PresetMediaType, string> {
  const pick = (mediaType: PresetMediaType) => {
    const id = rawDefaults?.[mediaType]
    return presets.some((p) => p.id === id && p.mediaType === mediaType)
      ? id!
      : STANDARD_PRESET_ID
  }
  return {
    video: pick('video'),
    image: pick('image'),
    audio: pick('audio'),
  }
}

/** Converts a v1 preset into a contract-backed preset, dropping only malformed entries */
function migrateLegacyPreset(raw: Preset): Preset | null {
  const normalized: Preset = raw.output
    ? { ...raw, output: normalizeLegacyOutput(raw.output) }
    : raw
  try {
    const rawContract = presetToContract(normalized)
    // Legacy presets might have image format `'gif'` or out-of-range numbers: validate first,
    // and fall back to keeping the normalized legacy settings if a quirk fails strict rules
    const validated = validateAndNormalizeContract(rawContract, {
      mode: 'preset',
      requireName: false,
    })
    if (validated.ok) {
      const converted = contractToPreset(normalized.id, {
        ...validated.contract,
        name: normalized.name,
      } as PresetContract)
      return {
        ...converted,
        revision: 1,
      }
    }
    return {
      ...normalized,
      revision: 1,
    }
  } catch {
    return null
  }
}

/**
 * Reads v2 contract-backed presets, or migrates v1 presets on first run.
 * Returns `{ state, migratedFromLegacy }` so callers can persist v2 without deleting v1.
 */
export function loadPresetsWithMigration(
  rawContractsJson: string | null,
  rawLegacyJson: string | null,
): { state: PresetsStateData; migratedFromLegacy: boolean } {
  const fallback: PresetsStateData = {
    presets: [],
    defaultPresetIds: { ...DEFAULT_IDS },
  }

  if (rawContractsJson) {
    try {
      const stored = JSON.parse(
        rawContractsJson,
      ) as Partial<StoredPresetContracts> | null
      if (stored && stored.schemaVersion === PRESET_CONTRACTS_SCHEMA_VERSION) {
        const presets: Preset[] = []
        for (const entry of Array.isArray(stored.presets)
          ? stored.presets
          : []) {
          if (
            !entry ||
            typeof entry.id !== 'string' ||
            entry.id === STANDARD_PRESET_ID ||
            typeof entry.name !== 'string' ||
            !entry.contract
          ) {
            continue
          }
          const validated = validateAndNormalizeContract(entry.contract, {
            mode: 'preset',
            requireName: false,
          })
          if (!validated.ok) continue
          const preset = contractToPreset(entry.id, {
            ...validated.contract,
            name: entry.name,
          } as PresetContract)
          presets.push({
            ...preset,
            ...(typeof entry.revision === 'number'
              ? { revision: entry.revision }
              : {}),
            ...(typeof entry.updatedAt === 'string'
              ? { updatedAt: entry.updatedAt }
              : {}),
          })
        }
        return {
          state: {
            presets,
            defaultPresetIds: resolveDefaultPresetIds(
              presets,
              stored.defaultPresetIds,
            ),
          },
          migratedFromLegacy: false,
        }
      }
    } catch {
      // Fall through to legacy check if v2 data is unreadable
    }
  }

  if (rawLegacyJson) {
    try {
      const legacy = JSON.parse(rawLegacyJson) as {
        schemaVersion?: number
        presets?: unknown[]
        defaultPresetIds?: Partial<Record<PresetMediaType, string>>
      } | null
      if (legacy && legacy.schemaVersion === LEGACY_PRESETS_SCHEMA_VERSION) {
        const presets = (Array.isArray(legacy.presets) ? legacy.presets : [])
          .filter(isValidLegacyPreset)
          .map(migrateLegacyPreset)
          .filter((p): p is Preset => p !== null)
        return {
          state: {
            presets,
            defaultPresetIds: resolveDefaultPresetIds(
              presets,
              legacy.defaultPresetIds,
            ),
          },
          migratedFromLegacy: true,
        }
      }
    } catch {
      return { state: fallback, migratedFromLegacy: false }
    }
  }

  return { state: fallback, migratedFromLegacy: false }
}

export function serializePresetContracts(
  state: PresetsStateData,
): StoredPresetContracts {
  return {
    schemaVersion: PRESET_CONTRACTS_SCHEMA_VERSION,
    presets: state.presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      mediaType: preset.mediaType,
      revision: preset.revision ?? 1,
      ...(preset.updatedAt ? { updatedAt: preset.updatedAt } : {}),
      contract: presetToContract(preset),
    })),
    defaultPresetIds: { ...state.defaultPresetIds },
  }
}
