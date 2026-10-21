import { describe, expect, it } from 'vitest'
import { describeTool } from '@ccm/habblaud/shared/activity'
import { getLocale } from '@ccm/habblaud/shared/i18n'
import { EN } from '@ccm/habblaud/shared/locales/en'
import { VI } from '@ccm/habblaud/shared/locales/vi'
import { applyOfficeLocale } from './i18n'

describe('applyOfficeLocale', () => {
  it('switches the office texts to Vietnamese and back to English', async () => {
    await applyOfficeLocale('vi')
    expect(getLocale()).toBe('vi')
    expect(describeTool('Edit', undefined).text).toBe(VI['Editando arquivo'])

    await applyOfficeLocale('en')
    expect(getLocale()).toBe('en')
    expect(describeTool('Edit', undefined).text).toBe(EN['Editando arquivo'])
  })

  it('differs between the two languages', async () => {
    await applyOfficeLocale('vi')
    const vi = describeTool('Read', { file_path: '/a/b.ts' }).text
    await applyOfficeLocale('en')
    expect(describeTool('Read', { file_path: '/a/b.ts' }).text).not.toBe(vi)
  })
})
