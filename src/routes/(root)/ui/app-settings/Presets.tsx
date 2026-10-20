import cloneDeep from 'lodash/cloneDeep'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import AnimatedLabel from '@/components/AnimatedLabel'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import TextInput from '@/components/TextInput'
import Tooltip from '@/components/Tooltip'
import { t } from '@/i18n'
import {
  generatePresetId,
  getAvailablePresetName,
  getStoredPreset,
  movePreset,
  presetsStore,
  setDefaultPreset,
} from '@/stores/presetsStore'
import { settingsStore } from '@/stores/settingsStore'
import {
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import { getStandardOutput } from '@/utils/presetOutput'
import PresetOutputFields from './PresetOutputFields'
import { SettingsSection } from './SettingsLayout'
import {
  deletePresetAndUnlinkMedia,
  describeAudioPresetSettings,
  describeImagePresetSettings,
  describeVideoPresetSettings,
  getPreset as getPresetOfType,
} from '../../-presets'

function describePreset(preset: Preset) {
  switch (preset.mediaType) {
    case 'video':
      return describeVideoPresetSettings(preset.settings).join(' · ')
    case 'audio':
      return describeAudioPresetSettings(preset.settings).join(' · ')
    default:
      return describeImagePresetSettings(preset.settings).join(' · ')
  }
}

/** A copy of a preset, right after it (a copy of the Standard preset comes first) */
function duplicatePreset(preset: Preset) {
  const storedPreset = getStoredPreset(preset.id)
  const index = storedPreset ? presetsStore.presets.indexOf(storedPreset) : -1
  presetsStore.presets.splice(index + 1, 0, {
    ...cloneDeep(storedPreset ?? preset),
    id: generatePresetId(),
    name: getAvailablePresetName(
      t('settings.presets.copyName', { name: preset.name }),
      preset.mediaType,
    ),
  })
}

type PresetCardProps = {
  preset: Preset
  isFirst: boolean
  isLast: boolean
  /** Applied to newly added media of its type */
  isDefault: boolean
}

function PresetCard({ preset, isFirst, isLast, isDefault }: PresetCardProps) {
  const { t } = useTranslation()
  // The built-in preset: listed first, & only set as the default or copied (its settings & output
  // are those of the app)
  const isStandard = preset.id === STANDARD_PRESET_ID
  const standardOutput = getStandardOutput(useSnapshot(settingsStore))
  const defaultTooltip = isDefault
    ? t('settings.presets.isDefault', { context: preset.mediaType })
    : t('settings.presets.setDefault', { context: preset.mediaType })
  const [name, setName] = React.useState(preset.name)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  React.useEffect(() => {
    setName(preset.name)
  }, [preset.name])

  /** Live (not snapshot) preset, to be changed */
  const getPreset = () => getStoredPreset(preset.id)

  const commitName = () => {
    const target = getPreset()
    const trimmedName = name.trim()
    if (!target || !trimmedName || trimmedName === target.name) {
      setName(preset.name)
      return
    }
    const isNameTaken =
      trimmedName.toLowerCase() === 'standard' ||
      presetsStore.presets.some(
        (p) =>
          p.id !== target.id &&
          p.mediaType === target.mediaType &&
          p.name.toLowerCase() === trimmedName.toLowerCase(),
      )
    if (isNameTaken) {
      setName(preset.name)
      return
    }
    target.name = trimmedName
  }

  return (
    <div className="py-4 first:pt-1">
      <div className="flex items-center gap-2">
        <TextInput
          aria-label={t('settings.presets.name')}
          isReadOnly={isStandard}
          value={name}
          maxLength={40}
          onValueChange={setName}
          onBlur={commitName}
          onKeyDown={(evt) => {
            if (evt.key === 'Enter') (evt.target as HTMLInputElement).blur()
          }}
          className="max-w-[260px]"
        />
        <div className="flex items-center gap-1 ml-auto">
          <Tooltip content={defaultTooltip} aria-label={defaultTooltip}>
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color={isDefault ? 'primary' : 'default'}
              onPress={() =>
                setDefaultPreset(
                  preset.mediaType,
                  isDefault ? STANDARD_PRESET_ID : preset.id,
                )
              }
              // The Standard preset is the default unless another is chosen
              isDisabled={isStandard && isDefault}
              aria-pressed={isDefault}
            >
              <Icon
                name="star"
                className={isDefault ? '[&_path]:fill-current' : undefined}
              />
            </Button>
          </Tooltip>
          <Tooltip
            content={t('settings.presets.moveUp')}
            aria-label={t('settings.presets.moveUp')}
          >
            <Button
              isIconOnly
              size="sm"
              variant="light"
              isDisabled={isFirst}
              onPress={() => movePreset(preset.id, -1)}
            >
              <Icon name="chevron" className="rotate-180" />
            </Button>
          </Tooltip>
          <Tooltip
            content={t('settings.presets.moveDown')}
            aria-label={t('settings.presets.moveDown')}
          >
            <Button
              isIconOnly
              size="sm"
              variant="light"
              isDisabled={isLast}
              onPress={() => movePreset(preset.id, 1)}
            >
              <Icon name="chevron" />
            </Button>
          </Tooltip>
          <Tooltip
            content={t('settings.presets.duplicate')}
            aria-label={t('settings.presets.duplicate')}
          >
            <Button
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => duplicatePreset(preset)}
            >
              <Icon name="copy" />
            </Button>
          </Tooltip>
          {/* The Standard preset cannot be deleted (its place is kept, so the buttons line up) */}
          {isStandard ? (
            <span aria-hidden="true" className="w-8" />
          ) : (
            <Button
              size="sm"
              color="danger"
              variant={confirmDelete ? 'solid' : 'light'}
              // The same size as the icon buttons beside it, growing smoothly into "Delete"
              className="min-w-8 px-2 gap-0"
              onPress={() => {
                if (confirmDelete) {
                  deletePresetAndUnlinkMedia(preset.id)
                } else {
                  setConfirmDelete(true)
                }
              }}
              onBlur={() => setConfirmDelete(false)}
              aria-label={t('settings.presets.delete')}
            >
              <Icon name="trash" />
              <AnimatedLabel textClassName="pl-1.5">
                {confirmDelete ? t('common.delete') : ''}
              </AnimatedLabel>
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
        {describePreset(preset)}
      </p>
      <div className="mt-3 max-w-[560px]">
        {isStandard ? (
          // The Standard preset's output is kept in the settings (also used by presets following it)
          <PresetOutputFields
            isStandard
            value={standardOutput}
            onChange={(output) => {
              if (!output) return
              settingsStore.saveLocation = output.saveLocation
              settingsStore.saveFolder = output.saveFolder
              settingsStore.outputFilePrefix = output.filePrefix
            }}
          />
        ) : (
          <PresetOutputFields
            value={preset.output}
            onChange={(output) => {
              const target = getPreset()
              if (target) target.output = output
            }}
          />
        )}
      </div>
    </div>
  )
}

function PresetList({ mediaType }: { mediaType: PresetMediaType }) {
  const { presets, defaultPresetIds } = useSnapshot(presetsStore)
  const presetsOfType = presets.filter(
    (preset) => preset.mediaType === mediaType,
  ) as Preset[]
  const { t } = useTranslation()

  return (
    <SettingsSection
      title={t('settings.presets.title', { context: mediaType })}
    >
      {/* Always first, & never moved */}
      <PresetCard
        preset={getPresetOfType(mediaType, STANDARD_PRESET_ID)}
        isFirst
        isLast
        isDefault={defaultPresetIds[mediaType] === STANDARD_PRESET_ID}
      />
      {presetsOfType.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">
          {t('settings.presets.empty', { context: mediaType })}
        </p>
      ) : (
        presetsOfType.map((preset, index) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isFirst={index === 0}
            isLast={index === presetsOfType.length - 1}
            isDefault={defaultPresetIds[mediaType] === preset.id}
          />
        ))
      )}
    </SettingsSection>
  )
}

function Presets() {
  return (
    <>
      <PresetList mediaType="video" />
      <PresetList mediaType="image" />
      <PresetList mediaType="audio" />
    </>
  )
}

export default Presets
