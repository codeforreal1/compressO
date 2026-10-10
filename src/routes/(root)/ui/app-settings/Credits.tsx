import Link from '@/tauri/components/Link'
import { SettingsRow, SettingsSection } from './SettingsLayout'

const CREDITS = [
  {
    name: 'FFmpeg & FFprobe',
    copyright: 'Copyright © 2000-2024 Fabrice Bellard, et al.',
    license: 'Licensed under GPL v2+ and LGPL v2.1+',
    website: 'https://ffmpeg.org/',
    github: 'https://github.com/FFmpeg/FFmpeg',
  },
  {
    name: 'pngquant',
    copyright: 'Copyright © 2009-2024 Kornel Lesiński',
    license: 'Licensed under GPL v3+',
    website: 'https://pngquant.org/',
    github: 'https://github.com/kornelski/pngquant',
  },
  {
    name: 'jpegoptim',
    copyright: 'Copyright © 1996-2024 Timo Kokkonen',
    license: 'Licensed under GPL v3+',
    website: null,
    github: 'https://github.com/tjko/jpegoptim',
  },
  {
    name: 'gifski',
    copyright: 'Copyright © 2019-2024 ImageOptim LLC, Kornel Lesiński',
    license: 'Licensed under AGPL v3+',
    website: 'https://gif.ski/',
    github: 'https://github.com/ImageOptim/gifski/',
  },
] as const

export default function Credits() {
  return (
    <SettingsSection title="Credits">
      <SettingsRow
        title="Open-source tools"
        description="CompressO would not be possible without these incredible open-source tools and libraries."
      />
      {CREDITS.map((credit) => (
        <SettingsRow
          key={credit.name}
          title={credit.name}
          description={
            <>
              {credit.copyright}
              <br />
              {credit.license}
            </>
          }
        >
          <div className="flex items-center gap-3 text-sm">
            {credit.website ? <Link href={credit.website}>Website</Link> : null}
            <Link href={credit.github}>GitHub</Link>
          </div>
        </SettingsRow>
      ))}
      <SettingsRow
        title="Third-party notices"
        description="Complete third-party notices and licenses."
      >
        <Link
          href="https://github.com/codeforreal1/compressO/blob/main/THIRD_PARTY_NOTICES.md"
          className="text-sm"
        >
          View
        </Link>
      </SettingsRow>
    </SettingsSection>
  )
}
