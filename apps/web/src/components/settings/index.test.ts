import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { TOAST_KINDS } from '@ccm/shared'
import en from '../../i18n/en'
import vi from '../../i18n/vi'
import v79 from '../../i18n/ui-v79-settings'
import { useSettingsStore } from '../../stores/settings'
import { NOTIFY_ROWS, SETTINGS_PAGES, entries, isSettingsPage, loadPage, pageVisible, savePage, searchSettings, type SettingsEnv } from './index'

const all: SettingsEnv = {
  terminals: true,
  mac: false,
  loginItem: true,
  zoom: true,
  awake: true,
  github: true,
  run: true,
  capture: true,
  agentData: true,
  phone: true,
  disk: true,
  updater: true,
  backup: true,
  grants: true,
  statusLine: true,
  toast: true,
  notifyData: true,
}

function translator(locale: 'en' | 'vi') {
  const base = locale === 'en' ? en : vi
  const i18n = createI18n({ legacy: false, locale, messages: { [locale]: { ...base, ...v79[locale] } }, missingWarn: false, fallbackWarn: false })
  return { t: (k: string) => i18n.global.t(k), te: (k: string) => i18n.global.te(k) }
}

describe('settings metadata', () => {
  for (const locale of ['en', 'vi'] as const) {
    it(`every label and hint key resolves in ${locale}`, () => {
      const { te } = translator(locale)
      const missing = [true, false].flatMap((mac) => entries(mac).flatMap((e) => [e.labelKey, e.hintKey].filter((k): k is string => !!k && !te(k))))
      expect(missing).toEqual([])
    })
    it(`every page has a ${locale} name`, () => {
      const { te } = translator(locale)
      expect(SETTINGS_PAGES.filter((p) => !te(`settingsV79.pages.${p}`))).toEqual([])
    })
  }

  it('new messages compile and have the same keys in both languages', () => {
    const leaves = (o: Record<string, unknown>, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : leaves(v as Record<string, unknown>, `${p}${k}.`)))
    expect(leaves(v79.vi)).toEqual(leaves(v79.en))
    for (const locale of ['en', 'vi'] as const) {
      const i18n = createI18n({ legacy: false, locale, messages: { [locale]: v79[locale] }, missingWarn: false, fallbackWarn: false })
      for (const k of leaves(v79[locale])) expect(() => i18n.global.t(k, { what: 'x', q: 'y' })).not.toThrow()
    }
  })

  it('entry ids are unique per page', () => {
    const ids = entries(false).map((e) => `${e.page}:${e.id}`)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('finds the sound row in English and Vietnamese and points at the notify page', () => {
    for (const [locale, q] of [['en', 'sound'], ['vi', 'âm'], ['vi', 'am bao']] as const) {
      const { t } = translator(locale)
      const hit = searchSettings(q, entries(false), all, t).find((h) => h.id === 'sound')
      expect(hit?.page).toBe('notify')
    }
  })

  it('an accented query matches accents exactly, a plain one ignores them', () => {
    const { t } = translator('vi')
    const ids = (q: string) => searchSettings(q, entries(false), all, t).map((h) => h.id)
    const strict = ids('âm')
    expect(strict).toContain('sound')
    expect(strict).not.toContain('dim')
    expect(strict).not.toContain('keyHints')
    expect(ids('am')).toContain('sound')
    expect(ids('thông báo').length).toBeGreaterThan(0)
    expect(ids('thong bao').length).toBeGreaterThan(0)
    expect(ids('ăăăz')).toEqual([])
  })

  it('ranks a label word start before a hint-only match', () => {
    const { t } = translator('en')
    const hits = searchSettings('sound', entries(false), all, t)
    expect(hits[0]?.id).toBe('sound')
  })

  it('requires every word and ignores case', () => {
    const { t } = translator('en')
    expect(searchSettings('AUTO save', entries(false), all, t).some((h) => h.id === 'autoSave')).toBe(true)
    expect(searchSettings('auto zzzz', entries(false), all, t)).toEqual([])
    expect(searchSettings('   ', entries(false), all, t)).toEqual([])
  })

  it('skips rows and pages the platform does not have', () => {
    const { t } = translator('en')
    const env = { ...all, terminals: false, github: false, phone: false }
    const ids = searchSettings('a', entries(false), env, t).map((h) => h.id)
    expect(ids).not.toContain('autoSave')
    expect(ids).not.toContain('github')
    expect(ids).not.toContain('phone')
    expect(pageVisible('editor', env)).toBe(false)
    expect(pageVisible('github', env)).toBe(false)
    expect(pageVisible('notify', env)).toBe(true)
  })
})

describe('notification table rows', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('lists every system-alert kind exactly once', () => {
    expect(NOTIFY_ROWS.map((r) => r.kind).sort()).toEqual([...TOAST_KINDS].sort())
  })

  it('keeps all six in-app switches, each on a real settings key', () => {
    const keys = NOTIFY_ROWS.flatMap((r) => (r.inApp ? [r.inApp] : []))
    expect(keys.sort()).toEqual(['notifyContext', 'notifyDone', 'notifyLimit', 'notifyLoop', 'notifyStuck', 'notifyWaiting'])
    const store = useSettingsStore()
    for (const k of keys) expect(typeof store[k]).toBe('boolean')
  })

  it('system-alert-only kinds are hidden from search when that channel is missing', () => {
    const { t } = translator('en')
    const ids = searchSettings('forgotten', entries(false), { ...all, toast: false }, t).map((h) => h.id)
    expect(ids).not.toContain('event-idle')
    expect(searchSettings('forgotten', entries(false), all, t).map((h) => h.id)).toContain('event-idle')
  })
})

describe('remembered page', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips and falls back to general', () => {
    expect(loadPage()).toBe('general')
    savePage('notify')
    expect(loadPage()).toBe('notify')
    localStorage.setItem('ccm.settings.page', 'nope')
    expect(loadPage()).toBe('general')
    expect(isSettingsPage('data')).toBe(true)
    expect(isSettingsPage('nope')).toBe(false)
  })
})
