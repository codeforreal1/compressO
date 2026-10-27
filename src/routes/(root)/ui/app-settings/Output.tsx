// The item must be HeroUI's own (not a wrapper) so the Select can build its collection
import { SelectItem } from '@heroui/react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import AnimatedLabel from '@/components/AnimatedLabel'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import InfoTooltip from '@/components/InfoTooltip'
import Select from '@/components/Select'
import Switch from '@/components/Switch'
import TextInput from '@/components/TextInput'
import { toast } from '@/components/Toast'
import { useHardwareEncoders } from '@/hooks/useHardwareEncoding'
import {
  type SaveLocation,
  sanitizeFileNamePart,
  settingsStore,
} from '@/stores/settingsStore'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
import { getPlatform } from '@/utils/fs'
import { pickSaveFolder, SAVE_LOCATION_OPTIONS } from './PresetOutputFields'
import { SettingsRow, SettingsSection } from './SettingsLayout'
import { appProxy } from '../../-state'

/**
 * The cache holds the thumbnails & unsaved outputs of the media being worked on, so it can only be
 * cleared from the home screen (settings can also be opened with a shortcut while editing).
 */
function isOnHomeScreen() {
  const { media, isLoadingMediaFiles, isCompressing } = appProxy.state
  return media.length === 0 && !isLoadingMediaFiles && !isCompressing
}

