// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import InfoTooltip from '@/components/InfoTooltip'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import { isAutoCompressAvailable } from '@/hooks/useAutoCompressSync'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import type { Preset, PresetMediaType } from '@/types/preset'
import { TRAY_CONTEXT } from '@/utils/tray'
import { SettingsRow, SettingsSection } from './SettingsLayout'
import { getPreset, getPresets } from '../../-presets'

/** Setting of the preset each type of media is compressed with by the drop zone */
const DROP_ZONE_PRESET_SETTINGS = {
  video: 'dropZoneVideoPresetId',
  image: 'dropZoneImagePresetId',
  audio: 'dropZoneAudioPresetId',
} as const satisfies Record<PresetMediaType, keyof typeof settingsStore>

/** Picks the preset of the media compressed by the drop zone */
function DropZonePresetSelect({ mediaType }: { mediaType: PresetMediaType }) {
  const { t } = useTranslation()
  const { presets } = useSnapshot(presetsStore)
  const settings = useSnapshot(settingsStore)
  const settingKey = DROP_ZONE_PRESET_SETTINGS[mediaType]
  const options = getPresets(mediaType, presets as Preset[])
  // A deleted preset falls back to Standard
  const selectedPreset = getPreset(
    mediaType,
    settings[settingKey],
    presets as Preset[],
  )

  return (
    <Select
      aria-label={t('settings.dropZone.preset.title', { context: mediaType })}
      selectedKeys={[selectedPreset.id]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const [key] = [...keys]
        if (!key) return
        settingsStore[settingKey] = String(key)
      }}
      className="w-[220px]"
      classNames={{ popoverContent: 'settings-dialog' }}
    >
      {options.map((preset) => (
        <SelectItem key={preset.id}>{preset.name}</SelectItem>
      ))}
    </Select>
  )
}

/** Settings of the drop zone in the menu bar (macOS only) */
function DropZone() {
  const { t } = useTranslation()
  const {
    showMenuBarIcon,
    watchClipboard,
    autoCompress,
    // Read so it updates when the save location changes
    saveLocation,
    saveFolder,
  } = useSnapshot(settingsStore)
  const canAutoCompress = isAutoCompressAvailable({ saveLocation, saveFolder })

  return (
    <>
      {/* Only needed while the drop zone cannot be used */}
      {!showMenuBarIcon ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-8">
          {t('settings.dropZone.needsTrayIcon', { context: TRAY_CONTEXT })}
        </p>
      ) : null}
      <SettingsSection title={t('settings.dropZone.compression.title')}>
        <SettingsRow
          title={t('settings.dropZone.compression.autoCompress.title')}
          description={t(
            'settings.dropZone.compression.autoCompress.description',
          )}
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !showMenuBarIcon
                  ? t('settings.dropZone.turnOnTrayIcon', {
                      context: TRAY_CONTEXT,
                    })
                  : !canAutoCompress
                    ? t(
                        'settings.dropZone.compression.autoCompress.needsSaveLocation',
                      )
                    : null
              }
            />
            <Switch
              aria-label={t('settings.dropZone.compression.autoCompress.title')}
              isSelected={autoCompress && canAutoCompress}
              isDisabled={!showMenuBarIcon || !canAutoCompress}
              onValueChange={(isSelected) => {
                settingsStore.autoCompress = isSelected
              }}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          isVisible={autoCompress && canAutoCompress}
          isNested
          title={t('settings.dropZone.preset.title_video')}
          description={t('settings.dropZone.preset.description_video')}
        >
          <DropZonePresetSelect mediaType="video" />
        </SettingsRow>
        <SettingsRow
          isVisible={autoCompress && canAutoCompress}
          isNested
          title={t('settings.dropZone.preset.title_image')}
          description={t('settings.dropZone.preset.description_image')}
        >
          <DropZonePresetSelect mediaType="image" />
        </SettingsRow>
        <SettingsRow
          isVisible={autoCompress && canAutoCompress}
          isNested
          title={t('settings.dropZone.preset.title_audio')}
          description={t('settings.dropZone.preset.description_audio')}
        >
          <DropZonePresetSelect mediaType="audio" />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t('settings.dropZone.clipboard.title')}>
        <SettingsRow
          title={t('settings.dropZone.clipboard.watch.title')}
          description={t('settings.dropZone.clipboard.watch.description', {
            context: TRAY_CONTEXT,
          })}
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !showMenuBarIcon &&
                t('settings.dropZone.turnOnTrayIcon', { context: TRAY_CONTEXT })
              }
            />
            <Switch
              aria-label={t('settings.dropZone.clipboard.watch.title')}
              isSelected={watchClipboard}
              isDisabled={!showMenuBarIcon}
              onValueChange={(isSelected) => {
                settingsStore.watchClipboard = isSelected
              }}
            />
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

export default DropZone
