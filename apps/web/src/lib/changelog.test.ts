import { afterEach, describe, expect, it } from 'vitest'
import desktopPkg from '../../../desktop/package.json'
import { APP_VERSION, CHANGELOG, compareSemver, markSeen, SEEN_KEY, seenVersion, shouldShowWhatsNew } from './changelog'

describe('changelog', () => {
  it('lists versions newest first, strictly descending semver', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareSemver(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBeGreaterThan(0)
    for (const r of CHANGELOG) expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('dates never go forward as versions go back', () => {
    for (const r of CHANGELOG) expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true)
  })

  it('has the running desktop version on top', () => {
    expect(APP_VERSION).toBe(desktopPkg.version)
    expect(CHANGELOG[0]!.version).toBe(desktopPkg.version)
  })

  it('every bullet is short and has English and Vietnamese text', () => {
    for (const r of CHANGELOG) {
      expect(r.items.length).toBeGreaterThan(0)
      expect(r.items.length).toBeLessThanOrEqual(10)
      for (const item of r.items) {
        expect(item.en.trim()).not.toBe('')
        expect(item.vi.trim()).not.toBe('')
        expect(item.en.length).toBeLessThanOrEqual(100)
        expect(item.vi.length).toBeLessThanOrEqual(100)
      }
    }
  })

  it('compareSemver orders by number, not text', () => {
    expect(compareSemver('2.10.0', '2.9.9')).toBeGreaterThan(0)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    expect(compareSemver('1.0.2', '1.1.0')).toBeLessThan(0)
  })
})

describe('shouldShowWhatsNew', () => {
  afterEach(() => localStorage.removeItem(SEEN_KEY))

  it('shows on a fresh install and after an update, not twice for one version', () => {
    expect(shouldShowWhatsNew(null, '2.4.0')).toBe(true)
    expect(shouldShowWhatsNew('2.3.0', '2.4.0')).toBe(true)
    expect(shouldShowWhatsNew('2.4.0', '2.4.0')).toBe(false)
    expect(shouldShowWhatsNew('2.5.0', '2.4.0')).toBe(true)
  })

  it('never shows without a known version', () => {
    expect(shouldShowWhatsNew(null, '')).toBe(false)
  })

  it('remembers the version seen', () => {
    expect(seenVersion()).toBeNull()
    markSeen()
    expect(seenVersion()).toBe(APP_VERSION)
    expect(shouldShowWhatsNew(seenVersion(), APP_VERSION)).toBe(false)
  })
})
