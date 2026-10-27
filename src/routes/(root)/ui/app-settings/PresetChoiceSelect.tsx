// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem, type SelectProps } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Select from '@/components/Select'
import { presetsStore } from '@/stores/presetsStore'
import {
  DEFAULT_PRESET_CHOICE,
  type Preset,
  type PresetMediaType,
} from '@/types/preset'
import { getPresetChoice } from '@/utils/presetOutput'
import { getPresets } from '../../-presets'

type PresetChoiceSelectProps = Omit<
  SelectProps,
  'children' | 'selectedKeys' | 'onSelectionChange' | 'onChange'
> & {
  mediaType: PresetMediaType
  /** The stored choice (see `getPresetChoice`) */
  value: string | null | undefined
  onChange: (choice: string) => void
}

/**
 * Picks a preset of a type of media: Default first (following the default preset, starred in
 * Settings -> Presets, which it names), then Standard & the other presets
 */
function PresetChoiceSelect(props: PresetChoiceSelectProps) {
  const { mediaType, value, onChange, ...rest } = props
  const { t } = useTranslation()
  const { presets, defaultPresetIds } = useSnapshot(presetsStore)
  const options = getPresets(mediaType, presets as Preset[])
  const defaultPresetName =
    options.find((preset) => preset.id === defaultPresetIds[mediaType])?.name ??
    options[0].name

  return (
    <Select
      {...rest}
      selectedKeys={[getPresetChoice(value, mediaType, presets as Preset[])]}
      disallowEmptySelection
      onSelectionChange={(keys) => {
        const [key] = [...keys]
        if (key) onChange(String(key))
      }}
    >
      {[
        {
          id: DEFAULT_PRESET_CHOICE,
          name: t('presets.defaultChoice', { name: defaultPresetName }),
        },
        ...options,
      ].map((preset) => (
        <SelectItem key={preset.id}>{preset.name}</SelectItem>
      ))}
    </Select>
  )
}

export default PresetChoiceSelect
