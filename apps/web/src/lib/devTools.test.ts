import { describe, expect, it } from 'vitest'
import {
  base64Bytes,
  base64Decode,
  base64Encode,
  countText,
  decodeJwt,
  parseStamp,
  prettyJson,
  stampViews,
  urlDecode,
  urlEncode,
  UUID_MAX,
  UUID_RE,
  uuids,
} from './devTools'

const b64url = (v: unknown) => base64Encode(JSON.stringify(v), true)
const jwt = (header: unknown, payload: unknown, sig = 'c2ln') => `${b64url(header)}.${b64url(payload)}.${sig}`
const NOW = 1_800_000_000_000

describe('base64', () => {
  it('round-trips UTF-8 text, including astral characters', () => {
    for (const s of ['', 'a', 'hello world', 'Tiếng Việt có dấu', '😀 emoji 𝄞', 'ab\u0000c']) {
      expect(base64Decode(base64Encode(s))).toBe(s)
      expect(base64Decode(base64Encode(s, true))).toBe(s)
    }
  })

  it('encodes known vectors, URL-safe without padding', () => {
    expect(base64Encode('foobar')).toBe('Zm9vYmFy')
    expect(base64Encode('fo')).toBe('Zm8=')
    expect(base64Encode('é')).toBe('w6k=')
    expect(base64Encode('ûÿ', false)).toBe('w7vDvw==')
    expect(base64Encode('>>>???')).toBe('Pj4+Pz8/')
    expect(base64Encode('>>>???', true)).toBe('Pj4-Pz8_')
    expect(base64Encode('fo', true)).toBe('Zm8')
  })

  it('decodes either alphabet, missing padding and whitespace', () => {
    expect(base64Decode('Pj4-Pz8_')).toBe('>>>???')
    expect(base64Decode('Pj4+Pz8/')).toBe('>>>???')
    expect(base64Decode('Zm8')).toBe('fo')
    expect(base64Decode(' Zm9v\nYmFy ')).toBe('foobar')
  })

  it('refuses what is not base64 or not UTF-8', () => {
    expect(base64Decode('a$b')).toBeNull()
    expect(base64Decode('Zm9vY')).toBeNull()
    expect(base64Decode('Zm=9v')).toBeNull()
    expect(base64Decode('/w==')).toBeNull()
    expect(base64Bytes('/w==')).toEqual(Uint8Array.from([255]))
  })

  it('handles large input without blowing the stack', () => {
    const big = 'x'.repeat(200_000)
    expect(base64Decode(base64Encode(big))).toBe(big)
  })
})

describe('url', () => {
  it('encodes a URI component and decodes it back', () => {
    expect(urlEncode('a b&c=d/é?')).toBe('a%20b%26c%3Dd%2F%C3%A9%3F')
    expect(urlDecode('a%20b%26c%3Dd%2F%C3%A9%3F')).toBe('a b&c=d/é?')
  })
  it('keeps + unless asked to read it as a space', () => {
    expect(urlDecode('a+b')).toBe('a+b')
    expect(urlDecode('a+b', true)).toBe('a b')
  })
  it('returns null on malformed escapes', () => {
    expect(urlDecode('%E0%A4%A')).toBeNull()
    expect(urlDecode('%')).toBeNull()
  })
})

