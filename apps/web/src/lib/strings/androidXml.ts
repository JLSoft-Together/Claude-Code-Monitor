import type { StringEntry, StringsDoc, WriteResult } from './types'

const OPEN_RE = /<(string-array|string|plurals)(?=[\s/>])([^>]*?)(\/?)>/g
export const ANDROID_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/

interface XmlEntry extends StringEntry {
  start: number
  tagEnd: number
  innerStart: number
  innerEnd: number
  selfClose: boolean
  cdata: boolean
}

export interface XmlDoc extends StringsDoc {
  entries: Map<string, XmlEntry>
  closeAt: number
}

/** Same length as `text`: comment bodies and CDATA contents blanked (newlines kept), so tag scans never look inside them. */
function structural(text: string): string {
  const out = text.split('')
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '
  }
  let i = 0
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      const stop = end < 0 ? text.length : end + 3
      blank(i, stop)
      i = stop
    } else if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9)
      const stop = end < 0 ? text.length : end
      blank(i + 9, stop)
      i = end < 0 ? text.length : end + 3
    } else i++
  }
  return out.join('')
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16))
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10))
    return ENTITIES[e] ?? m
  })
}

/** Inner XML of a `<string>` → the text Android shows: entities, CDATA, `\'` `\n` `\uXXXX` escapes, quotes and whitespace collapsing. */
export function decodeAndroid(inner: string): string {
  let xml = ''
  let i = 0
  while (i < inner.length) {
    const c = inner.indexOf('<![CDATA[', i)
    if (c < 0) {
      xml += decodeEntities(inner.slice(i))
      break
    }
    xml += decodeEntities(inner.slice(i, c))
    const end = inner.indexOf(']]>', c + 9)
    xml += inner.slice(c + 9, end < 0 ? inner.length : end)
    i = end < 0 ? inner.length : end + 3
  }
  let out = ''
  let quoted = false
  let pendingSpace = false
  for (let k = 0; k < xml.length; k++) {
    const ch = xml[k]!
    if (ch === '\\' && k + 1 < xml.length) {
      const n = xml[++k]!
      const add = n === 'n' ? '\n' : n === 't' ? '\t' : n === 'u' && /^[0-9a-fA-F]{4}$/.test(xml.slice(k + 1, k + 5)) ? String.fromCharCode(parseInt(xml.slice(k + 1, (k += 4) + 1), 16)) : n
      if (pendingSpace && out) out += ' '
      pendingSpace = false
      out += add
      continue
    }
    if (ch === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && /\s/.test(ch)) {
      pendingSpace = true
      continue
    }
    if (pendingSpace && out) out += ' '
    pendingSpace = false
    out += ch
  }
  return out
}

/** Text → inner XML Android reads back as the same text (null when a CDATA value would hold `]]>`). */
export function encodeAndroid(value: string, cdata = false): string | null {
  if (cdata && value.includes(']]>')) return null
  let s = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
  if (/^[@?]/.test(s)) s = `\\${s}`
  if (!cdata) s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return /^ | $| {2}/.test(s) ? `"${s}"` : s
}

const lineAt = (text: string, index: number): number => {
  let n = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

const attr = (attrs: string, name: string): string | undefined => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1]

