import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { subscribeKey } from 'valtio/utils'

import { settingsStore } from '@/stores/settingsStore'
import { setNativeTexts } from '@/tauri/commands/app'
import type { LanguageCode } from './languages'
import en from './locales/en.json'

// Every language's text, bundled (the app works offline): `locales/<code>.json`
const localeFiles = import.meta.glob<Record<string, unknown>>(
  './locales/*.json',
  { eager: true, import: 'default' },
)
const resources = Object.fromEntries(
  Object.entries(localeFiles).map(([path, translation]) => [
    path.replace(/^.*\/(.+)\.json$/, '$1'),
    { translation },
  ]),
)

function applyLanguage(language: LanguageCode) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
  }
  return i18n.changeLanguage(language)
}

i18n.use(initReactI18next).init({
  resources,
  lng: settingsStore.language,
  // Text not translated yet is shown in English
  fallbackLng: 'en',
  returnEmptyString: false,
  // React escapes the text itself
  interpolation: { escapeValue: false },
})
if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language
}

// Changed in Settings, in this window or another (the setting is shared, see `settingsStore`)
subscribeKey(settingsStore, 'language', (language) => {
  applyLanguage(language).catch(() => {})
})

/** The menus & the quit confirmation are native, so the backend is given their text */
function sendNativeTexts() {
  setNativeTexts(i18n.t('native', { returnObjects: true })).catch(() => {})
}
sendNativeTexts()
i18n.on('languageChanged', sendNativeTexts)

/** Translates outside React components (e.g. in toasts); components use `useTranslation` */
export const t = i18n.t.bind(i18n) as typeof i18n.t

/** English, the source of every translation (its keys are checked by TypeScript) */
export type Translation = typeof en

export default i18n
