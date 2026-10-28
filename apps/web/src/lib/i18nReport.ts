import type { I18nIssue, I18nLocale, I18nSet } from './preview'

export const I18N_ISSUES: readonly I18nIssue[] = ['missing', 'extra', 'same']

export function i18nTotals(sets: readonly I18nSet[]): Record<I18nIssue, number> {
  const out = { missing: 0, extra: 0, same: 0 }
  for (const s of sets) for (const l of s.locales) for (const k of I18N_ISSUES) out[k] += l.counts[k]
  return out
}

export const hasIssues = (l: I18nLocale): boolean => !!l.error || I18N_ISSUES.some((k) => l.counts[k] > 0)

/** Plain-text list for the clipboard: set → locale → kind → `key  file:line`. */
export function i18nReportText(sets: readonly I18nSet[], labels: Record<I18nIssue, string>): string {
  const out: string[] = []
  for (const s of sets) {
    const locales = s.locales.filter((l) => I18N_ISSUES.some((k) => l[k].length))
    if (!locales.length) continue
    out.push(`# ${s.dir || '.'} (${s.kind}, base ${s.base.locale})`)
    for (const l of locales) {
      out.push(`## ${l.locale}`)
      for (const k of I18N_ISSUES) {
        if (!l[k].length) continue
        out.push(`${labels[k]} (${l.counts[k]}):`)
        for (const e of l[k]) out.push(`  ${e.key}  ${e.file}:${e.line}`)
        if (l.counts[k] > l[k].length) out.push('  …')
      }
    }
    out.push('')
  }
  return out.join('\n').trimEnd()
}
