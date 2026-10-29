import { describe, expect, it } from 'vitest'
import { decodeAndroid, encodeAndroid, parseAndroidXml, setAndroidString } from './androidXml'
import { parseJsonStrings, setJsonString } from './jsonStrings'
import { androidPlaceholders, buildRows, fillPrompt, filterRows, icuPlaceholders, isStringsPath, missingCounts, parseSource, type LocaleSource } from './table'

const XML = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:tools="http://schemas.android.com/tools">
    <!-- App name <string name="ghost">x</string> -->
    <string name="app_name">My App</string>
    <string name="greeting">Hello, %1$s! You have %2$d messages</string>
    <string name="quote">Don\\'t \\"stop\\"</string>
    <string name="cdata"><![CDATA[<b>Bold</b> & </string>]]></string>
    <string name="styled">Tap <b>here</b></string>
    <string name="api_key" translatable="false">abc</string>
    <string name="empty"/>
    <plurals name="songs">
        <item quantity="one">%d song</item>
        <item quantity="other">%d songs</item>
    </plurals>
    <string-array name="planets">
        <item>Mercury</item>
        <item>Venus</item>
    </string-array>
</resources>
`

describe('android strings.xml', () => {
  it('parses strings, plurals, arrays, comments and CDATA', () => {
    const doc = parseAndroidXml(XML)
    expect(doc.writable).toBe(true)
    expect(doc.order).toEqual(['app_name', 'greeting', 'quote', 'cdata', 'styled', 'api_key', 'empty', 'songs', 'planets'])
    expect(doc.entries.has('ghost')).toBe(false)
    expect(doc.entries.get('quote')?.value).toBe('Don\'t "stop"')
    expect(doc.entries.get('cdata')?.value).toBe('<b>Bold</b> & </string>')
    expect(doc.entries.get('cdata')?.editable).toBe(true)
    expect(doc.entries.get('styled')).toMatchObject({ editable: false, why: 'markup' })
    expect(doc.entries.get('api_key')?.fixed).toBe(true)
    expect(doc.entries.get('songs')).toMatchObject({ kind: 'plurals', editable: false, items: [{ label: 'one', value: '%d song' }, { label: 'other', value: '%d songs' }] })
    expect(doc.entries.get('planets')?.items?.map((x) => x.value)).toEqual(['Mercury', 'Venus'])
    expect(doc.entries.get('app_name')?.line).toBe(4)
  })

  it('decodes escapes, entities, quotes and whitespace like aapt', () => {
    expect(decodeAndroid('a\\nb\\tc')).toBe('a\nb\tc')
    expect(decodeAndroid('  lots   of\n  space ')).toBe('lots of space')
    expect(decodeAndroid('"  kept  "')).toBe('  kept  ')
    expect(decodeAndroid('&lt;b&gt; &amp; &#169; &#x41;')).toBe('<b> & © A')
    expect(decodeAndroid('\\u00e9\\@x\\?')).toBe('é@x?')
  })

  it('encodes so Android reads the same text back', () => {
    for (const v of ["It's", 'Say "hi"', 'a\\b', 'line1\nline2', '@string/no', '?attr', '  padded ', 'x  y', 'a < b & c', 'tab\there', 'Ünïcödé 日本']) {
      expect(decodeAndroid(encodeAndroid(v)!)).toBe(v)
      expect(decodeAndroid(`<![CDATA[${encodeAndroid(v, true)!}]]>`)).toBe(v)
    }
    expect(encodeAndroid("It's")).toBe("It\\'s")
    expect(encodeAndroid('@home')).toBe('\\@home')
    expect(encodeAndroid('x]]>', true)).toBeNull()
  })

  it('edits one value with a minimal splice', () => {
    const r = setAndroidString(XML, 'app_name', "Bob's App")
    expect(r.ok && r.text).toBe(XML.replace('>My App<', ">Bob\\'s App<"))
  })

  it('keeps CDATA wrappers and fills self-closing entries', () => {
    const c = setAndroidString(XML, 'cdata', '<i>new</i>')
    expect(c.ok && c.text).toContain('<string name="cdata"><![CDATA[<i>new</i>]]></string>')
    const e = setAndroidString(XML, 'empty', 'Now full')
    expect(e.ok && e.text).toContain('<string name="empty">Now full</string>')
  })

  it('adds a missing key before </resources> with the file indent and CRLF', () => {
    const crlf = XML.replace(/\n/g, '\r\n')
    const r = setAndroidString(crlf, 'new_key', 'New & shiny')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain('    <string name="new_key">New &amp; shiny</string>\r\n</resources>')
    expect(r.text.replace('    <string name="new_key">New &amp; shiny</string>\r\n', '')).toBe(crlf)
    const inline = setAndroidString('<resources><string name="a">A</string></resources>', 'b', 'B')
    expect(inline.ok && parseAndroidXml(inline.text).entries.get('b')?.value).toBe('B')
  })

  it('refuses markup, plurals, bad names and files it cannot round-trip', () => {
    expect(setAndroidString(XML, 'styled', 'x')).toEqual({ ok: false, error: 'not-editable' })
    expect(setAndroidString(XML, 'songs', 'x')).toEqual({ ok: false, error: 'not-editable' })
    expect(setAndroidString(XML, 'bad name', 'x')).toEqual({ ok: false, error: 'not-editable' })
    const dup = '<resources><string name="a">1</string><string name="a">2</string></resources>'
    expect(parseAndroidXml(dup).reason).toBe('duplicate')
    expect(setAndroidString(dup, 'a', 'x')).toEqual({ ok: false, error: 'read-only' })
    expect(parseAndroidXml('<!DOCTYPE resources [<!ENTITY n "x">]><resources></resources>').writable).toBe(false)
    expect(parseAndroidXml('<resources><string name="a">open').writable).toBe(false)
  })
})

const ARB = `{
  "@@locale": "en",
  "title": "Hello {name}",
  "@title": {
    "description": "Greeting",
    "placeholders": { "name": { "type": "String" } }
  },
  "count": "{n, plural, =0{none} one{{n} item} other{{n} items}}"
}
`

describe('ARB / JSON', () => {
  it('reads values, metadata and locale', () => {
    const doc = parseJsonStrings(ARB, true)!
    expect(doc.order).toEqual(['title', 'count'])
    expect(doc.locale).toBe('en')
    expect(doc.meta.has('@title')).toBe(true)
    expect(doc.entries.get('count')?.line).toBe(8)
  })

  it('edits in place and appends new keys with the same indent', () => {
    const r = setJsonString(ARB, 'title', 'Hi "{name}"', true)
    expect(r.ok && r.text).toBe(ARB.replace('"Hello {name}"', '"Hi \\"{name}\\""'))
    const add = setJsonString(ARB, 'bye', 'Bye', true)
    expect(add.ok && add.text).toBe(ARB.replace('items}}"\n}', 'items}}",\n  "bye": "Bye"\n}'))
  })

  it('flattens nested JSON and inserts into the parent object', () => {
    const json = '{\n    "home": {\n        "title": "Home"\n    },\n    "n": 3\n}'
    const doc = parseJsonStrings(json, false)!
    expect(doc.order).toEqual(['home.title', 'n'])
    expect(doc.entries.get('n')?.editable).toBe(false)
    const r = setJsonString(json, 'home.sub', 'Sub', false)
    expect(r.ok && r.text).toBe('{\n    "home": {\n        "title": "Home",\n        "sub": "Sub"\n    },\n    "n": 3\n}')
    expect(setJsonString(json, 'missing.parent', 'x', false)).toEqual({ ok: false, error: 'not-editable' })
    expect(setJsonString('{}', 'a', 'A', false)).toEqual({ ok: true, text: '{\n  "a": "A"\n}' })
    expect(setJsonString('{"a": "A"}', 'b', 'B', false)).toEqual({ ok: true, text: '{"a": "A", "b": "B"}' })
  })

  it('marks duplicates and broken JSON read only', () => {
    expect(parseJsonStrings('{"a":"1","a":"2"}', true)?.writable).toBe(false)
    expect(parseJsonStrings('{"a":', true)).toBeNull()
    expect(parseSource('flutter', 'nope')).toMatchObject({ writable: false, reason: 'invalid' })
  })
})

describe('placeholders', () => {
  it('numbers Android args and ignores %%', () => {
    expect(androidPlaceholders('%s of %d (100%%)')).toEqual(['%1$s', '%2$d'])
    expect(androidPlaceholders('%2$d / %1$s')).toEqual(['%1$s', '%2$d'])
    expect(androidPlaceholders('%.2f')).toEqual(['%1$f'])
  })
  it('finds ICU arguments, nested ones too', () => {
    expect(icuPlaceholders('Hi {name}, {count, plural, one{{count} new} other{{count} new from {who}}}')).toEqual(['count', 'name', 'who'])
    expect(icuPlaceholders("Use '{literal}' {x}")).toEqual(['x'])
    expect(icuPlaceholders('{d, date, short}')).toEqual(['d'])
  })
})

const src = (locale: string, text: string, kind: 'android' | 'flutter' = 'android'): LocaleSource => ({ locale, path: `/p/${locale}`, rel: `res/values-${locale}/strings.xml`, mtimeMs: 1, text, doc: parseSource(kind, text) })

describe('grid', () => {
  const base = src('default', '<resources><string name="a">Hello %1$s</string><string name="b">Bye</string><string name="k" translatable="false">K</string><plurals name="p"><item quantity="other">x</item></plurals></resources>')
  const vi = src('vi', '<resources><string name="a">Xin chào %1$d</string><string name="z">extra</string></resources>')
  const rows = buildRows('android', [base, vi])

  it('marks missing, fixed, extra and placeholder mismatch', () => {
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'k', 'p', 'z'])
    expect(byKey.a!.cells[1]!.mismatch).toEqual({ base: ['%1$s'], here: ['%1$d'] })
    expect(byKey.b!.cells[1]).toMatchObject({ state: 'missing', editable: true })
    expect(byKey.k!.cells[1]!.state).toBe('fixed')
    expect(byKey.p!.cells[1]).toMatchObject({ state: 'missing', editable: false })
    expect(byKey.z!).toMatchObject({ extra: true })
    expect(byKey.z!.cells[0]!.state).toBe('absent')
    expect(missingCounts(rows, 2)).toEqual([0, 2])
  })

  it('filters by missing / mismatch and search', () => {
    expect(filterRows(rows, { missingOnly: true, query: '' }).map((r) => r.key)).toEqual(['a', 'b', 'p'])
    expect(filterRows(rows, { missingOnly: false, query: 'chào' }).map((r) => r.key)).toEqual(['a'])
  })

  it('builds a prefill prompt for the chosen locales only', () => {
    const text = fillPrompt('android', [base, vi], rows, [1])!
    expect(text).toContain('vi → res/values-vi/strings.xml')
    expect(text).toContain('- b: "Bye"')
    expect(text).toContain('- p: "x" (plurals)')
    expect(text).not.toContain('- k:')
    expect(fillPrompt('android', [base, vi], rows, [0])).toBeNull()
  })

  it('knows which Explorer rows open the table', () => {
    expect(isStringsPath('res', true)).toBe(true)
    expect(isStringsPath('values-vi', true)).toBe(true)
    expect(isStringsPath('app_en.arb', false)).toBe(true)
    expect(isStringsPath('strings.xml', false)).toBe(true)
    expect(isStringsPath('colors.xml', false)).toBe(false)
  })
})
