/** Colour literals in source text for the editor's inline swatches: find, parse, and rewrite keeping their format. */

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0–1 */
  a: number
}

export type ColorFormat = 'hex' | 'rgb' | 'flutter'

export interface ColorMatch {
  from: number
  to: number
  text: string
  format: ColorFormat
  color: Rgba
}

// Android resources and Kotlin / Java / Dart code put alpha first in an 8-digit hex (#AARRGGBB); CSS puts it last.
const ARGB_GRAMMARS = new Set(['xml', 'kotlin', 'java', 'dart', 'groovy'])
// Where `#123` is more likely an issue number or a comment than a colour.
const NO_DIGIT_HEX = new Set(['markdown', 'diff', 'shellscript', 'powershell', 'python', 'ruby', 'yaml', 'toml', 'ini', 'dockerfile'])

export const alphaFirst = (grammar: string | null): boolean => !!grammar && ARGB_GRAMMARS.has(grammar)

const HEX_RE = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g
const RGB_RE = /\brgba?\(([^()]*)\)/gi
const FLUTTER_RE = /\bColor\(\s*0[xX]([0-9a-fA-F]{8})\s*\)/g
const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)%?/g

const byte = (h: string): number => Number.parseInt(h.length === 1 ? h + h : h, 16)

export function parseHex(digits: string, argb: boolean): Rgba | null {
  const short = digits.length <= 4
  const parts = short ? [...digits] : (digits.match(/../g) ?? [])
  if (parts.length < 3 || parts.length > 4) return null
  const alpha = parts.length === 4 ? byte(argb ? parts.shift()! : parts.pop()!) / 255 : 1
  const [r, g, b] = parts.map(byte) as [number, number, number]
  return { r, g, b, a: alpha }
}

const channel = (tok: string): number => {
  const v = Number.parseFloat(tok)
  return Math.round(Math.min(255, Math.max(0, tok.endsWith('%') ? (v / 100) * 255 : v)))
}

export function parseRgbArgs(args: string): Rgba | null {
  const comma = /^\s*([^\s,]+)\s*,\s*([^\s,]+)\s*,\s*([^\s,]+)\s*(?:,\s*([^\s,]+)\s*)?$/.exec(args)
  const space = comma ? null : /^\s*([^\s/]+)\s+([^\s/]+)\s+([^\s/]+)\s*(?:\/\s*([^\s/]+)\s*)?$/.exec(args)
  const m = comma ?? space
  if (!m) return null
  const toks = [m[1]!, m[2]!, m[3]!]
  if (!toks.every((x) => /^(?:\d+\.?\d*|\.\d+)%?$/.test(x))) return null
  let a = 1
  if (m[4] !== undefined) {
    if (!/^(?:\d+\.?\d*|\.\d+)%?$/.test(m[4])) return null
    const v = Number.parseFloat(m[4])
    a = Math.min(1, Math.max(0, m[4].endsWith('%') ? v / 100 : v))
  }
  const [r, g, b] = toks.map(channel) as [number, number, number]
  return { r, g, b, a }
}

/** Colour literals in `text` (offsets into it), sorted by position. */
export function findColors(text: string, grammar: string | null): ColorMatch[] {
  const out: ColorMatch[] = []
  const argb = alphaFirst(grammar)
  const skipDigits = !grammar || NO_DIGIT_HEX.has(grammar)
  for (const m of text.matchAll(HEX_RE)) {
    const at = m.index
    const before = at > 0 ? text[at - 1]! : ''
    // `&#123;` entities, `a.#priv` fields, `x#anchor` fragments.
    if (/[\w&#.]/.test(before)) continue
    if (skipDigits && /^\d+$/.test(m[1]!)) continue
    const color = parseHex(m[1]!, argb)
    if (color) out.push({ from: at, to: at + m[0].length, text: m[0], format: 'hex', color })
  }
  for (const m of text.matchAll(RGB_RE)) {
    const color = parseRgbArgs(m[1]!)
    if (color) out.push({ from: m.index, to: m.index + m[0].length, text: m[0], format: 'rgb', color })
  }
  for (const m of text.matchAll(FLUTTER_RE)) {
    const color = parseHex(m[1]!, true)
    if (color) out.push({ from: m.index, to: m.index + m[0].length, text: m[0], format: 'flutter', color })
  }
  return out.sort((x, y) => x.from - y.from)
}

const hex2 = (n: number): string => Math.round(n).toString(16).padStart(2, '0')

/** `#rrggbb` for `<input type=color>` (it has no alpha). */
export const toInputHex = (c: Rgba): string => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`

export function fromInputHex(value: string): Pick<Rgba, 'r' | 'g' | 'b'> | null {
  const c = /^#[0-9a-fA-F]{6}$/.test(value) ? parseHex(value.slice(1), false) : null
  return c ? { r: c.r, g: c.g, b: c.b } : null
}

export const cssColor = (c: Rgba): string => `rgb(${c.r} ${c.g} ${c.b} / ${Math.round(c.a * 1000) / 1000})`

const casing = (sample: string, out: string): string => (/[A-F]/.test(sample) ? out.toUpperCase() : out)

/** The literal rewritten with a new RGB; alpha, length, case, separators and channel units stay as they were. */
export function replaceRgb(literal: string, rgb: Pick<Rgba, 'r' | 'g' | 'b'>, grammar: string | null): string {
  const rgbHex = `${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`
  if (literal.startsWith('#')) {
    const digits = literal.slice(1)
    const argb = alphaFirst(grammar)
    if (digits.length <= 4) {
      const fits = rgbHex[0] === rgbHex[1] && rgbHex[2] === rgbHex[3] && rgbHex[4] === rgbHex[5]
      const alpha = digits.length === 4 ? (argb ? digits[0]! : digits[3]!) : ''
      const body = fits ? `${rgbHex[0]}${rgbHex[2]}${rgbHex[4]}` : rgbHex
      const a = fits ? alpha : alpha + alpha
      return `#${casing(digits, argb ? a + body : body + a)}`
    }
    const alpha = digits.length === 8 ? (argb ? digits.slice(0, 2) : digits.slice(6)) : ''
    return `#${casing(digits, argb ? alpha + rgbHex : rgbHex + alpha)}`
  }
  const flutter = /^(Color\(\s*0[xX])([0-9a-fA-F]{2})[0-9a-fA-F]{6}(\s*\))$/.exec(literal)
  if (flutter) return `${flutter[1]}${flutter[2]}${casing(literal.slice(flutter[1]!.length + 2), rgbHex)}${flutter[3]}`
  const fn = /^(rgba?\()([^()]*)(\))$/i.exec(literal)
  if (!fn) return literal
  const values = [rgb.r, rgb.g, rgb.b]
  let k = 0
  const args = fn[2]!.replace(NUM_RE, (tok) => {
    if (k >= 3) return tok
    const v = values[k++]!
    return tok.endsWith('%') ? `${Math.round((v / 255) * 1000) / 10}%` : String(v)
  })
  return `${fn[1]}${args}${fn[3]}`
}