export function parseAndroidXml(text: string): XmlDoc {
  const scan = structural(text)
  const entries = new Map<string, XmlEntry>()
  const order: string[] = []
  let reason: StringsDoc['reason']
  if (/<!DOCTYPE|<!ENTITY/i.test(scan)) reason = 'doctype'
  const opens = scan.match(/<resources[\s>]/g)?.length ?? 0
  const closeAt = scan.lastIndexOf('</resources>')
  if (opens !== 1 || closeAt < 0 || scan.indexOf('</resources>') !== closeAt) reason ??= 'structure'
  OPEN_RE.lastIndex = 0
  for (let m = OPEN_RE.exec(scan); m; m = OPEN_RE.exec(scan)) {
    const tag = m[1]!
    const attrs = m[2] ?? ''
    const start = m.index
    const tagEnd = start + m[0].length
    const selfClose = m[3] === '/'
    let innerEnd = tagEnd
    let end = tagEnd
    if (!selfClose) {
      const close = new RegExp(`</${tag}\\s*>`, 'g')
      close.lastIndex = tagEnd
      const c = close.exec(scan)
      if (!c) {
        reason ??= 'structure'
        break
      }
      innerEnd = c.index
      end = c.index + c[0].length
      OPEN_RE.lastIndex = end
    }
    const name = attr(attrs, 'name')
    if (!name) continue
    if (entries.has(name)) reason ??= 'duplicate'
    const inner = text.slice(tagEnd, innerEnd)
    const innerScan = scan.slice(tagEnd, innerEnd)
    const fixed = attr(attrs, 'translatable') === 'false'
    const base = { key: name, line: lineAt(text, start), start, tagEnd, innerStart: tagEnd, innerEnd, selfClose, ...(fixed ? { fixed } : {}) }
    if (tag === 'string') {
      const markup = /<(?!!\[CDATA\[)/.test(innerScan)
      const trimmed = inner.trim()
      const cdata = trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>') && trimmed.indexOf(']]>') === trimmed.length - 3
      const hasCdata = inner.includes('<![CDATA[')
      entries.set(name, { ...base, kind: 'string', value: decodeAndroid(inner), editable: !markup && (!hasCdata || cdata), cdata, ...(markup ? { why: 'markup' as const } : hasCdata && !cdata ? { why: 'markup' as const } : {}) })
    } else {
      const items: { label: string; value: string }[] = []
      const itemRe = /<item\b([^>]*)>([\s\S]*?)<\/item\s*>/g
      for (const it of innerScan.matchAll(itemRe)) {
        const at = (it.index ?? 0) + it[0].indexOf('>') + 1
        const raw = text.slice(tagEnd + at, tagEnd + at + it[2]!.length)
        items.push({ label: attr(it[1] ?? '', 'quantity') ?? String(items.length), value: decodeAndroid(raw) })
      }
      entries.set(name, { ...base, kind: tag === 'plurals' ? 'plurals' : 'array', value: items.map((x) => x.value).join('\n'), items, editable: false, why: tag === 'plurals' ? 'plurals' : 'array', cdata: false })
    }
    order.push(name)
  }
  return { entries, order, writable: !reason, ...(reason ? { reason } : {}), closeAt }
}

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

function indentOf(text: string, doc: XmlDoc): string {
  const first = doc.order.length ? doc.entries.get(doc.order[0]!) : undefined
  if (first) {
    const lineStart = text.lastIndexOf('\n', first.start - 1) + 1
    const lead = text.slice(lineStart, first.start)
    if (/^[ \t]*$/.test(lead)) return lead
  }
  return '    '
}

/** Sets (or adds) `<string name=key>`: a minimal splice; refused when the file or entry cannot round-trip safely. */
export function setAndroidString(text: string, key: string, value: string): WriteResult {
  const doc = parseAndroidXml(text)
  if (!doc.writable) return { ok: false, error: 'read-only' }
  const e = doc.entries.get(key)
  let next: string
  if (e) {
    if (e.kind !== 'string' || !e.editable) return { ok: false, error: 'not-editable' }
    const enc = encodeAndroid(value, e.cdata)
    if (enc === null) return { ok: false, error: 'not-editable' }
    if (e.selfClose) {
      const open = text.slice(e.start, e.tagEnd).replace(/\s*\/>$/, '>')
      next = `${text.slice(0, e.start)}${open}${enc}</string>${text.slice(e.tagEnd)}`
    } else if (e.cdata) {
      const inner = text.slice(e.innerStart, e.innerEnd)
      const a = inner.indexOf('<![CDATA[') + 9
      const b = inner.lastIndexOf(']]>')
      next = text.slice(0, e.innerStart) + inner.slice(0, a) + enc + inner.slice(b) + text.slice(e.innerEnd)
    } else next = text.slice(0, e.innerStart) + enc + text.slice(e.innerEnd)
  } else {
    if (!ANDROID_NAME.test(key)) return { ok: false, error: 'not-editable' }
    const enc = encodeAndroid(value)!
    const eol = eolOf(text)
    const line = `${indentOf(text, doc)}<string name="${key}">${enc}</string>`
    const lineStart = text.lastIndexOf('\n', doc.closeAt - 1) + 1
    next = /^[ \t]*$/.test(text.slice(lineStart, doc.closeAt))
      ? `${text.slice(0, lineStart)}${line}${eol}${text.slice(lineStart)}`
      : `${text.slice(0, doc.closeAt)}${eol}${line}${eol}${text.slice(doc.closeAt)}`
  }
  return verify(text, next, key, value)
}

function verify(before: string, after: string, key: string, value: string): WriteResult {
  const a = parseAndroidXml(before)
  const b = parseAndroidXml(after)
  if (!b.writable || b.entries.get(key)?.value !== value) return { ok: false, error: 'verify' }
  for (const [k, e] of a.entries) {
    if (k === key) continue
    const f = b.entries.get(k)
    if (!f || f.value !== e.value || f.kind !== e.kind) return { ok: false, error: 'verify' }
  }
  if (b.entries.size !== a.entries.size + (a.entries.has(key) ? 0 : 1)) return { ok: false, error: 'verify' }
  return { ok: true, text: after }
}
