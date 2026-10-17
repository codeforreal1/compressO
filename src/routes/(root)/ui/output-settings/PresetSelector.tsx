import { SelectItem } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Select from '@/components/Select'
import { toast } from '@/components/Toast'
import Tooltip from '@/components/Tooltip'
import {
  generatePresetId,
  getStoredPreset,
  presetsStore,
} from '@/stores/presetsStore'
import { ImageConfig, VideoConfig } from '@/types/app'
import {
  type Preset,
  type PresetMediaType,
  STANDARD_PRESET_ID,
} from '@/types/preset'
import SavePresetModal from './SavePresetModal'
import {
  applyPreset,
  getAudioPreset,
  getAudioPresetSettingsToSave,
  getBatchConfigKey,
  getImageConfigResolution,
  getImagePreset,
  getImagePresetSettingsToSave,
  getPreset,
  getPresets,
  getVideoConfigResolution,
  getVideoPreset,
  getVideoPresetSettingsToSave,
  hasChangesOutsidePreset,
  isAudioPresetModified,
  isImagePresetModified,
  isMediaOfPresetType,
  isVideoPresetModified,
  revertToPreset,
} from '../../-presets'
import { appProxy, normalizeBatchMediaConfig } from '../../-state'

type PresetSelectorProps = {
  mediaType: PresetMediaType
  /** A single media, or all media of the type in a batch when < 0 */
  mediaIndex: number
}

/**
 * Picks the preset of a media (or of all media of the type in a batch). Once the settings are
 * changed, they can be saved to the preset, saved as a new preset or reverted.
 */
