import { createI18n } from 'vue-i18n'
import en from './en'
import vi from './vi'

export type Locale = 'en' | 'vi'

export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem('ccm.locale')
    if (saved === 'en' || saved === 'vi') return saved
  } catch {
    return 'en'
  }
  return navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, vi },
})
