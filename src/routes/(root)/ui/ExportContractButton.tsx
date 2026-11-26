import { DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { save } from '@tauri-apps/plugin-dialog'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Dropdown from '@/components/Dropdown'
import Icon from '@/components/Icon'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { imageConfigToContract, videoConfigToContract } from '@/contract'
import type { MediaContract } from '@/contract/types'
import { flushSyncStates } from '@/hooks/useSyncState'
import { getStoredPreset } from '@/stores/presetsStore'
import { logError, logInfo } from '@/tauri/commands/app'
import { writeTextFile } from '@/tauri/commands/fs'
import type { ImageConfig, VideoConfig } from '@/types/app'
import { type PresetMediaType, STANDARD_PRESET_ID } from '@/types/preset'
import { splitFileName } from '@/utils/fileNameTemplate'
import { glassMenuItem } from '@/utils/glass'
import { getPortableTransform } from '@/utils/transform'
import {
  getBatchConfigKey,
  getImageConfigResolution,
  getVideoConfigResolution,
  isMediaOfPresetType,
} from '../-presets'
import { appProxy } from '../-state'
import { showContractExportedToast } from '../-toasts'

function buildCurrentContract(
  mediaType: PresetMediaType,
  singleIndex: number,
): { contract: MediaContract; suggestedName: string } {
  flushSyncStates()
  const state = appProxy.state
  const mediaFile =
    singleIndex >= 0 && isMediaOfPresetType(state.media[singleIndex], mediaType)
      ? state.media[singleIndex]
      : null

  const config = (mediaFile?.config ??
    state.commonConfigForBatchCompression[getBatchConfigKey(mediaType)]) as
    | VideoConfig
    | ImageConfig

  const preset =
    config.presetId && config.presetId !== STANDARD_PRESET_ID
      ? getStoredPreset(config.presetId)
      : undefined

  const baseMeta = {
    ...(preset?.name ? { name: preset.name } : {}),
    output: preset?.output ?? null,
  }

  const rawFileName = mediaFile?.fileName
    ? splitFileName(mediaFile.fileName).stem
    : `${mediaType}-batch`
  const suggestedName = `${rawFileName}.contract.json`

  if (mediaType === 'image') {
    const imgConfig = config as ImageConfig
    const resolution = getImageConfigResolution(imgConfig, {
      isBatchConfig: !mediaFile,
      batchLongerSide:
        state.commonConfigForBatchCompression.imageConfig.batchLongerSide,
    })
    const transform =
      imgConfig.batchTransform !== undefined
        ? imgConfig.batchTransform
        : imgConfig.shouldTransformImage
          ? getPortableTransform(imgConfig.transformImageConfig)
          : null
    return {
      contract: imageConfigToContract(imgConfig, {
        ...baseMeta,
        resolution,
        transform,
      }),
      suggestedName,
    }
  }

  const vidConfig = config as VideoConfig
  const resolution =
    mediaType === 'audio'
      ? null
      : getVideoConfigResolution(vidConfig, {
          isBatchConfig: !mediaFile,
          batchResolution:
            state.commonConfigForBatchCompression.videoConfig.batchResolution,
        })
  const transform =
    mediaType === 'audio'
      ? null
      : vidConfig.batchTransform !== undefined
        ? vidConfig.batchTransform
        : vidConfig.shouldTransformVideo
          ? getPortableTransform(vidConfig.transformVideoConfig)
          : null

  return {
    contract: videoConfigToContract(vidConfig, {
      ...baseMeta,
      mediaType,
      resolution,
      transform,
      includeOneShot: true,
    }),
    suggestedName,
  }
}

/**
 * Top-right action in Output / Batch Settings to save or copy the current settings as a
 * CompressO JSON contract.
 */
function ExportContractButton() {
  const { t } = useTranslation()
  const {
    state: { media, isLoadingMediaFiles, selectedMediaIndexForCustomization },
  } = useSnapshot(appProxy)

  const singleIndex =
    selectedMediaIndexForCustomization > -1
      ? selectedMediaIndexForCustomization
      : media.length === 1
        ? 0
        : -1

  const singleMedia = singleIndex >= 0 ? media[singleIndex] : null

  const availableTypes = useMemo<PresetMediaType[]>(() => {
    if (singleMedia) {
      if (singleMedia.type === 'image') return ['image']
      return [singleMedia.isAudioFile ? 'audio' : 'video']
    }
    const types: PresetMediaType[] = []
    if (media.some((m) => m.type === 'video' && !m.isAudioFile)) {
      types.push('video')
    }
    if (media.some((m) => m.type === 'image')) {
      types.push('image')
    }
    if (media.some((m) => m.type === 'video' && !!m.isAudioFile)) {
      types.push('audio')
    }
    return types
  }, [media, singleMedia])

  if (!media.length || isLoadingMediaFiles || availableTypes.length === 0) {
    return null
  }

  const handleAction = async (key: string) => {
    const [action, type] = key.split(':') as ['save' | 'copy', PresetMediaType]

    let contract: MediaContract
    let suggestedName: string
    let jsonText: string
    try {
      const built = buildCurrentContract(type, singleIndex)
      contract = built.contract
      suggestedName = built.suggestedName
      jsonText = `${JSON.stringify(contract, null, 2)}\n`
    } catch (error) {
      logError(`[contract] Could not build current ${type} contract`, error)
      toast.error(
        action === 'copy'
          ? t('contract.copyFailed')
          : t('contract.exportFailed'),
      )
      return
    }

    if (action === 'copy') {
      try {
        await navigator.clipboard.writeText(jsonText)
        logInfo(`[contract] Copied ${type} contract to clipboard`)
        toast.success(t('contract.copied'))
      } catch (error) {
        logError(
          `[contract] Could not copy ${type} contract to clipboard`,
          error,
        )
        toast.error(t('contract.copyFailed'))
      }
      return
    }

    try {
      const targetPath = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!targetPath) return
      await writeTextFile(targetPath, jsonText)
      logInfo(`[contract] Exported ${type} contract to ${targetPath}`)
      showContractExportedToast(targetPath)
    } catch (error) {
      logError(`[contract] Could not export ${type} contract`, error)
      toast.error(t('contract.exportFailed'))
    }
  }

  const isMultiTypeBatch = availableTypes.length > 1

  const items = isMultiTypeBatch
    ? availableTypes.flatMap((type) => [
        {
          key: `save:${type}`,
          label: t('contract.saveType', {
            type: t(`outputSettings.tabs.${type}`),
          }),
          icon: 'download' as const,
        },
        {
          key: `copy:${type}`,
          label: t('contract.copyType', {
            type: t(`outputSettings.tabs.${type}`),
          }),
          icon: 'copy' as const,
        },
      ])
    : [
        {
          key: `save:${availableTypes[0]}`,
          label: t('contract.saveFile'),
          icon: 'download' as const,
        },
        {
          key: `copy:${availableTypes[0]}`,
          label: t('contract.copy'),
          icon: 'copy' as const,
        },
      ]

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          size="sm"
          variant="light"
          radius="full"
          isIconOnly
          aria-label={t('contract.exportTooltip')}
        >
          <Tooltip
            content={t('contract.exportTooltip')}
            aria-label={t('contract.exportTooltip')}
          >
            <Icon name="terminal" size={18} />
          </Tooltip>
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t('contract.exportTooltip')}
        itemClasses={{ base: glassMenuItem }}
        onAction={(key) => void handleAction(String(key))}
      >
        {items.map((item) => (
          <DropdownItem
            key={item.key}
            startContent={<Icon name={item.icon} size={15} />}
          >
            {item.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  )
}

export default memo(ExportContractButton)
