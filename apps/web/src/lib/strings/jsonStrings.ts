import type { StringEntry, StringsDoc, WriteResult } from './types'

interface JsonEntry extends StringEntry {
  start: number
  end: number
}

interface JsonObject {
  open: number
  close: number
  /** End of the last member's value, null when empty. */
  lastEnd: number | null
  /** Leading whitespace of the first member's line; null when the first member sits on the `{` line. */
  indent: string | null
  hasMembers: boolean
}

export interface JsonDoc extends StringsDoc {
  entries: Map<string, JsonEntry>
  objects: Map<string, JsonObject>
  /** ARB `@@locale`. */
  locale: string | null
  /** ARB `@key` metadata names (kept, never shown). */
  meta: Set<string>
}

class Bad extends Error {}

/**
 * JSON object → string leaves with the span of each value. ARB (`arb`): top-level keys only, `@key` metadata and
 * `@@locale` set aside. Plain JSON: nested objects flattened with dots. Null when the text is not a JSON object.
 */
export function parseJsonStrings(text: string, arb: boolean): JsonDoc | null {
  const src = text
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0
  let line = 1
  const entries = new Map<string, JsonEntry>()
  const order: string[] = []
  const objects = new Map<string, JsonObject>()
  const meta = new Set<string>()
  let locale: string | null = null
  let duplicate = false
  const ws = () => {
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '\n') line++
      else if (c !== ' ' && c !== '\t' && c !== '\r') break
    }
  }
  const str = (): string => {
    if (src[i] !== '"') throw new Bad()
    const start = ++i
    for (; i < src.length && src[i] !== '"'; i++) {
      if (src[i] === '\\') i++
      else if (src[i] === '\n') throw new Bad()
    }
    if (i >= src.length) throw new Bad()
    return JSON.parse(`"${src.slice(start, i++)}"`) as string
  }
  const lineIndent = (at: number): string | null => {
    const ls = src.lastIndexOf('\n', at - 1) + 1
    const lead = src.slice(ls, at)
    return /^[ \t]*$/.test(lead) ? lead : null
  }
  const skipValue = (): void => {
    ws()
    const c = src[i]
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']'
      i++
      ws()
      if (src[i] === close) {
        i++
        return
      }
      for (;;) {
        ws()
        if (c === '{') {
          str()
          ws()
          if (src[i++] !== ':') throw new Bad()
        }
        skipValue()
        ws()
        if (src[i] === ',') i++
        else if (src[i] === close) {
          i++
          return
        } else throw new Bad()
      }
    }
    if (c === '"') {
      str()
      return
    }
    const m = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(src.slice(i, i + 64))
    if (!m) throw new Bad()
    i += m[0].length
  }
  const object = (path: string, depth: number): void => {
    const open = i++
    const obj: JsonObject = { open, close: -1, lastEnd: null, indent: null, hasMembers: false }
    const seen = new Set<string>()
    ws()
    if (src[i] === '}') {
      obj.close = i++
      objects.set(path, obj)
      return
    }
    for (;;) {
      ws()
      const keyAt = i
      const keyLine = line
      const k = str()
      if (!obj.hasMembers) {
        obj.hasMembers = true
        obj.indent = src.slice(open, keyAt).includes('\n') ? lineIndent(keyAt) : null
      }
      if (seen.has(k)) duplicate = true
      seen.add(k)
      ws()
      if (src[i++] !== ':') throw new Bad()
      ws()
      const full = path ? `${path}.${k}` : k
      const vStart = i
      if (arb && depth === 0 && k.startsWith('@')) {
        if (k === '@@locale' && src[i] === '"') locale = str()
        else skipValue()
        if (k !== '@@locale') meta.add(k)
      } else if (src[i] === '{' && !arb) object(full, depth + 1)
      else if (src[i] === '"') {
        const value = str()
        if (entries.has(full)) duplicate = true
        entries.set(full, { key: full, kind: 'string', value, line: keyLine, editable: true, start: vStart, end: i })
        order.push(full)
      } else {
        skipValue()
        if (entries.has(full)) duplicate = true
        entries.set(full, { key: full, kind: 'string', value: src.slice(vStart, i), line: keyLine, editable: false, why: 'not-string', start: vStart, end: i })
        order.push(full)
      }
      obj.lastEnd = i
      ws()
      if (src[i] === ',') i++
      else if (src[i] === '}') {
        obj.close = i++
        objects.set(path, obj)
        return
      } else throw new Bad()
    }
  }
  try {
    ws()
    if (src[i] !== '{') return null
    object('', 0)
    ws()
    if (i !== src.length) return null
  } catch {
    return null
  }
  return { entries, order, objects, locale, meta, writable: !duplicate, ...(duplicate ? { reason: 'duplicate' as const } : {}) }
}

const eolOf = (text: string): string => (text.includes('\r\n') ? '\r\n' : '\n')

/** Sets (or adds) a string value with a minimal splice; key order, indent and every other byte stay as they were. */
export function setJsonString(text: string, key: string, value: string, arb: boolean): WriteResult {
  const doc = parseJsonStrings(text, arb)
  if (!doc) return { ok: false, error: 'read-only' }
  if (!doc.writable) return { ok: false, error: 'read-only' }
  const enc = JSON.stringify(value)
  const e = doc.entries.get(key)
  let next: string
  if (e) {
    if (!e.editable) return { ok: false, error: 'not-editable' }
    next = text.slice(0, e.start) + enc + text.slice(e.end)
  } else {
    if (arb && key.startsWith('@')) return { ok: false, error: 'not-editable' }
    const dot = arb ? -1 : key.lastIndexOf('.')
    const parentPath = dot < 0 ? '' : key.slice(0, dot)
    const name = dot < 0 ? key : key.slice(dot + 1)
    const parent = doc.objects.get(parentPath)
    if (!parent || !name) return { ok: false, error: 'not-editable' }
    const member = `${JSON.stringify(name)}: ${enc}`
    const eol = eolOf(text)
    if (parent.lastEnd === null) {
      if (parentPath) return { ok: false, error: 'not-editable' }
      next = `${text.slice(0, parent.open + 1)}${eol}  ${member}${eol}${text.slice(parent.close)}`
    } else if (parent.indent === null) next = `${text.slice(0, parent.lastEnd)}, ${member}${text.slice(parent.lastEnd)}`
    else next = `${text.slice(0, parent.lastEnd)},${eol}${parent.indent}${member}${text.slice(parent.lastEnd)}`
  }
  const after = parseJsonStrings(next, arb)
  if (!after?.writable || after.entries.get(key)?.value !== value) return { ok: false, error: 'verify' }
  for (const [k, x] of doc.entries) if (k !== key && after.entries.get(k)?.value !== x.value) return { ok: false, error: 'verify' }
  if (after.entries.size !== doc.entries.size + (e ? 0 : 1) || after.meta.size !== doc.meta.size || after.locale !== doc.locale) return { ok: false, error: 'verify' }
  return { ok: true, text: next }
}
