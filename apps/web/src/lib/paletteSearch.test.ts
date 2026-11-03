import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '../i18n/en'
import viMessages from '../i18n/vi'
import v79 from '../i18n/ui-v79-settings'
import v80 from '../i18n/ui-v80-palette'
import { entries, type SettingsEnv } from '../components/settings'
import { cap, fold, GROUP_CAP, joinPath, listSettings, matchFiles, matchText, parsePrefix, prefixOf, searchable } from './paletteSearch'
import { flashSettingRow } from './settingsFlash'

const env: SettingsEnv = {
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
  deepseek: true,
}

describe('parsePrefix', () => {
  it('reads one leading character as the kind and keeps the rest as the query', () => {
    expect(parsePrefix('>theme')).toEqual({ mode: 'actions', text: 'theme' })
    expect(parsePrefix('@ api')).toEqual({ mode: 'sessions', text: 'api' })
    expect(parsePrefix('#app.ts:42')).toEqual({ mode: 'files', text: 'app.ts:42' })
    expect(parsePrefix(': sound')).toEqual({ mode: 'settings', text: 'sound' })
  })

  it('an empty prefix still selects the kind, with an empty query', () => {
    for (const q of ['>', '@', '#', ':']) expect(parsePrefix(q)).toMatchObject({ mode: expect.any(String), text: '' })
    expect(parsePrefix('  #')).toEqual({ mode: 'files', text: '' })
  })

  it('plain text and a prefix that is not first stay in the mixed view', () => {
    expect(parsePrefix('theme')).toEqual({ mode: null, text: 'theme' })
    expect(parsePrefix(' a > b ')).toEqual({ mode: null, text: 'a > b' })
    expect(parsePrefix('')).toEqual({ mode: null, text: '' })
  })

  it('prefixOf is the inverse', () => {
    for (const m of ['actions', 'sessions', 'files', 'settings'] as const) expect(parsePrefix(`${prefixOf(m)}x`).mode).toBe(m)
  })
})

describe('matchText', () => {
  const items = [searchable('Đổi ngôn ngữ', 'đổi'), searchable('Làm sạch', 'dọn'), searchable('Âm báo', 'âm thanh'), searchable('Open settings', 'preferences')]

  it('ranks a label word start before a match inside it or only in the sub text', () => {
    const list = [searchable('Fonts', 'a theme font'), searchable('Rethemed'), searchable('Theme: Dracula')]
    expect(matchText(list, 'theme').map((i) => i.label)).toEqual(['Theme: Dracula', 'Rethemed', 'Fonts'])
  })

  it('an accented query matches exactly first: "âm" must not hit "làm" or "dọn"', () => {
    expect(matchText(items, 'âm').map((i) => i.label)).toEqual(['Âm báo'])
  })

  it('a plain query ignores accents and đ', () => {
    expect(matchText(items, 'am').map((i) => i.label)).toContain('Âm báo')
    expect(matchText(items, 'doi ngon').map((i) => i.label)).toEqual(['Đổi ngôn ngữ'])
    expect(matchText(items, 'DOI').map((i) => i.label)).toEqual(['Đổi ngôn ngữ'])
  })

  it('an accented query with no exact hit falls back to the folded match', () => {
    expect(matchText([searchable('Am bao')], 'âm').map((i) => i.label)).toEqual(['Am bao'])
  })

  it('every word must match; an empty query keeps everything in order', () => {
    expect(matchText(items, 'open zzz')).toEqual([])
    expect(matchText(items, '   ').map((i) => i.label)).toEqual(items.map((i) => i.label))
  })
})

describe('cap', () => {
  const list = [1, 2, 3, 4, 5, 6, 7]
  it('shows five and counts the rest', () => {
    expect(cap(list, false)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 2 })
    expect(GROUP_CAP).toBe(5)
  })
  it('shows everything once expanded or when it already fits', () => {
    expect(cap(list, true)).toEqual({ shown: list, hidden: 0 })
    expect(cap([1, 2, 3, 4, 5], false)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 0 })
    expect(cap([], false)).toEqual({ shown: [], hidden: 0 })
  })
})

