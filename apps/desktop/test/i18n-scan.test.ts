import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { compareLocale, isWordy, parseAndroidStrings, parseArb, parseJsonKeys, scanI18n, yamlValue } from '../src/preview/i18nScan'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-i18n-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const put = (root: string, rel: string, text: string): void => {
  const p = path.join(root, rel)
  mkdirSync(path.dirname(p), { recursive: true })
  writeFileSync(p, text)
}

describe('parsers', () => {
  it('reads Android string, plurals and string-array names with lines, skipping comments', () => {
    const xml = [
      '<resources>',
      '  <!-- <string name="ghost">x</string> -->',
      '  <string name="app_name" translatable="false">Orrery</string>',
      '  <string name="hello">Hello there</string>',
      '  <plurals name="files">',
      '    <item quantity="one">%d file</item>',
      '  </plurals>',
      '  <string-array name="days"><item>Mon</item></string-array>',
      '  <string name="empty"/>',
      '</resources>',
    ].join('\n')
    const e = parseAndroidStrings(xml)
    expect([...e.keys()]).toEqual(['app_name', 'hello', 'files', 'days', 'empty'])
    expect(e.get('app_name')).toMatchObject({ line: 3, fixed: true })
    expect(e.get('hello')).toEqual({ value: 'Hello there', line: 4 })
    expect(e.get('files')?.line).toBe(5)
    expect(e.get('empty')).toEqual({ value: '', line: 9 })
  })

  it('flattens nested JSON keys with the line of each key', () => {
    const e = parseJsonKeys('{\n  "a": {\n    "b": "B",\n    "c": { "d": "D" }\n  },\n  "n": 3,\n  "list": ["x", {"y": 1}],\n  "esc\\"k": "v"\n}')!
    expect([...e.keys()]).toEqual(['a.b', 'a.c.d', 'n', 'list', 'esc"k'])
    expect(e.get('a.b')).toEqual({ value: 'B', line: 3 })
    expect(e.get('a.c.d')?.line).toBe(4)
    expect(e.get('n')).toEqual({ value: '3', line: 6 })
    expect(e.get('list')?.value).toBe('["x", {"y": 1}]')
    expect(parseJsonKeys('[1]')).toBeNull()
    expect(parseJsonKeys('{"a": }')).toBeNull()
    expect(parseJsonKeys('{"a": 1} x')).toBeNull()
  })

  it('drops ARB metadata and reads @@locale', () => {
    const arb = parseArb('{\n "@@locale": "vi",\n "title": "Tiêu đề",\n "@title": { "description": "x" }\n}')!
    expect(arb.locale).toBe('vi')
    expect([...arb.entries.keys()]).toEqual(['title'])
  })

  it('reads flat l10n.yaml values', () => {
    const y = "arb-dir: lib/i18n # here\ntemplate-arb-file: 'intl_en.arb'\n"
    expect(yamlValue(y, 'arb-dir')).toBe('lib/i18n')
    expect(yamlValue(y, 'template-arb-file')).toBe('intl_en.arb')
    expect(yamlValue(y, 'output-dir')).toBeNull()
  })

  it('ignores short, numeric and placeholder-only values for "same as base"', () => {
    expect(isWordy('OK')).toBe(false)
    expect(isWordy('12:30')).toBe(false)
    expect(isWordy('{count} %1$s')).toBe(false)
    expect(isWordy('Settings')).toBe(true)
    const base = new Map([
      ['a', { value: 'Settings', line: 1 }],
      ['b', { value: 'OK', line: 2 }],
      ['c', { value: 'Cancel', line: 3 }],
      ['fixed', { value: 'Brand name', line: 4, fixed: true }],
    ])
    const loc = new Map([
      ['a', { value: 'Settings', line: 7 }],
      ['b', { value: 'OK', line: 8 }],
      ['z', { value: 'Extra', line: 9 }],
    ])
    const r = compareLocale(base, loc, 'base.json', 'vi.json')
    expect(r.counts).toEqual({ missing: 1, extra: 1, same: 1 })
    expect(r.missing).toEqual([{ key: 'c', file: 'base.json', line: 3 }])
    expect(r.extra).toEqual([{ key: 'z', file: 'vi.json', line: 9 }])
    expect(r.same).toEqual([{ key: 'a', file: 'vi.json', line: 7 }])
  })
})

