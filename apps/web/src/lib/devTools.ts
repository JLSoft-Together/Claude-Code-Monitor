export const DEV_TOOLS = ['jwt', 'base64', 'url', 'time', 'count', 'uuid'] as const
export type DevTool = (typeof DEV_TOOLS)[number]

const utf8 = new TextEncoder()
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

function bytesToBinary(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return out
}

export function base64Encode(text: string, urlSafe = false): string {
  const b64 = btoa(bytesToBinary(utf8.encode(text)))
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64
}

/** Bytes of standard or URL-safe base64, padding optional, whitespace ignored; null when it is not base64. */
export function base64Bytes(input: string): Uint8Array | null {
  const clean = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null
  const bare = clean.replace(/=+$/, '')
  if (bare.length % 4 === 1) return null
  try {
    const bin = atob(bare + '='.repeat((4 - (bare.length % 4)) % 4))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** UTF-8 text of base64 input; null when it is not base64 or the bytes are not valid UTF-8. */
export function base64Decode(input: string): string | null {
  const bytes = base64Bytes(input)
  if (!bytes) return null
  try {
    return strictUtf8.decode(bytes)
  } catch {
    return null
  }
}

export const urlEncode = (text: string): string => encodeURIComponent(text)

export function urlDecode(text: string, plusAsSpace = false): string | null {
  try {
    return decodeURIComponent(plusAsSpace ? text.replace(/\+/g, ' ') : text)
  } catch {
    return null
  }
}

export interface JwtTime {
  claim: 'exp' | 'iat' | 'nbf'
  seconds: number
  ms: number
}
export type JwtDecoded =
  | {
      ok: true
      header: Record<string, unknown>
      payload: unknown
      signature: string
      times: JwtTime[]
      /** null without a numeric `exp`. */
      expired: boolean | null
      notYetValid: boolean
    }
  | { ok: false; error: 'empty' | 'parts' | 'base64' | 'json' }

const TIME_CLAIMS = ['exp', 'iat', 'nbf'] as const

function partJson(part: string): { value: unknown } | 'base64' | 'json' {
  const text = base64Decode(part)
  if (text === null) return 'base64'
  try {
    return { value: JSON.parse(text) }
  } catch {
    return 'json'
  }
}

/** Header + payload of a JWS compact token. The signature is never checked. */
export function decodeJwt(input: string, nowMs: number): JwtDecoded {
  const token = input.trim().replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, error: 'empty' }
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1]) return { ok: false, error: 'parts' }
  const header = partJson(parts[0])
  const payload = partJson(parts[1])
  for (const p of [header, payload]) if (typeof p === 'string') return { ok: false, error: p }
  const h = (header as { value: unknown }).value
  const body = (payload as { value: unknown }).value
  if (!h || typeof h !== 'object' || Array.isArray(h)) return { ok: false, error: 'json' }
  const claims = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const times: JwtTime[] = []
  for (const claim of TIME_CLAIMS) {
    const v = claims[claim]
    if (typeof v === 'number' && Number.isFinite(v)) times.push({ claim, seconds: v, ms: v * 1000 })
  }
  const exp = times.find((x) => x.claim === 'exp')
  const nbf = times.find((x) => x.claim === 'nbf')
  return {
    ok: true,
    header: h as Record<string, unknown>,
    payload: body,
    signature: parts[2] ?? '',
    times,
    expired: exp ? exp.ms <= nowMs : null,
    notYetValid: !!nbf && nbf.ms > nowMs,
  }
}

export const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2)

export type StampUnit = 's' | 'ms' | 'date'
export interface Stamp {
  ms: number
  unit: StampUnit
}

// Below 1e11 a number reads as seconds (until year 5138), above as milliseconds (from March 1973).
const MS_THRESHOLD = 1e11

/** A unix time (seconds or milliseconds, picked by size) or a date string; null when neither. */
export function parseStamp(input: string): Stamp | null {
  const s = input.trim()
  if (!s) return null
  if (/^[-+]?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (!Number.isFinite(n)) return null
    const unit: StampUnit = Math.abs(n) >= MS_THRESHOLD ? 'ms' : 's'
    const ms = unit === 'ms' ? n : n * 1000
    return Number.isNaN(new Date(ms).getTime()) ? null : { ms, unit }
  }
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? null : { ms, unit: 'date' }
}

export interface StampViews {
  seconds: string
  millis: string
  iso: string
  utc: string
  local: string
}

export function stampViews(ms: number, locale: string, timeZone?: string): StampViews {
  const d = new Date(ms)
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'long' }
  return {
    seconds: String(Math.floor(ms / 1000)),
    millis: String(Math.trunc(ms)),
    iso: d.toISOString(),
    utc: new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(d),
    local: new Intl.DateTimeFormat(locale, { ...opts, ...(timeZone ? { timeZone } : {}) }).format(d),
  }
}

export interface TextCounts {
  chars: number
  codePoints: number
  bytes: number
  lines: number
  words: number
}

export function countText(text: string): TextCounts {
  return {
    chars: text.length,
    codePoints: [...text].length,
    bytes: utf8.encode(text).length,
    lines: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
    words: text.split(/\s+/).filter(Boolean).length,
  }
}

export const UUID_MAX = 100
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function uuids(n: number, make: () => string = () => crypto.randomUUID()): string[] {
  const count = Math.min(UUID_MAX, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)))
  return Array.from({ length: count }, make)
}
