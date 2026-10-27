import 'i18next'

import type en from '@/i18n/locales/en.json'

// Translation keys are checked against English, the source (see `src/i18n`)
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof en
    }
  }
}
