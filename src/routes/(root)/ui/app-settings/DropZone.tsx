import { Trans, useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import InfoTooltip from '@/components/InfoTooltip'
import SettingLink from '@/components/SettingLink'
import Switch from '@/components/Switch'
import { useIsAutoCompressAvailable } from '@/hooks/useAutoCompressSync'
import { settingsStore } from '@/stores/settingsStore'
import type { PresetMediaType } from '@/types/preset'
import { DROP_ZONE_PRESET_SETTINGS } from '@/utils/presetOutput'
import { TRAY_CONTEXT } from '@/utils/tray'
import PresetChoiceSelect from './PresetChoiceSelect'
import { SettingsRow, SettingsSection } from './SettingsLayout'

/** Picks the preset of the media compressed by the drop zone (Default unless chosen) */
function DropZonePresetSelect({ mediaType }: { mediaType: PresetMediaType }) {
  const { t } = useTranslation()
  const settings = useSnapshot(settingsStore)
  const settingKey = DROP_ZONE_PRESET_SETTINGS[mediaType]

  return (
    <PresetChoiceSelect
      aria-label={t('settings.dropZone.preset.title', { context: mediaType })}
      mediaType={mediaType}
      value={settings[settingKey]}
      onChange={(choice) => {
        settingsStore[settingKey] = choice
      }}
      className="w-[220px]"
      classNames={{ popoverContent: 'settings-dialog' }}
    />
  )
}

/** Settings of the drop zone in the menu bar (macOS only) */
function DropZone() {
  const { t } = useTranslation()
  const { showMenuBarIcon, watchClipboard, autoCompress } =
    useSnapshot(settingsStore)
  const canAutoCompress = useIsAutoCompressAvailable()

  return (
    <>
      <SettingsSection title={t('settings.dropZone.compression.title')}>
        <SettingsRow
          settingId="autoCompress"
          title={t('settings.dropZone.compression.autoCompress.title')}
          description={t(
            'settings.dropZone.compression.autoCompress.description',
          )}
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !showMenuBarIcon ? (
                  <Trans
                    i18nKey="settings.dropZone.turnOnTrayIcon"
                    context={TRAY_CONTEXT}
                    components={{
                      setting: (
                        <SettingLink target={{ settingId: 'showTrayIcon' }} />
                      ),
                    }}
                  />
                ) : !canAutoCompress ? (
                  <Trans
                    i18nKey="settings.dropZone.compression.autoCompress.needsSaveLocation"
                    components={{
                      setting: (
                        <SettingLink target={{ settingId: 'saveLocation' }} />
                      ),
                    }}
                  />
                ) : null
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
          settingId="dropZoneVideoPreset"
          isVisible={autoCompress && canAutoCompress}
          isNested
          title={t('settings.dropZone.preset.title_video')}
          description={t('settings.dropZone.preset.description_video')}
        >
          <DropZonePresetSelect mediaType="video" />
        </SettingsRow>
        <SettingsRow
          settingId="dropZoneImagePreset"
          isVisible={autoCompress && canAutoCompress}
          isNested
          title={t('settings.dropZone.preset.title_image')}
          description={t('settings.dropZone.preset.description_image')}
        >
          <DropZonePresetSelect mediaType="image" />
        </SettingsRow>
        <SettingsRow
          settingId="dropZoneAudioPreset"
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
          settingId="watchClipboard"
          title={t('settings.dropZone.clipboard.watch.title')}
          description={t('settings.dropZone.clipboard.watch.description', {
            context: TRAY_CONTEXT,
          })}
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !showMenuBarIcon && (
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
