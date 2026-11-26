import { event } from '@tauri-apps/api'
import { useEffect } from 'react'

import { presetToContract, validateAndNormalizeContract } from '@/contract'
import i18n from '@/i18n'
import {
  describeAudioPresetSettings,
  describeImagePresetSettings,
  describeVideoPresetSettings,
  getPreset,
} from '@/routes/(root)/-presets'
import {
  createPresetFromContract,
  deletePresetByRef,
  findPresetByRef,
  presetsStore,
  setDefaultPresetByRef,
  updatePresetFromContract,
} from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import { logError, logInfo } from '@/tauri/commands/app'
import {
  completePresetsCommand,
  type PresetCommand,
  type PresetCommandPayload,
  type PresetCommandPresetView,
  type PresetCommandResult,
} from '@/tauri/commands/presets'
import { CustomEvents } from '@/types/compression'
import { type Preset, STANDARD_PRESET_ID } from '@/types/preset'
import { getPresetOutput } from '@/utils/presetOutput'

function describePresetEnglish(preset: Preset) {
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

function toPresetView(preset: Preset): PresetCommandPresetView {
  const name = preset.id === STANDARD_PRESET_ID ? 'Standard' : preset.name
  return {
    id: preset.id,
    name,
    mediaType: preset.mediaType,
    isDefault: presetsStore.defaultPresetIds[preset.mediaType] === preset.id,
    revision: preset.revision ?? 1,
    ...(preset.updatedAt ? { updatedAt: preset.updatedAt } : {}),
    output: getPresetOutput(preset.id),
    summary: describePresetEnglish(preset),
    contract: presetToContract({ ...preset, name }),
  }
}

function applyCommand(command: PresetCommand): PresetCommandResult {
  switch (command.type) {
    case 'getPreset': {
      const resolved = findPresetByRef(command.idOrName, command.mediaType)
      if (!resolved.ok) return resolved
      if (resolved.isStandard) {
        if (!command.mediaType) {
          return {
            ok: false,
            code: 'ambiguousPreset',
            message:
              'Multiple media types have a "Standard" preset. Specify mediaType (video, image, audio).',
          }
        }
        const preset = getPreset(command.mediaType, STANDARD_PRESET_ID)
        return { ok: true, preset: toPresetView(preset) }
      }
      return { ok: true, preset: toPresetView(resolved.preset) }
    }
    case 'validateContract': {
      const result = validateAndNormalizeContract(command.contract, {
        mode: command.mode ?? 'oneShot',
        requireName: command.requireName ?? false,
      })
      if (!result.ok) {
        return {
          ok: false,
          code: 'invalidContract',
          message: result.errors
            .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
            .join('; '),
          errors: result.errors,
          warnings: result.warnings,
        }
      }
      return {
        ok: true,
        contract: result.contract,
        warnings: result.warnings,
      }
    }
    case 'createPreset': {
      const res = createPresetFromContract(command.contract, {
        onConflict: command.onConflict ?? 'error',
      })
      if (!res.ok) return res
      return {
        ok: true,
        preset: toPresetView(res.preset),
        warnings: res.warnings,
        created: res.created,
        replaced: res.replaced,
        renamed: res.renamed,
      }
    }
    case 'updatePreset': {
      const res = updatePresetFromContract(command.idOrName, command.patch, {
        mediaType: command.mediaType,
        replace: command.replace,
        ifRevision: command.ifRevision,
      })
      if (!res.ok) return res
      return {
        ok: true,
        preset: toPresetView(res.preset),
        warnings: res.warnings,
      }
    }
    case 'deletePreset': {
      const res = deletePresetByRef(command.idOrName, {
        mediaType: command.mediaType,
        watchedFolders: settingsStore.watchedFolders,
      })
      if (!res.ok) return res
      return {
        ok: true,
        deletedId: res.deletedId,
        deletedName: res.deletedName,
        mediaType: res.mediaType,
        defaultResetToStandard: res.defaultResetToStandard,
        affectedWatchedFolders: res.affectedWatchedFolders,
      }
    }
    case 'setDefaultPreset': {
      const res = setDefaultPresetByRef(command.idOrName, command.mediaType)
      if (!res.ok) return res
      return {
        ok: true,
        mediaType: res.mediaType,
        defaultPresetId: res.defaultPresetId,
        presetName: res.presetName,
      }
    }
  }
}

/**
 * Applies preset & contract commands sent by the CLI/MCP server (`presets_bridge.rs`).
 */
export function usePresetsCommand() {
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let isMounted = true
    let queue: Promise<void> = Promise.resolve()
    const results = new Map<string, PresetCommandResult>()

    const answer = async (requestId: string, result: PresetCommandResult) => {
      try {
        await completePresetsCommand(requestId, result)
      } catch (error) {
        logError('Could not answer a presets command', error)
      }
    }

    const handle = (payload: PresetCommandPayload) => {
      const run = queue.then(async () => {
        const cached = results.get(payload.requestId)
        if (cached) {
          await answer(payload.requestId, cached)
          return
        }
        let result: PresetCommandResult
        try {
          logInfo(`[presets] Applying CLI/MCP command: ${payload.command.type}`)
          result = applyCommand(payload.command)
          if (!result.ok) {
            logError(
              `[presets] Command ${payload.command.type} rejected (${result.code}): ${result.message}`,
            )
          }
        } catch (error) {
          logError('[presets] Could not apply a presets command', error)
          result = {
            ok: false,
            code: 'appUnavailable',
            message: 'CompressO could not change its presets.',
          }
        }
        results.set(payload.requestId, result)
        if (results.size > 50) {
          const oldest = results.keys().next().value
          if (oldest) results.delete(oldest)
        }
        await answer(payload.requestId, result)
      })
      queue = run.catch(() => {})
    }

    ;(async () => {
      unlisten = await event.listen<PresetCommandPayload>(
        CustomEvents.PresetsCommand,
        (evt) => handle(evt.payload),
      )
      if (!isMounted) {
        unlisten()
      }
    })()

    return () => {
      isMounted = false
      unlisten?.()
    }
  }, [])
}
