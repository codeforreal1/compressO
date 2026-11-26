// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import { open } from '@tauri-apps/plugin-dialog'
import React from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/components/Button'
import Select from '@/components/Select'
import TextInput from '@/components/TextInput'
import { t } from '@/i18n'
import type { SaveLocation } from '@/stores/settingsStore'
import type { PresetOutput } from '@/types/preset'
import {
  applyFileNameTemplate,
  FILE_NAME_TOKENS,
  getLegacyPrefixFromTemplate,
  sanitizeFileNamePart,
} from '@/utils/fileNameTemplate'
import { getStandardOutput } from '@/utils/presetOutput'
import { cn } from '@/utils/tailwind'

/** Asks for the folder outputs are saved to (`null` when none is chosen) */
export async function pickSaveFolder() {
  const folder = await open({
    directory: true,
    title: t('settings.output.saving.folder.dialogTitle'),
  })
  return typeof folder === 'string' ? folder : null
}

export const SAVE_LOCATION_OPTIONS: SaveLocation[] = [
  'sameFolder',
  'fixedFolder',
  'ask',
]

/** The option of following the Standard preset's output (Settings -> Output) */
const FOLLOW_STANDARD = 'standard'

type FileNameTemplateFieldProps = {
  value: string
  onChange: (template: string) => void
  label?: string
  ariaLabel?: string
  presetName?: string
  className?: string
}

/**
 * Editable file name template input with clickable token chips (`{name}`, `{date}`, `{time}`,
 * `{preset}`) and a live output file name preview.
 */
export function FileNameTemplateField({
  value,
  onChange,
  label,
  ariaLabel,
  presetName = 'Standard',
  className,
}: FileNameTemplateFieldProps) {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const preview = applyFileNameTemplate('video.mp4', value, { presetName })

  const insertToken = (token: string) => {
    const input = inputRef.current
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? value.length
    const next = sanitizeFileNamePart(
      `${value.slice(0, start)}${token}${value.slice(end)}`,
    )
    onChange(next)
    requestAnimationFrame(() => {
      if (!input) return
      const cursor = start + token.length
      input.focus()
      input.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <TextInput
        ref={inputRef}
        label={label}
        aria-label={ariaLabel ?? label}
        placeholder={t('settings.output.saving.prefix.placeholder')}
        value={value}
        onValueChange={(next) => onChange(sanitizeFileNamePart(next))}
      />
      <div className="flex flex-wrap items-center gap-1">
        {FILE_NAME_TOKENS.map((token) => (
          <button
            key={token}
            type="button"
            onClick={() => insertToken(token)}
            className="rounded-md border border-black/10 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.07] dark:hover:bg-white/[0.1] transition-colors"
          >
            {token}
          </button>
        ))}
      </div>
      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {t('settings.output.saving.prefix.preview', { example: preview })}
      </p>
    </div>
  )
}

type PresetOutputFieldsProps = {
  /** Its own output, or `null` to follow the Standard preset's */
  value: PresetOutput | null | undefined
  onChange: (output: PresetOutput | null) => void
  presetName?: string
}

/**
 * Where a preset's outputs are saved & their file name template: the same as the Standard preset
 * (the default), or its own, starting from the Standard preset's
 */
function PresetOutputFields({
  value,
  onChange,
  presetName,
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
    // Side by side: where (& the folder under it) on the left, the naming template on the right
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
        {[FOLLOW_STANDARD, ...SAVE_LOCATION_OPTIONS].map((option) => (
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
        <FileNameTemplateField
          label={t('settings.output.saving.prefix.title')}
          value={value.fileNameTemplate}
          presetName={presetName}
          onChange={(fileNameTemplate) =>
            onChange({
              ...value,
              fileNameTemplate,
              filePrefix: getLegacyPrefixFromTemplate(fileNameTemplate),
            })
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
