import type { Translation, t as translate } from '@/i18n'
import { hasTray, TRAY_CONTEXT } from '@/utils/tray'

export type SettingsPageId = keyof Translation['settings']['pages']

type IndexedSetting = {
  page: SettingsPageId
  /** As shown in its row, so search finds what is seen */
  getText: (t: typeof translate) => string[]
  /** Only some platforms have it (e.g. the tray's settings) */
  isAvailable?: boolean
}

/**
 * The settings rows, by id: searched in the settings, & linked to from elsewhere (see
 * `openSettings`). Each row gets its id (`SettingsRow`'s `settingId`).
 */
export const SETTINGS_INDEX = {
  openAtLogin: {
    page: 'general',
    getText: (t) => [
      t('settings.general.startup.openAtLogin.title'),
      t('settings.general.startup.openAtLogin.description'),
    ],
  },
  openInTrayOnly: {
    page: 'general',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.general.startup.openInTrayOnly.title', {
        context: TRAY_CONTEXT,
      }),
      t('settings.general.startup.openInTrayOnly.description', {
        context: TRAY_CONTEXT,
      }),
    ],
  },
  language: {
    page: 'general',
    getText: (t) => [
      t('settings.general.appearance.language.title'),
      t('settings.general.appearance.language.description'),
    ],
  },
  theme: {
    page: 'general',
    getText: (t) => [
      t('settings.general.appearance.theme.title'),
      t('settings.general.appearance.theme.description'),
    ],
  },
  accentColor: {
    page: 'general',
    getText: (t) => [
      t('settings.general.appearance.accentColor.title'),
      t('settings.general.appearance.accentColor.description'),
    ],
  },
  tintedWindow: {
    page: 'general',
    getText: (t) => [
      t('settings.general.appearance.tintedWindow.title'),
      t('settings.general.appearance.tintedWindow.description'),
    ],
  },
  tintOpacity: {
    page: 'general',
    getText: (t) => [
      t('settings.general.appearance.tintOpacity.title'),
      t('settings.general.appearance.tintOpacity.description'),
    ],
  },
  showTrayIcon: {
    page: 'general',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.general.tray.showIcon.title', { context: TRAY_CONTEXT }),
      t('settings.general.tray.showIcon.description', {
        context: TRAY_CONTEXT,
      }),
    ],
  },
  audioWaveforms: {
    page: 'general',
    getText: (t) => [
      t('settings.general.sound.audioWaveforms.title'),
      t('settings.general.sound.audioWaveforms.description'),
    ],
  },
  videoPreviews: {
    page: 'general',
    getText: (t) => [
      t('settings.general.preview.videoPreviews.title'),
      t('settings.general.preview.videoPreviews.description'),
    ],
  },
  preventSleep: {
    page: 'general',
    getText: (t) => [
      t('settings.general.sleep.preventSleep.title'),
      t('settings.general.sleep.preventSleep.description'),
    ],
  },
  keepScreenOn: {
    page: 'general',
    getText: (t) => [
      t('settings.general.sleep.keepScreenOn.title'),
      t('settings.general.sleep.keepScreenOn.description'),
    ],
  },
  completionSound: {
    page: 'general',
    getText: (t) => [
      t('settings.general.sound.completionSound.title'),
      t('settings.general.sound.completionSound.description'),
    ],
  },
  logFiles: {
    page: 'general',
    getText: (t) => [
      t('settings.general.troubleshooting.logFiles.title'),
      t('settings.general.troubleshooting.logFiles.description'),
    ],
  },
  saveLocation: {
    page: 'output',
    getText: (t) => [
      t('settings.output.saving.location.title'),
      t('settings.output.saving.location.option', { context: 'ask' }),
      t('settings.output.saving.location.option', { context: 'fixedFolder' }),
      t('settings.output.saving.location.option', { context: 'sameFolder' }),
    ],
  },
  saveFolder: {
    page: 'output',
    getText: (t) => [t('settings.output.saving.folder.title')],
  },
  filePrefix: {
    page: 'output',
    getText: (t) => [
      t('settings.output.saving.prefix.title'),
      t('settings.output.saving.prefix.description'),
    ],
  },
  preserveFolders: {
    page: 'output',
    getText: (t) => [
      t('settings.output.saving.preserveFolders.title'),
      t('settings.output.saving.preserveFolders.description'),
    ],
  },
  skipLarger: {
    page: 'output',
    getText: (t) => [
      t('settings.output.saving.skipLarger.title'),
      t('settings.output.saving.skipLarger.description'),
    ],
  },
  replaceOriginal: {
    page: 'output',
    getText: (t) => [
      t('settings.output.saving.replaceOriginal.title'),
      t('settings.output.saving.replaceOriginal.description'),
    ],
  },
  copyOutput: {
    page: 'output',
    getText: (t) => [
      t('settings.output.clipboard.copyOutput.title'),
      t('settings.output.clipboard.copyOutput.description'),
    ],
  },
  copyBatchOutput: {
    page: 'output',
    getText: (t) => [
      t('settings.output.clipboard.includeBatch.title'),
      t('settings.output.clipboard.includeBatch.description'),
    ],
  },
  hardwareAcceleration: {
    page: 'output',
    getText: (t) => [
      t('settings.output.performance.hardwareAcceleration.title'),
      t('settings.output.performance.hardwareAcceleration.description'),
    ],
  },
  retryTargetSizeOnCpu: {
    page: 'output',
    getText: (t) => [
      t('settings.output.performance.retryTargetSizeOnCpu.title'),
      t('settings.output.performance.retryTargetSizeOnCpu.description'),
    ],
  },
  clearCache: {
    page: 'output',
    getText: (t) => [
      t('settings.output.storage.clearCache.title'),
      t('settings.output.storage.clearCache.description'),
    ],
  },
  autoCompress: {
    page: 'dropZone',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.dropZone.compression.autoCompress.title'),
      t('settings.dropZone.compression.autoCompress.description'),
    ],
  },
  dropZoneVideoPreset: {
    page: 'dropZone',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.dropZone.preset.title_video'),
      t('settings.dropZone.preset.description_video'),
    ],
  },
  dropZoneImagePreset: {
    page: 'dropZone',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.dropZone.preset.title_image'),
      t('settings.dropZone.preset.description_image'),
    ],
  },
  dropZoneAudioPreset: {
    page: 'dropZone',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.dropZone.preset.title_audio'),
      t('settings.dropZone.preset.description_audio'),
    ],
  },
  watchClipboard: {
    page: 'dropZone',
    isAvailable: hasTray,
    getText: (t) => [
      t('settings.dropZone.clipboard.watch.title'),
      t('settings.dropZone.clipboard.watch.description', {
        context: TRAY_CONTEXT,
      }),
    ],
  },
  watchFolder: {
    page: 'watchedFolders',
    getText: (t) => [
      t('settings.dropZone.watchedFolders.add.title'),
      hasTray
        ? t('settings.dropZone.watchedFolders.add.description')
        : t('settings.dropZone.watchedFolders.add.description', {
            context: 'linux',
          }),
    ],
  },
} satisfies Record<string, IndexedSetting>

export type SettingId = keyof typeof SETTINGS_INDEX

/** Where to open the settings: a page, or a setting (on its page) */
export type SettingsTarget = { page: SettingsPageId } | { settingId: SettingId }
