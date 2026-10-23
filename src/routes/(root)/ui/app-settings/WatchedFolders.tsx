// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import InfoTooltip from '@/components/InfoTooltip'
import Select from '@/components/Select'
import SettingLink from '@/components/SettingLink'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import {
  canWatchedFolderSave,
  getFolderName,
} from '@/hooks/useAutoCompressSync'
import { t } from '@/i18n'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore, type WatchedFolder } from '@/stores/settingsStore'
import { logError } from '@/tauri/commands/app'
import { getMissingWatchedFolders } from '@/tauri/commands/dropQueue'
import { showItemInFileManager } from '@/tauri/commands/fs'
import {
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import { getPresetOutput, savesAutomatically } from '@/utils/presetOutput'
import { hasTray, TRAY_CONTEXT } from '@/utils/tray'
import { SettingsRow, SettingsSection } from './SettingsLayout'
import { getPresets } from '../../-presets'

const PRESET_MEDIA_TYPES: PresetMediaType[] = ['video', 'image', 'audio']

async function pickFolderToWatch() {
  const folder = await open({
    directory: true,
    title: t('settings.dropZone.watchedFolders.add.dialogTitle'),
  })
  return typeof folder === 'string' ? folder : null
}

/** A watched folder, live (not a snapshot), to be changed */
function getStoredFolder(id: string) {
  return settingsStore.watchedFolders.find((folder) => folder.id === id)
}

type FolderPresetSelectProps = {
  folder: WatchedFolder
  mediaType: PresetMediaType
  isDisabled: boolean
}

/** The preset a watched folder's media of a type is compressed with */
function FolderPresetSelect({
  folder,
  mediaType,
  isDisabled,
}: FolderPresetSelectProps) {
  const { t } = useTranslation()
  const settings = useSnapshot(settingsStore)
  const { presets } = useSnapshot(presetsStore)
  const options = getPresets(mediaType, presets as Preset[])
  // The Standard preset unless another is chosen (also for a deleted one)
  const presetId = folder.presetIds?.[mediaType]
  const selectedKey = options.some((preset) => preset.id === presetId)
    ? presetId!
    : STANDARD_PRESET_ID
  // Asks where to save, which stops the folder from being watched
  const asksWhereToSave = !savesAutomatically(
    getPresetOutput(selectedKey, {
      presets: presets as Preset[],
      settings: settings as typeof settingsStore,
    }),
  )

  return (
    <Select
      label={
        <span className="inline-flex items-center gap-1">
          {t('settings.dropZone.watchedFolders.preset', {
            context: mediaType,
          })}
          <InfoTooltip
            variant="warning"
            content={
              asksWhereToSave && (
                <Trans
                  i18nKey="settings.dropZone.watchedFolders.presetAsks"
                  components={{
                    setting: (
                      <SettingLink target={{ settingId: 'saveLocation' }} />
                    ),
                  }}
                />
              )
            }
          />
        </span>
      }
      selectedKeys={[selectedKey]}
      disallowEmptySelection
      isDisabled={isDisabled}
      onSelectionChange={(keys) => {
        const [key] = [...keys]
        const target = getStoredFolder(folder.id)
        if (!key || !target) return
        target.presetIds = { ...target.presetIds, [mediaType]: String(key) }
      }}
      classNames={{ popoverContent: 'settings-dialog' }}
    >
      {options.map((preset) => (
        <SelectItem key={preset.id}>{preset.name}</SelectItem>
      ))}
    </Select>
  )
}

/**
 * Folders whose new media (e.g. screen recordings or downloads) the drop zone compresses, after
 * the media dropped on it (see `watch_folders.rs`), each with its presets (Standard by default)
 */
function WatchedFolders() {
  const { t } = useTranslation()
  const settings = useSnapshot(settingsStore)
  const { watchedFolders, showMenuBarIcon } = settings
  const { presets } = useSnapshot(presetsStore)
  const [missingPaths, setMissingPaths] = useState<string[]>([])
  const [checkingFolderId, setCheckingFolderId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    const paths = settingsStore.watchedFolders.map((folder) => folder.path)
    getMissingWatchedFolders(paths)
      .then((missing) => {
        if (!isMounted) return
        setMissingPaths(missing)
        const missingSet = new Set(missing)
        for (const folder of settingsStore.watchedFolders) {
          if (folder.isEnabled && missingSet.has(folder.path)) {
            folder.isEnabled = false
          }
        }
      })
      .catch((error) => logError('Could not check watched folders', error))
    return () => {
      isMounted = false
    }
  }, [])
  // On macOS & Windows, the menu bar's (or tray's) window compresses their media, so it needs its
  // icon; on Linux, the main window does, while it is open
  const isUnavailable = hasTray && !showMenuBarIcon

  const addFolder = async () => {
    const path = await pickFolderToWatch()
    if (!path) return
    if (settingsStore.watchedFolders.some((folder) => folder.path === path)) {
      toast.info(t('settings.dropZone.watchedFolders.add.alreadyWatched'))
      return
    }
    settingsStore.watchedFolders.push({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      path,
      isEnabled: true,
    })
    setMissingPaths((current) => current.filter((missing) => missing !== path))
  }

  const removeFolder = (id: string) => {
    const path = getStoredFolder(id)?.path
    settingsStore.watchedFolders = settingsStore.watchedFolders.filter(
      (folder) => folder.id !== id,
    )
    if (path) {
      setMissingPaths((current) =>
        current.filter((missing) => missing !== path),
      )
    }
  }

  const setFolderEnabled = async (id: string, isEnabled: boolean) => {
    const folder = getStoredFolder(id)
    if (!folder) return
    if (!isEnabled) {
      folder.isEnabled = false
      return
    }
    const path = folder.path
    setCheckingFolderId(id)
    try {
      const missing = await getMissingWatchedFolders([path])
      if (missing.includes(path)) {
        setMissingPaths((current) => [...new Set([...current, path])])
        toast.error(t('settings.dropZone.watchedFolders.stillMissing'))
        return
      }
      setMissingPaths((current) =>
        current.filter((missingPath) => missingPath !== path),
      )
      const current = getStoredFolder(id)
      if (current?.path === path) current.isEnabled = true
    } catch (error) {
      logError('Could not check watched folder', error)
      toast.error(t('settings.dropZone.watchedFolders.checkFailed'))
    } finally {
      setCheckingFolderId(null)
    }
  }

  return (
    <SettingsSection title={t('settings.watchedFolders.folders')}>
      <SettingsRow
        settingId="watchFolder"
        title={t('settings.dropZone.watchedFolders.add.title')}
        description={
          hasTray
            ? t('settings.dropZone.watchedFolders.add.description')
            : t('settings.dropZone.watchedFolders.add.description', {
                context: 'linux',
              })
        }
      >
        <div className="flex items-center gap-2">
          <InfoTooltip
            content={
              isUnavailable && (
                <Trans
                  i18nKey="settings.dropZone.turnOnTrayIcon"
                  context={TRAY_CONTEXT}
                  components={{
                    setting: (
                      <SettingLink target={{ settingId: 'showTrayIcon' }} />
                    ),
                  }}
                />
              )
            }
          />
          <Button size="sm" isDisabled={isUnavailable} onPress={addFolder}>
            {t('settings.dropZone.watchedFolders.add.button')}
          </Button>
        </div>
      </SettingsRow>
      {watchedFolders.map((folder) => {
        const name = getFolderName(folder.path)
        const isMissing = missingPaths.includes(folder.path)
        // Kept on, but not watched, until its media can be saved
        const canSave = canWatchedFolderSave(
          folder,
          settings as typeof settingsStore,
          presets as typeof presetsStore.presets,
        )
        // Its presets stay open while it cannot save, to choose one that does
        const isDisabled = isUnavailable || (!folder.isEnabled && canSave)
        const warning = isMissing
          ? t('settings.dropZone.watchedFolders.missing')
          : !canSave && (
              <Trans
                i18nKey="settings.dropZone.watchedFolders.needsSaveLocation"
                components={{
                  setting: (
                    <SettingLink target={{ settingId: 'saveLocation' }} />
                  ),
                }}
              />
            )
        return (
          <div key={folder.id} className="py-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{name}</p>
                <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
                  {folder.path}
                </p>
              </div>
              <InfoTooltip variant="warning" content={warning} />
              <Tooltip
                content={t('common.showInFileManager')}
                aria-label={t('common.showInFileManager')}
              >
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  aria-label={t('common.showNameInFileManager', { name })}
                  onPress={() => {
                    showItemInFileManager(folder.path).catch(() => {
                      toast.error(t('settings.watchedFolders.openFailed'))
                    })
                  }}
                >
                  <Icon name="fileExplorer" />
                </Button>
              </Tooltip>
              <Switch
                size="xs"
                aria-label={t('settings.dropZone.watchedFolders.watch', {
                  name,
                })}
                isSelected={folder.isEnabled && canSave}
                isDisabled={
                  isUnavailable || !canSave || checkingFolderId === folder.id
                }
                onValueChange={(isSelected) => {
                  setFolderEnabled(folder.id, isSelected)
                }}
              />
              <Tooltip
                content={t('settings.dropZone.watchedFolders.remove')}
                aria-label={t('settings.dropZone.watchedFolders.remove')}
              >
                <Button
                  isIconOnly
                  size="sm"
                  variant="flat"
                  color="danger"
                  onPress={() => removeFolder(folder.id)}
                >
                  <Icon name="trash" size={18} />
                </Button>
              </Tooltip>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {PRESET_MEDIA_TYPES.map((mediaType) => (
                <FolderPresetSelect
                  key={mediaType}
                  folder={folder as WatchedFolder}
                  mediaType={mediaType}
                  isDisabled={isDisabled}
                />
              ))}
            </div>
          </div>
        )
      })}
    </SettingsSection>
  )
}

export default WatchedFolders