describe('scanI18n', () => {
  const root = path.join(tmp, 'proj')
  put(root, 'app/src/main/res/values/strings.xml', '<resources>\n<string name="hi">Hello world</string>\n<string name="bye">Goodbye</string>\n</resources>')
  put(root, 'app/src/main/res/values-vi/strings.xml', '<resources>\n<string name="hi">Hello world</string>\n<string name="old">Cũ</string>\n</resources>')
  put(root, 'app/src/main/res/values-night/strings.xml', '<resources/>')
  put(root, 'app/src/main/res/values-v21/strings.xml', '<resources/>')
  put(root, 'mobile/pubspec.yaml', 'name: m\n')
  put(root, 'mobile/l10n.yaml', 'arb-dir: lib/i18n\ntemplate-arb-file: intl_en.arb\n')
  put(root, 'mobile/lib/i18n/intl_en.arb', '{\n "@@locale": "en",\n "title": "Welcome home",\n "@title": {},\n "count": "{n} items"\n}')
  put(root, 'mobile/lib/i18n/intl_de.arb', '{\n "title": "Willkommen"\n}')
  put(root, 'web/src/locales/en.json', '{ "nav": { "home": "Home page", "about": "About us" } }')
  put(root, 'web/src/locales/fr.json', '{ "nav": { "home": "Accueil" } }')
  put(root, 'web/src/locales/broken.json', '{ nope')
  put(root, 'web/src/i18n/en.ts', 'export default {}')
  put(root, 'node_modules/pkg/locales/en.json', '{"a":"b"}')
  put(root, 'node_modules/pkg/locales/vi.json', '{"a":"b"}')

  it('finds Android, Flutter and JSON sets and reports per locale', async () => {
    const res = await scanI18n(root)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.sets.map((s) => `${s.kind}:${s.dir}`)).toEqual(['android:app/src/main/res', 'flutter:mobile/lib/i18n', 'json:web/src/locales'])
    const [android, flutter, json] = res.sets
    expect(android!.base).toMatchObject({ locale: 'default', keys: 2, files: ['app/src/main/res/values/strings.xml'] })
    expect(android!.locales.map((l) => l.locale)).toEqual(['vi'])
    expect(android!.locales[0]).toMatchObject({
      counts: { missing: 1, extra: 1, same: 1 },
      missing: [{ key: 'bye', file: 'app/src/main/res/values/strings.xml', line: 3 }],
      extra: [{ key: 'old', file: 'app/src/main/res/values-vi/strings.xml', line: 3 }],
    })
    expect(flutter!.base).toMatchObject({ locale: 'en', keys: 2 })
    expect(flutter!.locales).toEqual([
      expect.objectContaining({ locale: 'de', counts: { missing: 1, extra: 0, same: 0 }, missing: [{ key: 'count', file: 'mobile/lib/i18n/intl_en.arb', line: 5 }] }),
    ])
    expect(json!.base.locale).toBe('en')
    expect(json!.locales.map((l) => [l.locale, l.error ?? l.counts.missing])).toEqual([
      ['broken', 'invalid'],
      ['fr', 1],
    ])
  })

  it('refuses an arb-dir outside the project and a missing root', async () => {
    const other = path.join(tmp, 'escape')
    put(other, 'app/pubspec.yaml', 'name: x\n')
    put(other, 'app/l10n.yaml', 'arb-dir: ../outside\n')
    put(other, 'outside/app_en.arb', '{"a":"b"}')
    const res = await scanI18n(other)
    expect(res.ok && res.sets).toEqual([])
    expect(await scanI18n(path.join(tmp, 'nope'))).toEqual({ ok: false, error: 'failed' })
  })
})