function PresetSelector({ mediaType, mediaIndex }: PresetSelectorProps) {
  const { t } = useTranslation()
  const {
    state: {
      media,
      commonConfigForBatchCompression,
      isCompressing,
      isProcessCompleted,
      isLoadingMediaFiles,
    },
  } = useSnapshot(appProxy)
  // Read from the snapshot, so it re-renders when presets change
  const { presets: storedPresets, defaultPresetIds } = useSnapshot(presetsStore)
  const defaultPresetId = defaultPresetIds[mediaType]
  const [isSaveModalOpen, setIsSaveModalOpen] = React.useState(false)

  const mediaFile =
    mediaIndex >= 0 && isMediaOfPresetType(media[mediaIndex], mediaType)
      ? media[mediaIndex]
      : null
  const config = (mediaFile?.config ??
    commonConfigForBatchCompression[getBatchConfigKey(mediaType)]) as
    | VideoConfig
    | ImageConfig
  const sourceExtension = mediaFile?.extension ?? null
  // Read here so the selector re-renders when the batch resolution changes (videos of a batch
  // without custom dimensions follow it)
  const batchResolution =
    commonConfigForBatchCompression.videoConfig.batchResolution
  const batchLongerSide =
    commonConfigForBatchCompression.imageConfig.batchLongerSide

  const presets = getPresets(mediaType, storedPresets as Preset[])
  const preset = getPreset(
    mediaType,
    config.presetId,
    storedPresets as Preset[],
  )
  const isDefaultPreset = preset.id === STANDARD_PRESET_ID
  const isModified =
    preset.mediaType === 'audio'
      ? isAudioPresetModified(config as VideoConfig, preset, sourceExtension)
      : preset.mediaType === 'video'
        ? isVideoPresetModified(
            config as VideoConfig,
            preset,
            sourceExtension,
            getVideoConfigResolution(config as VideoConfig, {
              isBatchConfig: !mediaFile,
              batchResolution,
            }),
          )
        : isImagePresetModified(
            config as ImageConfig,
            preset,
            sourceExtension,
            getImageConfigResolution(config as ImageConfig, {
              isBatchConfig: !mediaFile,
              batchLongerSide,
            }),
          )
  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles
  const canSaveChanges = isModified && !shouldDisableInput
  // Reverting also undoes changes that are not part of presets (crop, trim, ...)
  const canRevert =
    (isModified || (!!mediaFile && hasChangesOutsidePreset(config))) &&
    !shouldDisableInput

  /** Live config the selector is for (not the snapshot) */
  const getTargetConfig = () => {
    const targetMedia =
      mediaIndex >= 0 ? appProxy.state.media[mediaIndex] : null
    if (targetMedia) {
      return isMediaOfPresetType(targetMedia, mediaType)
        ? targetMedia.config
        : null
    }
    return appProxy.state.commonConfigForBatchCompression[
      getBatchConfigKey(mediaType)
    ]
  }

  /** Points the media (or batch) to a preset whose settings now match its own */
  const linkToPreset = (presetId: string) => {
    const targetConfig = getTargetConfig()
    if (!targetConfig) return
    targetConfig.presetId = presetId
    if (mediaIndex < 0) normalizeBatchMediaConfig()
  }

  /** The settings of the media (or batch) as a preset, keeping the values skipped for it */
  const createPresetFromConfig = (
    targetConfig: VideoConfig | ImageConfig,
    { id, name }: { id: string; name: string },
  ): Preset =>
    mediaType === 'audio'
      ? {
          id,
          name,
          mediaType,
          settings: getAudioPresetSettingsToSave(
            targetConfig as VideoConfig,
            getAudioPreset(targetConfig.presetId),
          ),
        }
      : mediaType === 'video'
        ? {
            id,
            name,
            mediaType,
            settings: getVideoPresetSettingsToSave(
              targetConfig as VideoConfig,
              getVideoPreset(targetConfig.presetId),
              getVideoConfigResolution(targetConfig as VideoConfig, {
                isBatchConfig: mediaIndex < 0,
              }),
            ),
          }
        : {
            id,
            name,
            mediaType,
            settings: getImagePresetSettingsToSave(
              targetConfig as ImageConfig,
              getImagePreset(targetConfig.presetId),
              getImageConfigResolution(targetConfig as ImageConfig, {
                isBatchConfig: mediaIndex < 0,
              }),
            ),
          }

  const handleUpdatePreset = () => {
    const targetConfig = getTargetConfig()
    const storedPreset = getStoredPreset(targetConfig?.presetId)
    if (!targetConfig || !storedPreset) return
    const index = presetsStore.presets.indexOf(storedPreset)
    presetsStore.presets[index] = createPresetFromConfig(
      targetConfig,
      storedPreset,
    )
    linkToPreset(storedPreset.id)
    toast.success(t('presets.updated', { name: storedPreset.name }))
  }

  const handleSaveAsNewPreset = (name: string) => {
    const targetConfig = getTargetConfig()
    if (!targetConfig) return
    const id = generatePresetId()
    presetsStore.presets.push(
      createPresetFromConfig(targetConfig, { id, name }),
    )
    linkToPreset(id)
    setIsSaveModalOpen(false)
    toast.success(t('presets.saved', { name }))
  }

  const handleRevert = async () => {
    try {
      await revertToPreset(mediaType, mediaIndex)
    } catch {
      toast.error(t('presets.revertFailed'))
    }
  }

  const handleApplyPreset = async (presetId: string) => {
    try {
      await applyPreset(mediaType, presetId, mediaIndex)
    } catch {
      toast.error(t('presets.applyFailed'))
    }
  }

  const openSaveModal = () => setIsSaveModalOpen(true)

  return (
    <div className="mb-4">
      <div className="flex items-end">
        <Select
          fullWidth
          label={t('presets.label')}
          size="sm"
          selectedKeys={[preset.id]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const [key] = [...keys]
            if (key) handleApplyPreset(key as string)
          }}
          isDisabled={shouldDisableInput}
          className="flex-1 min-w-0"
          classNames={{
            label: '!text-gray-600 dark:!text-gray-400 text-sm',
          }}
        >
          {presets.map((p) => (
            <SelectItem
              key={p.id}
              textValue={p.name}
              // The preset applied to newly added media
              endContent={
                p.id === defaultPresetId ? (
                  <Icon
                    name="star"
                    size={14}
                    className="text-primary [&_path]:fill-current"
                  />
                ) : null
              }
            >
              {p.name}
            </SelectItem>
          ))}
        </Select>
        {/* The dropdown is full width until the settings change, then makes room for the actions */}
        <AnimatePresence initial={false}>
          {canRevert ? (
            <motion.div
              key="preset-actions"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              // Eased without a bounce: overshooting the width would make the dropdown wobble
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              className="flex-shrink-0 overflow-hidden"
            >
              {/* Fixed size inside the animated width (incl. the spacing), so the buttons are
              clipped instead of squeezed and nothing jumps when it is removed */}
              <div className="flex items-center flex-nowrap w-max pl-1">
                {/* Only changes of the preset's settings can be saved; crop, trim, ... can only be
                reverted */}
                <AnimatePresence initial={false}>
                  {canSaveChanges ? (
                    <motion.div
                      key="save-actions"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                      className="flex-shrink-0 overflow-hidden"
                    >
                      <div className="flex items-center flex-nowrap gap-1 w-max pr-1">
                        {/* The Standard preset cannot be changed, only saved as a new preset */}
                        {!isDefaultPreset ? (
                          <Button
                            isIconOnly
                            size="sm"
                            variant="solid"
                            onPress={handleUpdatePreset}
                            aria-label={t('presets.update', {
                              name: preset.name,
                            })}
                          >
                            <Tooltip
                              content={t('presets.update', {
                                name: preset.name,
                              })}
                              aria-label={t('presets.update', {
                                name: preset.name,
                              })}
                            >
                              <Icon name="tick" size={18} />
                            </Tooltip>
                          </Button>
                        ) : null}
                        <Button
                          isIconOnly
                          size="sm"
                          variant="solid"
                          onPress={openSaveModal}
                          aria-label={t('presets.saveAsNew')}
                        >
                          <Tooltip
                            content={t('presets.saveAsNew')}
                            aria-label={t('presets.saveAsNew')}
                          >
                            <Icon name="plus" size={18} />
                          </Tooltip>
                        </Button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
                <Button
                  isIconOnly
                  size="sm"
                  variant="solid"
                  onPress={handleRevert}
                  aria-label={t('presets.revert')}
                >
                  <Tooltip
                    content={t('presets.revert')}
                    aria-label={t('presets.revert')}
                  >
                    <Icon name="redo" size={18} className="-scale-x-100" />
                  </Tooltip>
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      <SavePresetModal
        isOpen={isSaveModalOpen}
        mediaType={mediaType}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveAsNewPreset}
      />
    </div>
  )
}

export default PresetSelector
