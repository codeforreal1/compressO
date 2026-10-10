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
          alt="logo"
          width={56}
          height={56}
        />
        <div>
          <Link href="https://compresso.codeforreal.com">
            <h2 className="text-2xl font-bold text-primary">CompressO</h2>
          </Link>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Compress any image/video into a tiny size.
          </p>
        </div>
      </div>

      <SettingsSection title="About">
        <SettingsRow
          title={`Version ${currentVersion || window.__appVersion || ''}`}
          description={
            hasNewVersion
              ? `Version ${latestVersion} is available. Restart the app after updating to use it.`
              : hasChecked
                ? "You're on the latest version."
                : 'Check if a newer version of CompressO is available.'
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
              Update now {isInstalling ? `(${installProgress}%)` : ''}
            </Button>
          ) : (
            <Button
              size="sm"
              onPress={checkForUpdates}
              isLoading={isChecking}
              isDisabled={isChecking}
            >
              Check for updates
            </Button>
          )}
        </SettingsRow>
        <SettingsRow
          title="Website"
          description="Downloads, features and documentation."
        >
          <Link href="https://compresso.codeforreal.com" className="text-sm">
            compresso.codeforreal.com
          </Link>
        </SettingsRow>
        <SettingsRow
          title="Free and open-source"
          description={
            <Link
              href="https://github.com/codeforreal1/compressO/blob/main/LICENSE"
              className="text-sm"
            >
              Licensed under AGPL-3.0
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
            <>
              Made with{' '}
              <Icon className="inline text-primary" name="lowResHeart" /> in
              public by{' '}
              <Link href="https://codeforreal.com" className="text-sm">
                Code For Real⚡
              </Link>
            </>
          }
        />
      </SettingsSection>

      {hasNewVersion && body ? (
        <SettingsSection title="What's new">
          <div className="pt-1">
            <Markdown content={body} className="text-sm" />
          </div>
        </SettingsSection>
      ) : null}
    </>
  )
}

export default About
