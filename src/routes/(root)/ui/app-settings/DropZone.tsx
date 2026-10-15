// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import Switch from '@/components/Switch'
import { isAutoCompressAvailable } from '@/hooks/useAutoCompressSync'
import { presetsStore } from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import type { Preset, PresetMediaType } from '@/types/preset'
import { SettingsRow, SettingsSection } from './SettingsLayout'
import { getPreset, getPresets } from '../../-presets'

/** Picks the preset of the media compressed by the drop zone */
function DropZonePresetSelect({ mediaType }: { mediaType: PresetMediaType }) {
  const { presets } = useSnapshot(presetsStore)
  const { dropZoneVideoPresetId, dropZoneImagePresetId } =
    useSnapshot(settingsStore)
  const options = getPresets(mediaType, presets as Preset[])
  // A deleted preset falls back to Standard
  const selectedPreset = getPreset(
    mediaType,
    mediaType === 'video' ? dropZoneVideoPresetId : dropZoneImagePresetId,
    presets as Preset[],
  )

  return (
    <Select
      aria-label={mediaType === 'video' ? 'Video preset' : 'Image preset'}
      selectedKeys={[selectedPreset.id]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const [key] = [...keys]
        if (!key) return
        if (mediaType === 'video') {
          settingsStore.dropZoneVideoPresetId = String(key)
        } else {
          settingsStore.dropZoneImagePresetId = String(key)
        }
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
          description={
            canAutoCompress
              ? 'Compress media as soon as it is added to the drop zone, one at a time, and save it to the save location of Output.'
              : 'Choose a save location in Output, other than Ask every time, to compress automatically.'
          }
        >
          <Switch
            aria-label="Compress automatically"
            isSelected={autoCompress && canAutoCompress}
            isDisabled={!showMenuBarIcon || !canAutoCompress}
            onValueChange={(isSelected) => {
              settingsStore.autoCompress = isSelected
            }}
          />
        </SettingsRow>
        {autoCompress && canAutoCompress ? (
          <>
            <SettingsRow
              isNested
              title="Video preset"
              description="Settings used for videos."
            >
              <DropZonePresetSelect mediaType="video" />
            </SettingsRow>
            <SettingsRow
              isNested
              title="Image preset"
              description="Settings used for images."
            >
              <DropZonePresetSelect mediaType="image" />
            </SettingsRow>
          </>
        ) : null}
      </SettingsSection>
      <SettingsSection title="Clipboard">
        <SettingsRow
          title="Watch clipboard"
          description="Add media files you copy to the drop zone in the menu bar."
        >
          <Switch
            aria-label="Watch clipboard"
            isSelected={watchClipboard}
            isDisabled={!showMenuBarIcon}
            onValueChange={(isSelected) => {
              settingsStore.watchClipboard = isSelected
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

export default DropZone
