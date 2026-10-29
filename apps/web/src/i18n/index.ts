import { createI18n } from 'vue-i18n'
import en from './en'
import vi from './vi'

export type Locale = 'en' | 'vi'

// Vietnamese by default (owner, 2026-10-29); specs assert English strings, so Vitest keeps English.
const DEFAULT_LOCALE: Locale = import.meta.env.MODE === 'test' ? 'en' : 'vi'

export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem('ccm.locale')
    if (saved === 'en' || saved === 'vi') return saved
  } catch {
    return DEFAULT_LOCALE
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, vi },
})
