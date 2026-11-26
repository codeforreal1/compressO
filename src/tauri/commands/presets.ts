import { core } from '@tauri-apps/api'

import type {
  ContractMediaType,
  ContractValidationIssue,
  ContractValidationMode,
  MediaContract,
  PresetContract,
} from '@/contract/types'
import type { PresetMediaType, PresetOutput } from '@/types/preset'

export type PresetCommand =
  | {
      type: 'getPreset'
      idOrName: string
      mediaType?: PresetMediaType
    }
  | {
      type: 'validateContract'
      contract: unknown
      mode?: ContractValidationMode
      requireName?: boolean
    }
  | {
      type: 'createPreset'
      contract: unknown
      onConflict?: 'error' | 'rename' | 'replace'
    }
  | {
      type: 'updatePreset'
      idOrName: string
      patch: unknown
      mediaType?: PresetMediaType
      replace?: boolean
      ifRevision?: number
    }
  | {
      type: 'deletePreset'
      idOrName: string
      mediaType?: PresetMediaType
    }
  | {
      type: 'setDefaultPreset'
      idOrName: string
      mediaType: PresetMediaType
    }

export type PresetCommandPayload = {
  requestId: string
  command: PresetCommand
}

export type PresetCommandPresetView = {
  id: string
  name: string
  mediaType: ContractMediaType
  isDefault: boolean
  revision: number
  updatedAt?: string
  output: PresetOutput
  summary: string[]
  contract: PresetContract
}

export type PresetCommandResult =
  | {
      ok: true
      preset?: PresetCommandPresetView
      contract?: MediaContract
      warnings?: ContractValidationIssue[]
      created?: boolean
      replaced?: boolean
      renamed?: boolean
      deletedId?: string
      deletedName?: string
      mediaType?: ContractMediaType
      defaultResetToStandard?: boolean
      affectedWatchedFolders?: { id: string; path: string }[]
      defaultPresetId?: string
      presetName?: string
    }
  | {
      ok: false
      code: string
      message: string
      errors?: ContractValidationIssue[]
      warnings?: ContractValidationIssue[]
    }

export function completePresetsCommand(
  requestId: string,
  result: PresetCommandResult,
) {
  return core.invoke<void>('complete_presets_command', {
    requestId,
    result,
  })
}
