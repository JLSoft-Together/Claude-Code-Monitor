import { setLocale } from '@ccm/habblaud/shared/i18n'

/** Habblaud's server code speaks pt-BR unless told otherwise: recorder / NameStore logs and timeline errors go out in English. */
export function useEnglishOffice(): void {
  setLocale('en')
}
