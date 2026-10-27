import { useTranslation } from 'react-i18next'

import Link from '@/tauri/components/Link'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const CREDITS = [
  {
    name: 'FFmpeg & FFprobe',
    copyright: 'Copyright © 2000-2024 Fabrice Bellard, et al.',
    license: 'GPL v2+, LGPL v2.1+',
    website: 'https://ffmpeg.org/',
    github: 'https://github.com/FFmpeg/FFmpeg',
  },
  {
    name: 'pngquant',
    copyright: 'Copyright © 2009-2024 Kornel Lesiński',
    license: 'GPL v3+',
    website: 'https://pngquant.org/',
    github: 'https://github.com/kornelski/pngquant',
  },
  {
    name: 'jpegoptim',
    copyright: 'Copyright © 1996-2024 Timo Kokkonen',
    license: 'GPL v3+',
    website: null,
    github: 'https://github.com/tjko/jpegoptim',
  },
  {
    name: 'gifski',
    copyright: 'Copyright © 2019-2024 ImageOptim LLC, Kornel Lesiński',
    license: 'AGPL v3+',
    website: 'https://gif.ski/',
    github: 'https://github.com/ImageOptim/gifski/',
  },
] as const

export default function Credits() {
  const { t } = useTranslation()

  return (
    <SettingsSection title={t('settings.pages.credits')}>
      <SettingsRow
        title={t('settings.credits.tools.title')}
        description={t('settings.credits.tools.description')}
      />
      {CREDITS.map((credit) => (
        <SettingsRow
          key={credit.name}
          title={credit.name}
          description={
            <>
              {credit.copyright}
              <br />
              {t('settings.credits.license', { license: credit.license })}
            </>
          }
        >
          <div className="flex items-center gap-3 text-sm">
            {credit.website ? (
              <Link href={credit.website}>
                {t('settings.about.website.title')}
              </Link>
            ) : null}
            <Link href={credit.github}>GitHub</Link>
          </div>
        </SettingsRow>
      ))}
      <SettingsRow
        title={t('settings.credits.notices.title')}
        description={t('settings.credits.notices.description')}
      >
        <Link
          href="https://github.com/codeforreal1/compressO/blob/main/THIRD_PARTY_NOTICES.md"
          className="text-sm"
        >
          {t('settings.credits.notices.view')}
        </Link>
      </SettingsRow>
    </SettingsSection>
  )
}
