import { registerDictionary, setLocale } from '@ccm/habblaud/shared/i18n'
import { OFFICE_STRINGS } from './strings'

export type OfficeLocale = 'en' | 'vi'

/**
 * Loads the office dictionary of the active UI language and makes Habblaud's `tr()` use it. Must finish before the
 * first `import('@ccm/habblaud/client/src/world')`: module-level `tr()` calls read the locale when they run.
 * Orrery-local strings (`strings.ts`) are merged on top of the upstream dictionary.
 */
export async function applyOfficeLocale(locale: OfficeLocale): Promise<void> {
  const dict = locale === 'vi' ? (await import('@ccm/habblaud/shared/locales/vi')).VI : (await import('@ccm/habblaud/shared/locales/en')).EN
  registerDictionary(locale, { ...dict, ...OFFICE_STRINGS[locale] })
  setLocale(locale)
}
