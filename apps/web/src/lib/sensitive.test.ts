import { describe, expect, it } from 'vitest'
import { folderName, relInside, ruleKey, ruleText } from './sensitive'

describe('sensitive helpers', () => {
  it('labels built-in rules by key and shows globs as they are', () => {
    const t = (k: string) => `T(${k})`
    expect(ruleKey('git-force-push')).toBe('sensitive.rule.git-force-push')
    expect(ruleText('outside-project', t)).toBe('T(sensitive.rule.outside-project)')
    expect(ruleText('.env*', t)).toBe('.env*')
    expect(ruleText('custom:*.secret', t)).toBe('*.secret')
  })

  it('relative path inside a root, case-insensitive with either slash', () => {
    expect(relInside('f:/work/app/android/key.properties', 'F:\\work\\app')).toBe('android/key.properties')
    expect(relInside('f:/work/other/x', 'F:\\work\\app')).toBeNull()
    expect(relInside('f:/work/application/x', 'F:/work/app')).toBeNull()
    expect(folderName('F:\\work\\shop\\')).toBe('shop')
  })
})