describe('files', () => {
  const files = ['src/app.ts', 'src/lib/paletteSearch.ts', 'README.md', 'docs/app-notes.md']

  it('ranks like Quick open and keeps a trailing :line', () => {
    const res = matchFiles(files, 'app.ts:42')
    expect(res.hits[0]!.item).toBe('src/app.ts')
    expect(res.line).toBe(42)
  })

  it('stays empty below the minimum length so one letter does not flood the mixed view', () => {
    expect(matchFiles(files, 'a', { min: 2 }).hits).toEqual([])
    expect(matchFiles(files, 'ap', { min: 2 }).hits.length).toBeGreaterThan(0)
  })

  it('an empty query lists the files (browse mode) and no project means nothing to match', () => {
    expect(matchFiles(files, '').hits.map((h) => h.item)).toEqual(files)
    expect(matchFiles([], 'x').hits).toEqual([])
  })

  it('caps a huge list at the limit', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `src/file${i}.ts`)
    expect(matchFiles(many, 'file', { limit: 50 }).hits).toHaveLength(50)
    expect(matchFiles(many, '').hits).toHaveLength(50)
  })

  it('joins with the separator the root uses', () => {
    expect(joinPath('C:\\work\\app\\', 'src/a.ts')).toBe('C:\\work\\app\\src\\a.ts')
    expect(joinPath('/home/me/app', 'src/a.ts')).toBe('/home/me/app/src/a.ts')
  })
})

describe('settings in the palette', () => {
  const tr = (locale: 'en' | 'vi') => {
    const base = locale === 'en' ? en : viMessages
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: { ...base, ...v79[locale] } }, missingWarn: false, fallbackWarn: false })
    return (k: string) => i18n.global.t(k)
  }

  it('lists every visible row for a bare ":" and hides rows this build lacks', () => {
    const all = listSettings(entries(false), env, tr('en'))
    expect(all.length).toBeGreaterThan(40)
    const hidden = listSettings(entries(false), { ...env, terminals: false, github: false, toast: false }, tr('en')).map((h) => h.id)
    expect(hidden).not.toContain('autoSave')
    expect(hidden).not.toContain('github')
    expect(hidden).not.toContain('toast')
    expect(hidden).toContain('theme')
  })

  it('folds accents for ASCII input', () => {
    expect(fold('Đổi Ngôn Ngữ')).toBe('doi ngon ngu')
  })
})

describe('palette strings', () => {
  const leaves = (o: Record<string, unknown>, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [`${p}${k}`] : leaves(v as Record<string, unknown>, `${p}${k}.`)))

  it('have the same keys in en and vi and compile with their placeholders', () => {
    expect(leaves(v80.vi)).toEqual(leaves(v80.en))
    for (const locale of ['en', 'vi'] as const) {
      const i18n = createI18n({ legacy: false, locale, messages: { [locale]: v80[locale] }, missingWarn: false, fallbackWarn: false })
      for (const k of leaves(v80[locale])) expect(() => i18n.global.t(k, { n: 3 })).not.toThrow()
    }
  })
})

describe('flashSettingRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => vi.useRealTimers())

  it('waits for the row to render, then highlights it for a moment', () => {
    flashSettingRow('sound')
    vi.advanceTimersByTime(100)
    const row = document.createElement('div')
    row.setAttribute('data-setting-row', 'sound')
    document.body.append(row)
    vi.advanceTimersByTime(100)
    expect(row.classList.contains('ccm-setting-flash')).toBe(true)
    vi.advanceTimersByTime(1500)
    expect(row.classList.contains('ccm-setting-flash')).toBe(false)
  })

  it('gives up quietly when the row never shows', () => {
    flashSettingRow('nope')
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })
})