function Output() {
  const { t } = useTranslation()
  const [confirmClearCache, setConfirmClearCache] = React.useState(false)
  const [isCacheDeleting, setIsCacheDeleting] = React.useState(false)
  const {
    saveLargerOutputs,
    replaceOriginalFiles,
    preserveFolderStructure,
    copyOutputToClipboard,
    copyBatchOutputToClipboard,
    useHardwareAcceleration,
    retryTargetSizeOnCpu,
  } = useSnapshot(settingsStore)
  const { outputFilePrefix, saveLocation, saveFolder } =
    useSnapshot(settingsStore)
  // `null` while hardware acceleration is being checked (when the app starts)
  const hardwareEncoders = useHardwareEncoders()
  const hasHardwareAcceleration =
    hardwareEncoders == null || hardwareEncoders.length > 0

  const handleSaveLocationChange = async (location: SaveLocation) => {
    // A fixed folder needs a folder; keep the previous option if none is chosen
    if (location === 'fixedFolder' && !settingsStore.saveFolder) {
      const folder = await pickSaveFolder()
      if (!folder) return
      settingsStore.saveFolder = folder
    }
    settingsStore.saveLocation = location
  }

  // Read from the snapshot so the button updates if the screen changes while the dialog is open
  const {
    state: { media, isLoadingMediaFiles, isCompressing },
  } = useSnapshot(appProxy)
  const canClearCache =
    media.length === 0 && !isLoadingMediaFiles && !isCompressing

  const deleteCache = async () => {
    if (!isOnHomeScreen()) return
    setIsCacheDeleting(true)
    try {
      await invokeDeleteCache()
      toast.success(t('settings.output.storage.clearCache.cleared'))
      setConfirmClearCache(false)
    } catch (_) {
      toast.error(t('settings.output.storage.clearCache.failed'))
    }
    setIsCacheDeleting(false)
  }

  return (
    <>
      {/* The Standard preset's output (for videos, images & audio); other presets can have their
          own, in Presets (see `getPresetOutput`) */}
      <SettingsSection
        title={t('settings.output.saving.title')}
        description={t('settings.output.saving.appliesTo')}
      >
        <SettingsRow
          settingId="saveLocation"
          title={t('settings.output.saving.location.title')}
          description={t('settings.output.saving.location.description', {
            context: saveLocation,
          })}
        >
          <Select
            aria-label={t('settings.output.saving.location.title')}
            selectedKeys={[saveLocation]}
            disallowEmptySelection
            onSelectionChange={(keys) => {
              const [key] = [...keys]
              if (key) handleSaveLocationChange(key as SaveLocation)
            }}
            className="w-[220px]"
            classNames={{ popoverContent: 'settings-dialog' }}
          >
            {SAVE_LOCATION_OPTIONS.map((option) => (
              <SelectItem key={option}>
                {t('settings.output.saving.location.option', {
                  context: option,
                })}
              </SelectItem>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow
          settingId="saveFolder"
          isVisible={saveLocation === 'fixedFolder'}
          isNested
          title={t('settings.output.saving.folder.title')}
          description={
            <span className="break-all">
              {saveFolder ?? t('settings.output.saving.folder.none')}
            </span>
          }
        >
          <Button
            size="sm"
            onPress={async () => {
              const folder = await pickSaveFolder()
              if (folder) settingsStore.saveFolder = folder
            }}
          >
            {t('settings.output.saving.folder.change')}
          </Button>
        </SettingsRow>
        <SettingsRow
          settingId="filePrefix"
          title={t('settings.output.saving.prefix.title')}
          description={t('settings.output.saving.prefix.description')}
        >
          <TextInput
            aria-label={t('settings.output.saving.prefix.title')}
            placeholder={t('settings.output.saving.prefix.placeholder')}
            value={outputFilePrefix}
            onValueChange={(value) => {
              settingsStore.outputFilePrefix = sanitizeFileNamePart(value)
            }}
            className="w-[180px]"
          />
        </SettingsRow>
      </SettingsSection>

      {/* How outputs are saved, for every preset */}
      <SettingsSection title={t('settings.output.savedFiles.title')}>
        <SettingsRow
          settingId="preserveFolders"
          title={t('settings.output.saving.preserveFolders.title')}
          description={t('settings.output.saving.preserveFolders.description')}
        >
          <Switch
            aria-label={t('settings.output.saving.preserveFolders.title')}
            isSelected={preserveFolderStructure}
            onValueChange={(isSelected) => {
              settingsStore.preserveFolderStructure = isSelected
            }}
          />
        </SettingsRow>
        <SettingsRow
          settingId="skipLarger"
          title={t('settings.output.saving.skipLarger.title')}
          description={t('settings.output.saving.skipLarger.description')}
        >
          <Switch
            aria-label={t('settings.output.saving.skipLarger.title')}
            isSelected={!saveLargerOutputs}
            onValueChange={(isSelected) => {
              settingsStore.saveLargerOutputs = !isSelected
            }}
          />
        </SettingsRow>
        <SettingsRow
          settingId="replaceOriginal"
          title={t('settings.output.saving.replaceOriginal.title')}
          // The Recycle Bin on Windows, the Trash elsewhere
          description={t('settings.output.saving.replaceOriginal.description', {
            context: getPlatform().isWindows ? 'windows' : undefined,
          })}
        >
          <Switch
            aria-label={t('settings.output.saving.replaceOriginal.title')}
            isSelected={replaceOriginalFiles}
            onValueChange={(isSelected) => {
              settingsStore.replaceOriginalFiles = isSelected
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.output.clipboard.title')}>
        <SettingsRow
          settingId="copyOutput"
          title={t('settings.output.clipboard.copyOutput.title')}
          description={t('settings.output.clipboard.copyOutput.description')}
        >
          <Switch
            aria-label={t('settings.output.clipboard.copyOutput.title')}
            isSelected={copyOutputToClipboard}
            onValueChange={(isSelected) => {
              settingsStore.copyOutputToClipboard = isSelected
              // Batch outputs are included again whenever copying is turned on
              if (isSelected) settingsStore.copyBatchOutputToClipboard = true
            }}
          />
        </SettingsRow>
        <SettingsRow
          settingId="copyBatchOutput"
          isVisible={copyOutputToClipboard}
          isNested
          title={t('settings.output.clipboard.includeBatch.title')}
          description={t('settings.output.clipboard.includeBatch.description')}
        >
          <Switch
            aria-label={t('settings.output.clipboard.includeBatch.title')}
            isSelected={copyBatchOutputToClipboard}
            onValueChange={(isSelected) => {
              settingsStore.copyBatchOutputToClipboard = isSelected
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.output.performance.title')}>
        <SettingsRow
          settingId="hardwareAcceleration"
          title={t('settings.output.performance.hardwareAcceleration.title')}
          description={t(
            'settings.output.performance.hardwareAcceleration.description',
          )}
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !hasHardwareAcceleration &&
                t(
                  'settings.output.performance.hardwareAcceleration.unavailable',
                )
              }
            />
            <Switch
              aria-label={t(
                'settings.output.performance.hardwareAcceleration.title',
              )}
              isSelected={useHardwareAcceleration && hasHardwareAcceleration}
              isDisabled={!hasHardwareAcceleration}
              onValueChange={(isSelected) => {
                settingsStore.useHardwareAcceleration = isSelected
              }}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          settingId="retryTargetSizeOnCpu"
          isVisible={useHardwareAcceleration && hasHardwareAcceleration}
          isNested
          title={t('settings.output.performance.retryTargetSizeOnCpu.title')}
          description={t(
            'settings.output.performance.retryTargetSizeOnCpu.description',
          )}
        >
          <Switch
            aria-label={t(
              'settings.output.performance.retryTargetSizeOnCpu.title',
            )}
            isSelected={retryTargetSizeOnCpu}
            onValueChange={(isSelected) => {
              settingsStore.retryTargetSizeOnCpu = isSelected
            }}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t('settings.output.storage.title')}>
        <SettingsRow
          settingId="clearCache"
          title={t('settings.output.storage.clearCache.title')}
          description={t('settings.output.storage.clearCache.description')}
        >
          <div className="flex items-center gap-2">
            <InfoTooltip
              content={
                !canClearCache &&
                t('settings.output.storage.clearCache.mediaOpen')
              }
            />
            <Button
              isDisabled={!canClearCache}
              size="sm"
              color="danger"
              variant={confirmClearCache ? 'solid' : 'flat'}
              isIconOnly={!confirmClearCache}
              onPress={() => {
                if (!confirmClearCache) {
                  setConfirmClearCache(true)
                } else {
                  deleteCache()
                }
              }}
              isLoading={isCacheDeleting}
            >
              <Icon name="trash" />
              <AnimatedLabel>
                {confirmClearCache
                  ? t('settings.output.storage.clearCache.confirm')
                  : ''}
              </AnimatedLabel>
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}

export default Output
