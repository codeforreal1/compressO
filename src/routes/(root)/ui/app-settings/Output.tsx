import React from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import AnimatedLabel from '@/components/AnimatedLabel'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import InfoTooltip from '@/components/InfoTooltip'
import Switch from '@/components/Switch'
import { toast } from '@/components/Toast'
import { useHardwareEncoders } from '@/hooks/useHardwareEncoding'
import { settingsStore } from '@/stores/settingsStore'
import { deleteCache as invokeDeleteCache } from '@/tauri/commands/fs'
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
    preserveFolderStructure,
    copyOutputToClipboard,
    copyBatchOutputToClipboard,
    useHardwareAcceleration,
    retryTargetSizeOnCpu,
  } = useSnapshot(settingsStore)
  // `null` while hardware acceleration is being checked (when the app starts)
  const hardwareEncoders = useHardwareEncoders()
  const hasHardwareAcceleration =
    hardwareEncoders == null || hardwareEncoders.length > 0

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
      {/* Where outputs are saved & their prefix are set per preset (the Standard one too), in
          Presets; these apply to every preset */}
      <SettingsSection title={t('settings.output.saving.title')}>
        <SettingsRow
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
      </SettingsSection>

      <SettingsSection title={t('settings.output.clipboard.title')}>
        <SettingsRow
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
