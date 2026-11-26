import {
  applyMergePatch,
  contractToPreset,
  isPlainObject,
  presetToContract,
  validateAndNormalizeContract,
} from '@/contract'
import type {
  ContractMediaType,
  ContractValidationIssue,
  PresetContract,
} from '@/contract/types'
import {
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import type { PresetsStateData } from './presetMigration'

export type PresetOperationError = {
  ok: false
  code: string
  message: string
  errors?: ContractValidationIssue[]
}

export type WatchedFolderLike = {
  id: string
  path: string
  presetIds?: Partial<Record<PresetMediaType, string>>
}

export function getAvailablePresetNameInList(
  presets: readonly Preset[],
  name: string,
  mediaType: PresetMediaType,
) {
  const names = new Set(
    presets
      .filter((preset) => preset.mediaType === mediaType)
      .map((preset) => preset.name.toLowerCase()),
  )
  names.add('standard')
  if (!names.has(name.toLowerCase())) return name
  let count = 2
  while (names.has(`${name} (${count})`.toLowerCase())) count++
  return `${name} (${count})`
}

export function resolvePresetRef(
  presets: readonly Preset[],
  ref: string,
  mediaType?: PresetMediaType,
):
  | { ok: true; isStandard: true; mediaType?: PresetMediaType }
  | { ok: true; isStandard: false; preset: Preset; index: number }
  | PresetOperationError {
  const trimmed = ref.trim()
  if (!trimmed) {
    return {
      ok: false,
      code: 'invalidRequest',
      message: 'Preset id or name is required.',
    }
  }
  if (trimmed.toLowerCase() === STANDARD_PRESET_ID) {
    return { ok: true, isStandard: true, mediaType }
  }
  const pool = presets
    .map((preset, index) => ({ preset, index }))
    .filter(({ preset }) => !mediaType || preset.mediaType === mediaType)

  const byId = pool.find(({ preset }) => preset.id === trimmed)
  if (byId) {
    return {
      ok: true,
      isStandard: false,
      preset: byId.preset,
      index: byId.index,
    }
  }

  const lower = trimmed.toLowerCase()
  const byName = pool.filter(
    ({ preset }) => preset.name.toLowerCase() === lower,
  )
  if (byName.length === 1) {
    return {
      ok: true,
      isStandard: false,
      preset: byName[0].preset,
      index: byName[0].index,
    }
  }
  if (byName.length > 1) {
    return {
      ok: false,
      code: 'ambiguousPreset',
      message: `Multiple media types have a preset named "${trimmed}". Specify mediaType (${byName.map((m) => m.preset.mediaType).join(', ')}).`,
    }
  }
  return {
    ok: false,
    code: 'unknownPreset',
    message: mediaType
      ? `There is no ${mediaType} preset named or with id "${trimmed}".`
      : `There is no preset named or with id "${trimmed}".`,
  }
}

export function createPresetInState(
  state: PresetsStateData,
  rawContract: unknown,
  options: { onConflict?: 'error' | 'rename' | 'replace' } = {},
):
  | {
      ok: true
      preset: Preset
      contract: PresetContract
      warnings: ContractValidationIssue[]
      created: boolean
      replaced: boolean
      renamed: boolean
    }
  | PresetOperationError {
  const onConflict = options.onConflict ?? 'error'
  const validated = validateAndNormalizeContract(rawContract, {
    mode: 'preset',
    requireName: true,
  })
  if (!validated.ok) {
    return {
      ok: false,
      code: 'invalidContract',
      message: validated.errors
        .map((e) => `${e.path || '/'}: ${e.message}`)
        .join('; '),
      errors: validated.errors,
    }
  }

  const contract = validated.contract as PresetContract
  const wantedName = contract.name!
  const existingIndex = state.presets.findIndex(
    (p) =>
      p.mediaType === contract.mediaType &&
      p.name.toLowerCase() === wantedName.toLowerCase(),
  )

  const now = new Date().toISOString()
  if (existingIndex >= 0) {
    if (onConflict === 'error') {
      return {
        ok: false,
        code: 'presetExists',
        message: `A ${contract.mediaType} preset named "${state.presets[existingIndex].name}" already exists.`,
      }
    }
    if (onConflict === 'replace') {
      const existing = state.presets[existingIndex]
      const updated: Preset = {
        ...contractToPreset(existing.id, contract),
        revision: (existing.revision ?? 1) + 1,
        updatedAt: now,
      }
      state.presets[existingIndex] = updated
      return {
        ok: true,
        preset: updated,
        contract: presetToContract(updated),
        warnings: validated.warnings,
        created: false,
        replaced: true,
        renamed: false,
      }
    }
    const finalName = getAvailablePresetNameInList(
      state.presets,
      wantedName,
      contract.mediaType,
    )
    const renamedContract = { ...contract, name: finalName } as PresetContract
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const created: Preset = {
      ...contractToPreset(id, renamedContract),
      revision: 1,
      updatedAt: now,
    }
    state.presets.push(created)
    return {
      ok: true,
      preset: created,
      contract: presetToContract(created),
      warnings: validated.warnings,
      created: true,
      replaced: false,
      renamed: true,
    }
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const created: Preset = {
    ...contractToPreset(id, contract),
    revision: 1,
    updatedAt: now,
  }
  state.presets.push(created)
  return {
    ok: true,
    preset: created,
    contract: presetToContract(created),
    warnings: validated.warnings,
    created: true,
    replaced: false,
    renamed: false,
  }
}

export function updatePresetInState(
  state: PresetsStateData,
  ref: string,
  patchOrContract: unknown,
  options: {
    mediaType?: ContractMediaType
    replace?: boolean
    ifRevision?: number
  } = {},
):
  | {
      ok: true
      preset: Preset
      contract: PresetContract
      warnings: ContractValidationIssue[]
    }
  | PresetOperationError {
  const resolved = resolvePresetRef(state.presets, ref, options.mediaType)
  if (!resolved.ok) return resolved
  if (resolved.isStandard) {
    return {
      ok: false,
      code: 'standardPresetReadOnly',
      message: 'The built-in Standard preset cannot be modified.',
    }
  }

  const { preset: existing, index } = resolved
  const currentRevision = existing.revision ?? 1
  if (
    options.ifRevision !== undefined &&
    options.ifRevision !== currentRevision
  ) {
    return {
      ok: false,
      code: 'revisionConflict',
      message: `Preset "${existing.name}" is at revision ${currentRevision}, not ${options.ifRevision}.`,
    }
  }

  const currentContract = presetToContract(existing)
  let candidate: unknown
  if (options.replace) {
    candidate = patchOrContract
  } else {
    if (!isPlainObject(patchOrContract)) {
      return {
        ok: false,
        code: 'invalidContract',
        message: 'Patch must be a JSON object.',
      }
    }
    candidate = applyMergePatch(currentContract, patchOrContract)
  }

  if (
    isPlainObject(candidate) &&
    candidate.mediaType !== undefined &&
    candidate.mediaType !== existing.mediaType
  ) {
    return {
      ok: false,
      code: 'mediaTypeMismatch',
      message: `Cannot change preset mediaType from "${existing.mediaType}" to "${String(candidate.mediaType)}".`,
    }
  }

  const validated = validateAndNormalizeContract(candidate, {
    mode: 'preset',
    requireName: true,
  })
  if (!validated.ok) {
    return {
      ok: false,
      code: 'invalidContract',
      message: validated.errors
        .map((e) => `${e.path || '/'}: ${e.message}`)
        .join('; '),
      errors: validated.errors,
    }
  }

  const nextContract = validated.contract as PresetContract
  const clash = state.presets.find(
    (p, i) =>
      i !== index &&
      p.mediaType === existing.mediaType &&
      p.name.toLowerCase() === nextContract.name!.toLowerCase(),
  )
  if (clash) {
    return {
      ok: false,
      code: 'presetExists',
      message: `A ${existing.mediaType} preset named "${clash.name}" already exists.`,
    }
  }

  const updated: Preset = {
    ...contractToPreset(existing.id, nextContract),
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
  }
  state.presets[index] = updated
  return {
    ok: true,
    preset: updated,
    contract: presetToContract(updated),
    warnings: validated.warnings,
  }
}

export function deletePresetInState(
  state: PresetsStateData,
  ref: string,
  options: {
    mediaType?: ContractMediaType
    watchedFolders?: readonly WatchedFolderLike[]
  } = {},
):
  | {
      ok: true
      deletedId: string
      deletedName: string
      mediaType: PresetMediaType
      defaultResetToStandard: boolean
      affectedWatchedFolders: { id: string; path: string }[]
    }
  | PresetOperationError {
  const resolved = resolvePresetRef(state.presets, ref, options.mediaType)
  if (!resolved.ok) return resolved
  if (resolved.isStandard) {
    return {
      ok: false,
      code: 'standardPresetReadOnly',
      message: 'The built-in Standard preset cannot be deleted.',
    }
  }

  const { preset } = resolved
  state.presets = state.presets.filter((p) => p.id !== preset.id)
  let defaultResetToStandard = false
  if (state.defaultPresetIds[preset.mediaType] === preset.id) {
    state.defaultPresetIds[preset.mediaType] = STANDARD_PRESET_ID
    defaultResetToStandard = true
  }

  const affectedWatchedFolders = (options.watchedFolders ?? [])
    .filter((folder) => folder.presetIds?.[preset.mediaType] === preset.id)
    .map((folder) => ({ id: folder.id, path: folder.path }))

  return {
    ok: true,
    deletedId: preset.id,
    deletedName: preset.name,
    mediaType: preset.mediaType,
    defaultResetToStandard,
    affectedWatchedFolders,
  }
}

export function setDefaultPresetInState(
  state: PresetsStateData,
  ref: string,
  mediaType: PresetMediaType,
):
  | {
      ok: true
      mediaType: PresetMediaType
      defaultPresetId: string
      presetName: string
    }
  | PresetOperationError {
  const resolved = resolvePresetRef(state.presets, ref, mediaType)
  if (!resolved.ok) return resolved
  if (resolved.isStandard) {
    state.defaultPresetIds[mediaType] = STANDARD_PRESET_ID
    return {
      ok: true,
      mediaType,
      defaultPresetId: STANDARD_PRESET_ID,
      presetName: 'Standard',
    }
  }
  state.defaultPresetIds[mediaType] = resolved.preset.id
  return {
    ok: true,
    mediaType,
    defaultPresetId: resolved.preset.id,
    presetName: resolved.preset.name,
  }
}