describe('decodeJwt', () => {
  it('decodes header and payload, lists time claims', () => {
    const res = decodeJwt(jwt({ alg: 'HS256', typ: 'JWT' }, { sub: 'u1', name: 'Đoàn', iat: 1_700_000_000, exp: 1_900_000_000, nbf: 1_700_000_000 }), NOW)
    if (!res.ok) throw new Error(res.error)
    expect(res.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(res.payload).toMatchObject({ sub: 'u1', name: 'Đoàn' })
    expect(res.signature).toBe('c2ln')
    expect(res.times.map((x) => x.claim)).toEqual(['exp', 'iat', 'nbf'])
    expect(res.times[0]!.ms).toBe(1_900_000_000_000)
    expect(res.expired).toBe(false)
    expect(res.notYetValid).toBe(false)
  })

  it('flags expired and not-yet-valid tokens', () => {
    const old = decodeJwt(jwt({ alg: 'none' }, { exp: 1_700_000_000 }), NOW)
    expect(old.ok && old.expired).toBe(true)
    const future = decodeJwt(jwt({ alg: 'none' }, { nbf: 1_900_000_000 }), NOW)
    expect(future.ok && future.notYetValid).toBe(true)
    expect(future.ok && future.expired).toBeNull()
    const edge = decodeJwt(jwt({ alg: 'none' }, { exp: NOW / 1000 }), NOW)
    expect(edge.ok && edge.expired).toBe(true)
  })

  it('ignores non-numeric time claims and non-object payloads', () => {
    const s = decodeJwt(jwt({ alg: 'none' }, { exp: '1900000000' }), NOW)
    expect(s.ok && s.times).toEqual([])
    const arr = decodeJwt(jwt({ alg: 'none' }, [1, 2]), NOW)
    expect(arr.ok && arr.payload).toEqual([1, 2])
  })

  it('accepts a Bearer prefix, surrounding space and an empty signature', () => {
    const res = decodeJwt(`  Bearer ${jwt({ alg: 'none' }, { a: 1 }, '')}\n`, NOW)
    expect(res.ok && res.payload).toEqual({ a: 1 })
  })

  it('reports why a token cannot be read', () => {
    expect(decodeJwt('   ', NOW)).toEqual({ ok: false, error: 'empty' })
    expect(decodeJwt('a.b', NOW)).toEqual({ ok: false, error: 'parts' })
    expect(decodeJwt('a.b.c.d', NOW)).toEqual({ ok: false, error: 'parts' })
    expect(decodeJwt('.b.c', NOW)).toEqual({ ok: false, error: 'parts' })
    expect(decodeJwt('a$.b.c', NOW)).toEqual({ ok: false, error: 'base64' })
    expect(decodeJwt(`${base64Encode('not json', true)}.${b64url({})}.x`, NOW)).toEqual({ ok: false, error: 'json' })
    expect(decodeJwt(`${b64url([1])}.${b64url({})}.x`, NOW)).toEqual({ ok: false, error: 'json' })
  })

  it('pretty prints JSON with two spaces', () => {
    expect(prettyJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}')
  })
})

describe('timestamps', () => {
  it('auto-detects seconds and milliseconds by size', () => {
    expect(parseStamp('1700000000')).toEqual({ ms: 1_700_000_000_000, unit: 's' })
    expect(parseStamp('1700000000123')).toEqual({ ms: 1_700_000_000_123, unit: 'ms' })
    expect(parseStamp(' 0 ')).toEqual({ ms: 0, unit: 's' })
    expect(parseStamp('-86400')).toEqual({ ms: -86_400_000, unit: 's' })
    expect(parseStamp('1700000000.5')).toEqual({ ms: 1_700_000_000_500, unit: 's' })
  })

  it('reads date strings', () => {
    expect(parseStamp('2023-11-14T22:13:20Z')).toEqual({ ms: 1_700_000_000_000, unit: 'date' })
    expect(parseStamp('2023-11-14T22:13:20.000+07:00')?.ms).toBe(1_700_000_000_000 - 7 * 3_600_000)
  })

  it('returns null for empty, junk or out-of-range input', () => {
    expect(parseStamp('')).toBeNull()
    expect(parseStamp('soon')).toBeNull()
    expect(parseStamp('99999999999999999999')).toBeNull()
  })

  it('formats seconds, ms, ISO, UTC and local in the given zone', () => {
    const v = stampViews(1_700_000_000_123, 'en-US', 'Asia/Ho_Chi_Minh')
    expect(v.seconds).toBe('1700000000')
    expect(v.millis).toBe('1700000000123')
    expect(v.iso).toBe('2023-11-14T22:13:20.123Z')
    expect(v.utc).toContain('November 14, 2023')
    expect(v.utc).toContain('10:13:20')
    expect(v.local).toContain('November 15, 2023')
    expect(v.local).toContain('5:13:20')
  })
})

describe('countText', () => {
  it('counts an empty string as nothing', () => {
    expect(countText('')).toEqual({ chars: 0, codePoints: 0, bytes: 0, lines: 0, words: 0 })
  })
  it('separates UTF-16 units, code points and UTF-8 bytes', () => {
    expect(countText('😀')).toEqual({ chars: 2, codePoints: 1, bytes: 4, lines: 1, words: 1 })
    expect(countText('Việt')).toMatchObject({ chars: 4, codePoints: 4, bytes: 6 })
    expect(countText('é')).toMatchObject({ chars: 2, codePoints: 2, bytes: 3 })
  })
  it('counts lines across LF, CRLF and CR, and words on whitespace', () => {
    expect(countText('a\nb\r\nc\rd')).toMatchObject({ lines: 4, words: 4 })
    expect(countText('one  two\tthree\n')).toMatchObject({ lines: 2, words: 3 })
    expect(countText('   ')).toMatchObject({ lines: 1, words: 0 })
  })
})

describe('uuids', () => {
  it('makes v4 UUIDs with crypto.randomUUID', () => {
    const list = uuids(5)
    expect(list).toHaveLength(5)
    for (const u of list) expect(u).toMatch(UUID_RE)
    expect(new Set(list).size).toBe(5)
  })
  it('clamps the count to 1..UUID_MAX', () => {
    const make = () => 'x'
    expect(uuids(0, make)).toHaveLength(1)
    expect(uuids(-3, make)).toHaveLength(1)
    expect(uuids(Number.NaN, make)).toHaveLength(1)
    expect(uuids(2.9, make)).toHaveLength(2)
    expect(uuids(10_000, make)).toHaveLength(UUID_MAX)
  })
})
