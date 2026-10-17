// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { useSnapshot } from 'valtio'

import InfoTooltip from '@/components/InfoTooltip'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import { isAutoCompressAvailable } from '@/hooks/useAutoCompressSync'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import {
  PRESET_MEDIA_LABELS,
  type Preset,
  type PresetMediaType,
} from '@/types/preset'
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
      aria-label={`${PRESET_MEDIA_LABELS[mediaType].title} preset`}
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
          The drop zone is in the menu bar, so it only works when Show menu bar
          icon is turned on in General.
        </p>
      ) : null}
      <SettingsSection title="Compression">
        <SettingsRow
          title="Compress automatically"
          description="Compress media as soon as it is added to the drop zone, one at a time, and save it to the save location of Output."
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !showMenuBarIcon
                  ? 'The drop zone is in the menu bar. Turn on Show menu bar icon in General first.'
                  : !canAutoCompress
                    ? 'Choose a save location in Output, other than Ask every time, so the compressed media can be saved without asking.'
                    : null
              }
            />
            <Switch
              aria-label="Compress automatically"
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
          title="Video preset"
          description="Settings used for videos."
        >
          <DropZonePresetSelect mediaType="video" />
        </SettingsRow>
        <SettingsRow
          isVisible={autoCompress && canAutoCompress}
          isNested
          title="Image preset"
          description="Settings used for images."
        >
          <DropZonePresetSelect mediaType="image" />
        </SettingsRow>
        <SettingsRow
          isVisible={autoCompress && canAutoCompress}
          isNested
          title="Audio preset"
          description="Settings used for audio files."
        >
          <DropZonePresetSelect mediaType="audio" />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Clipboard">
        <SettingsRow
          title="Watch clipboard"
          description="Add media you copy, such as files or images from a browser, to the drop zone in the menu bar."
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !showMenuBarIcon &&
                'The drop zone is in the menu bar. Turn on Show menu bar icon in General first.'
              }
            />
            <Switch
              aria-label="Watch clipboard"
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
