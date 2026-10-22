// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import InfoTooltip from '@/components/InfoTooltip'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import { getFolderName } from '@/hooks/useAutoCompressSync'
import { t } from '@/i18n'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore, type WatchedFolder } from '@/stores/settingsStore'
import { showItemInFileManager } from '@/tauri/commands/fs'
import {
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
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
  const { presets } = useSnapshot(presetsStore)
  const options = getPresets(mediaType, presets as Preset[])
  // The Standard preset unless another is chosen (also for a deleted one)
  const presetId = folder.presetIds?.[mediaType]
  const selectedKey = options.some((preset) => preset.id === presetId)
    ? presetId!
    : STANDARD_PRESET_ID

  return (
    <Select
      label={t('settings.dropZone.watchedFolders.preset', {
        context: mediaType,
      })}
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
  const { watchedFolders, showMenuBarIcon } = useSnapshot(settingsStore)
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
  }

  const removeFolder = (id: string) => {
    settingsStore.watchedFolders = settingsStore.watchedFolders.filter(
      (folder) => folder.id !== id,
    )
  }

  return (
    <SettingsSection title={t('settings.watchedFolders.folders')}>
      <SettingsRow
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
              isUnavailable &&
              t('settings.dropZone.turnOnTrayIcon', { context: TRAY_CONTEXT })
            }
          />
          <Button size="sm" isDisabled={isUnavailable} onPress={addFolder}>
            {t('settings.dropZone.watchedFolders.add.button')}
          </Button>
        </div>
      </SettingsRow>
      {watchedFolders.map((folder) => {
        const name = getFolderName(folder.path)
        const isDisabled = isUnavailable || !folder.isEnabled
        return (
          <div key={folder.id} className="py-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{name}</p>
                <p className="break-all text-xs text-zinc-500 dark:text-zinc-400">
                  {folder.path}
                </p>
              </div>
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
                isSelected={folder.isEnabled}
                isDisabled={isUnavailable}
                onValueChange={(isSelected) => {
                  const target = getStoredFolder(folder.id)
                  if (target) target.isEnabled = isSelected
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
