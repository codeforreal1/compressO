import { open } from '@tauri-apps/plugin-shell'
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

/** Every version's changelog, on the website */
const CHANGELOG_URL = 'https://compresso.codeforreal.com/changelog'
/** The releases on GitHub, each with its changelog */
const RELEASES_URL = 'https://github.com/codeforreal1/compressO/releases/tag'

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
              color="primary"
              variant="solid"
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
          title={t('settings.about.changelog.title')}
          description={t('settings.about.changelog.description')}
        >
          <Button
            size="sm"
            onPress={() => {
              open(CHANGELOG_URL).catch(() => {})
            }}
          >
            {t('settings.about.changelog.view')}
            <Icon name="externalLink" size={18} />
          </Button>
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

      {hasNewVersion ? (
        <SettingsSection title={t('settings.about.releaseNotes')}>
          {body ? (
            <div className="pt-1">
              <Markdown content={body} className="text-sm" />
            </div>
          ) : (
            // Loaded from GitHub, so not without a connection to it
            <SettingsRow
              title={t('settings.about.releaseNotesOnline.title', {
                version: latestVersion,
              })}
              description={t('settings.about.releaseNotesOnline.description')}
            >
              <Button
                size="sm"
                onPress={() => {
                  open(`${RELEASES_URL}/${latestVersion}`).catch(() => {})
                }}
              >
                {t('settings.about.releaseNotesOnline.view')}
              </Button>
            </SettingsRow>
          )}
        </SettingsSection>
      ) : null}
    </>
  )
}

export default About
