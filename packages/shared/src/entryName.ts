/** Why a new file/folder name is refused; the web maps each code to an i18n sentence. */
export type EntryNameProblem = 'empty' | 'space' | 'control' | 'separator' | 'character' | 'reserved' | 'dot' | 'device' | 'long'

export type EntryNameCheck = { ok: true } | { ok: false; reason: EntryNameProblem }

/** Path-component limit on every platform the app ships to, in UTF-8 bytes. */
const MAX_NAME_BYTES = 255

/** DOS device names, with or without an extension, any case. */
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/** Refused by Windows in any file name. */
const WINDOWS_FORBIDDEN = /[<>:"|?*]/

// No DOM / Node lib in this package: count UTF-8 bytes by code point.
function utf8Length(s: string): number {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/**
 * Whether `name` may be created inside a project folder. Windows rules apply on every platform
 * (a repo is shared). The renderer checks for the dialog; main checks again before creating.
 */
export function checkEntryName(name: unknown): EntryNameCheck {
  const no = (reason: EntryNameProblem): EntryNameCheck => ({ ok: false, reason })
  if (typeof name !== 'string' || name === '') return no('empty')
  if (name !== name.trim()) return no('space')
  if (CONTROL_CHARACTER.test(name)) return no('control')
  if (name.includes('/') || name.includes('\\')) return no('separator')
  if (WINDOWS_FORBIDDEN.test(name)) return no('character')
  if (name === '.' || name === '..') return no('reserved')
  if (name.endsWith('.')) return no('dot')
  if (RESERVED_DEVICE.test(name)) return no('device')
  if (utf8Length(name) > MAX_NAME_BYTES) return no('long')
  return { ok: true }
}
