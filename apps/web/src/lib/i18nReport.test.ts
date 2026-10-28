import { describe, expect, it } from 'vitest'
import { hasIssues, i18nReportText, i18nTotals } from './i18nReport'
import type { I18nLocale, I18nSet } from './preview'

const loc = (p: Partial<I18nLocale>): I18nLocale => ({
  locale: 'vi',
  files: ['res/values-vi/strings.xml'],
  keys: 1,
  counts: { missing: 0, extra: 0, same: 0 },
  missing: [],
  extra: [],
  same: [],
  ...p,
})
const set = (locales: I18nLocale[]): I18nSet => ({ kind: 'android', dir: 'app/res', base: { locale: 'default', files: ['app/res/values/strings.xml'], keys: 3 }, locales })

describe('i18nReport', () => {
  const sets = [
    set([
      loc({ counts: { missing: 2, extra: 0, same: 1 }, missing: [{ key: 'a', file: 'b.xml', line: 3 }], same: [{ key: 'c', file: 'v.xml', line: 4 }] }),
      loc({ locale: 'de' }),
    ]),
  ]
  it('sums counts and spots locales with issues', () => {
    expect(i18nTotals(sets)).toEqual({ missing: 2, extra: 0, same: 1 })
    expect(hasIssues(sets[0]!.locales[0]!)).toBe(true)
    expect(hasIssues(sets[0]!.locales[1]!)).toBe(false)
    expect(hasIssues(loc({ error: 'invalid' }))).toBe(true)
  })
  it('writes a copyable list, marking cut lists', () => {
    expect(i18nReportText(sets, { missing: 'Missing', extra: 'Extra', same: 'Same' })).toBe(
      ['# app/res (android, base default)', '## vi', 'Missing (2):', '  a  b.xml:3', '  …', 'Same (1):', '  c  v.xml:4'].join('\n'),
    )
    expect(i18nReportText([set([loc({})])], { missing: 'M', extra: 'E', same: 'S' })).toBe('')
  })
})
