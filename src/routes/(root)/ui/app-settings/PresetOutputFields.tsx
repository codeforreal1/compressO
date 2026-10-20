// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Select from '@/components/Select'
import TextInput from '@/components/TextInput'
import { t } from '@/i18n'
import { type SaveLocation, sanitizeFileNamePart } from '@/stores/settingsStore'
import type { PresetOutput } from '@/types/preset'
import { getStandardOutput } from '@/utils/presetOutput'

/** Asks for the folder outputs are saved to (`null` when none is chosen) */
export async function pickSaveFolder() {
  const folder = await open({
    directory: true,
    title: t('settings.output.saving.folder.dialogTitle'),
  })
  return typeof folder === 'string' ? folder : null
}

export const SAVE_LOCATION_OPTIONS: SaveLocation[] = [
  'ask',
  'fixedFolder',
  'sameFolder',
]

/** The option of following the Standard preset's output (Settings -> Output) */
const FOLLOW_STANDARD = 'standard'

type PresetOutputFieldsProps = {
  /** Its own output, or `null` to follow the Standard preset's */
  value: PresetOutput | null | undefined
  onChange: (output: PresetOutput | null) => void
  /** The Standard preset's own (it always has one, so it cannot follow itself) */
  isStandard?: boolean
}

/**
 * Where a preset's outputs are saved & their file name prefix: the same as the Standard preset
 * (the default), or its own, starting from the Standard preset's
 */
function PresetOutputFields({
  value,
  onChange,
  isStandard,
}: PresetOutputFieldsProps) {
  const { t } = useTranslation()
  const location = value?.saveLocation ?? FOLLOW_STANDARD

  const handleLocationChange = async (key: string) => {
    if (key === FOLLOW_STANDARD) {
      onChange(null)
      return
    }
    const base = value ?? getStandardOutput()
    let { saveFolder } = base
    // A fixed folder needs a folder; the previous option is kept if none is chosen
    if (key === 'fixedFolder' && !saveFolder) {
      saveFolder = await pickSaveFolder()
      if (!saveFolder) return
    }
    onChange({ ...base, saveLocation: key as SaveLocation, saveFolder })
  }

  return (
    // Side by side: where (& the folder under it) on the left, the prefix on the right
    <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2">
      <Select
        label={t('presets.output.location')}
        selectedKeys={[location]}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const [key] = [...keys]
          if (key) handleLocationChange(String(key))
        }}
        classNames={{ popoverContent: 'settings-dialog' }}
      >
        {(isStandard
          ? SAVE_LOCATION_OPTIONS
          : [FOLLOW_STANDARD, ...SAVE_LOCATION_OPTIONS]
        ).map((option) => (
          <SelectItem key={option}>
            {option === FOLLOW_STANDARD
              ? t('presets.output.followStandard')
              : t('settings.output.saving.location.option', {
                  context: option as SaveLocation,
                })}
          </SelectItem>
        ))}
      </Select>
      {value ? (
        <TextInput
          label={t('settings.output.saving.prefix.title')}
          placeholder={t('settings.output.saving.prefix.placeholder')}
          value={value.filePrefix}
          onValueChange={(prefix) =>
            onChange({ ...value, filePrefix: sanitizeFileNamePart(prefix) })
          }
        />
      ) : null}
      {value?.saveLocation === 'fixedFolder' ? (
        <div className="col-start-1 flex items-center gap-3">
          <p className="min-w-0 flex-1 break-all text-xs text-zinc-500 dark:text-zinc-400">
            {value.saveFolder ?? t('settings.output.saving.folder.none')}
          </p>
          <Button
            size="sm"
            onPress={async () => {
              const folder = await pickSaveFolder()
              if (folder) onChange({ ...value, saveFolder: folder })
            }}
          >
            {t('settings.output.saving.folder.change')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default PresetOutputFields
