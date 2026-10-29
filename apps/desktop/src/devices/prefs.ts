import type { PrefEdit, PrefEntry, PrefType } from '@ccm/shared'
import { decodeXml, xmlAttrs } from './uiDump'

export const PREF_TYPES: readonly PrefType[] = ['string', 'int', 'long', 'float', 'boolean', 'set']
const ENTRIES_MAX = 5000
const STRING_MAX = 100_000
const SET_MAX = 1000
const KEY_MAX = 1024
// XML 1.0 forbids these; SharedPreferences could never read them back.
const BAD_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/

interface Located extends PrefEntry {
  start: number
  end: number
}

const ELEMENT = /<(string|int|long|float|boolean|set|null)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/g

function locate(xml: string): Located[] | null {
  const map = /<map\b[^>]*>([\s\S]*)<\/map\s*>|<map\b[^>]*\/>/.exec(xml)
  if (!map) return null
  if (map[1] === undefined) return []
  const base = map.index + map[0].indexOf(map[1])
  const body = map[1].replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length))
  const out: Located[] = []
  for (const m of body.matchAll(ELEMENT)) {
    if (out.length >= ENTRIES_MAX) break
    const type = m[1] as PrefType | 'null'
    if (type === 'null') continue
    const attrs = xmlAttrs(m[2]!)
    const key = attrs.name
    if (key === undefined) continue
    const inner = m[4] ?? ''
    const value =
      type === 'set' ? [...inner.matchAll(/<string>([\s\S]*?)<\/string\s*>/g)].map((s) => decodeXml(s[1]!)) : type === 'string' ? decodeXml(inner) : (attrs.value ?? '')
    out.push({ key, type, value, start: base + m.index!, end: base + m.index! + m[0].length })
  }
  return out
}

/** SharedPreferences XML → entries in file order; null when the file has no `<map>`. `<null>` entries are left out (and left alone on edit). */
export function parsePrefs(xml: string): PrefEntry[] | null {
  return locate(xml)?.map(({ key, type, value }) => ({ key, type, value })) ?? null
}

const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function prefElement(e: PrefEntry): string {
  const name = escText(e.key)
  if (e.type === 'string') return `<string name="${name}">${escText(e.value as string)}</string>`
  if (e.type === 'set') return `<set name="${name}">${(e.value as string[]).map((v) => `<string>${escText(v)}</string>`).join('')}</set>`
  return `<${e.type} name="${name}" value="${escText(e.value as string)}" />`
}

const INT = /^-?\d{1,19}$/
const FLOAT = /^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/

/** A value the type can hold; numbers in the form Android writes them back. */
export function cleanPrefValue(type: PrefType, v: unknown): string | string[] | null {
  if (type === 'set') {
    if (!Array.isArray(v) || v.length > SET_MAX) return null
    return v.every((s) => typeof s === 'string' && s.length <= STRING_MAX && !BAD_CHARS.test(s)) ? (v as string[]) : null
  }
  if (typeof v !== 'string') return null
  const s = type === 'string' ? v : v.trim()
  switch (type) {
    case 'string':
      return s.length <= STRING_MAX && !BAD_CHARS.test(s) ? s : null
    case 'boolean':
      return s === 'true' || s === 'false' ? s : null
    case 'int':
      return INT.test(s) && Number(s) >= -2147483648 && Number(s) <= 2147483647 ? String(Number(s)) : null
    case 'long': {
      if (!INT.test(s)) return null
      const n = BigInt(s)
      return n >= -(2n ** 63n) && n < 2n ** 63n ? n.toString() : null
    }
    case 'float':
      return FLOAT.test(s) && Number.isFinite(Number(s)) ? s : null
  }
}

export function cleanPrefEdit(v: unknown): PrefEdit | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (typeof e.key !== 'string' || !e.key || e.key.length > KEY_MAX || BAD_CHARS.test(e.key)) return null
  if (!PREF_TYPES.includes(e.type as PrefType)) return null
  const type = e.type as PrefType
  // `before` is compared with the file as read, not normalized.
  const before = type === 'set' ? (Array.isArray(e.before) && e.before.every((s) => typeof s === 'string') ? (e.before as string[]) : null) : typeof e.before === 'string' ? e.before : null
  const after = cleanPrefValue(type, e.after)
  return before !== null && after !== null ? { key: e.key, type, before, after } : null
}

const sameValue = (a: string | string[], b: string | string[]): boolean =>
  Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b

/** Replaces only the edited element, so every other byte of the file (comments, `<null>`, order) stays. */
export function applyPrefEdit(xml: string, edit: PrefEdit): { ok: true; xml: string } | { ok: false; error: 'changed' | 'invalid' } {
  const entries = locate(xml)
  if (!entries) return { ok: false, error: 'invalid' }
  const hit = entries.filter((e) => e.key === edit.key)
  if (hit.length !== 1 || hit[0]!.type !== edit.type || !sameValue(hit[0]!.value, edit.before)) return { ok: false, error: 'changed' }
  const e = hit[0]!
  return { ok: true, xml: xml.slice(0, e.start) + prefElement({ key: edit.key, type: edit.type, value: edit.after }) + xml.slice(e.end) }
}

export const prefShown = (v: string | string[]): string => (Array.isArray(v) ? `[${v.join(', ')}]` : v)
