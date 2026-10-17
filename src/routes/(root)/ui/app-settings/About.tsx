import { Trans, useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Image from '@/components/Image'
import Markdown from '@/components/Markdown'
import {
  checkForUpdates,
  downloadAndInstallUpdateApp,
  updateStore,
} from '@/stores/updateStore'
import Link from '@/tauri/components/Link'
import { SettingsRow, SettingsSection } from './SettingsLayout'

function About() {
  const { t } = useTranslation()
  const {
    isUpdateAvailable,
    latestVersion,
    currentVersion,
    body,
    isChecking,
    isInstalling,
    installProgress,
    hasChecked,
  } = useSnapshot(updateStore)

  const hasNewVersion = isUpdateAvailable && latestVersion

  return (
    <>
      <div className="flex items-center gap-4 mb-12">
        <Image
          disableAnimation
          src="/logo.png"
          alt="CompressO"
          width={56}
          height={56}
        />
        <div>
          <Link href="https://compresso.codeforreal.com">
            <h2 className="text-2xl font-bold text-primary">CompressO</h2>
          </Link>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('settings.about.tagline')}
          </p>
        </div>
      </div>

      <SettingsSection title={t('settings.pages.about')}>
        <SettingsRow
          title={t('settings.about.version', {
            version: currentVersion || window.__appVersion || '',
          })}
          description={
            hasNewVersion
              ? t('settings.about.newVersion', { version: latestVersion })
              : hasChecked
                ? t('settings.about.upToDate')
                : t('settings.about.checkDescription')
          }
        >
          {hasNewVersion ? (
            <Button
              size="sm"
              className="bg-primary"
              onPress={downloadAndInstallUpdateApp}
              isLoading={isInstalling}
              isDisabled={isInstalling}
            >
              {t('settings.about.updateNow')}{' '}
              {isInstalling ? `(${installProgress}%)` : ''}
            </Button>
          ) : (
            <Button
              size="sm"
              onPress={checkForUpdates}
              isLoading={isChecking}
              isDisabled={isChecking}
            >
              {t('settings.about.checkForUpdates')}
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          title={t('settings.about.website.title')}
          description={t('settings.about.website.description')}
        >
          <Link href="https://compresso.codeforreal.com" className="text-sm">
            compresso.codeforreal.com
          </Link>
        </SettingsRow>
        <SettingsRow
          title={t('settings.about.openSource.title')}
          description={
            <Link href="https://github.com/codeforreal1/compressO/blob/main/LICENSE">
              {t('settings.about.openSource.license')}
            </Link>
          }
        >
          <Link
            href="https://github.com/codeforreal1/compressO"
            className="flex items-center gap-1 text-sm"
          >
            <Icon name="github" size={18} />
            GitHub
          </Link>
        </SettingsRow>
        <SettingsRow
          title=""
          description={
            <Trans
              i18nKey="settings.about.madeBy"
              components={{
                heart: (
                  <Icon className="inline text-primary" name="lowResHeart" />
                ),
                link: (
                  <Link href="https://codeforreal.com">Code For Real⚡</Link>
                ),
              }}
            />
          }
        />
      </SettingsSection>

      {hasNewVersion && body ? (
        <SettingsSection title={t('settings.about.releaseNotes')}>
          <div className="pt-1">
            <Markdown content={body} className="text-sm" />
          </div>
        </SettingsSection>
      ) : null}
    </>
  )
}

export default About
