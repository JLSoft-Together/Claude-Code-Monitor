import type { DevLaunch, DevNight, DevUiChange, DevUiKey } from '@ccm/shared'

/** Raw values as read before the first change from Orrery, per device serial; `null` = the setting was unset. */
export interface UiOriginals {
  night?: DevNight
  fontScale?: string | null
  density?: number | null
  animations?: (string | null)[]
  locales?: Record<string, string>
}

export const ANIMATION_KEYS = ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'] as const
export const LOCALE_MIN_SDK = 33

const PKG = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/
const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const CLASS = /^\.?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/
const NUM = /^\d+(\.\d+)?$/

export const isPackage = (v: unknown): v is string => typeof v === 'string' && v.length <= 255 && PKG.test(v)
export const isLocaleTag = (v: unknown): v is string => typeof v === 'string' && (v === '' || (v.length <= 35 && TAG.test(v)))
export const isLocaleList = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && (v === '' || v.split(',').every((t) => TAG.test(t)))
export const isActivity = (v: unknown): v is string => typeof v === 'string' && v.length <= 255 && CLASS.test(v)

/** One page value → a change; null when any field is out of range (all of it ends up in a device shell line). */
export function cleanChange(v: unknown): DevUiChange | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  switch (c.key) {
    case 'night':
      return c.value === 'yes' || c.value === 'no' ? { key: 'night', value: c.value } : null
    case 'fontScale':
      return typeof c.value === 'number' && Number.isFinite(c.value) && c.value >= 0.5 && c.value <= 3 ? { key: 'fontScale', value: Math.round(c.value * 100) / 100 } : null
    case 'density':
      if (c.value === null) return { key: 'density', value: null }
      return typeof c.value === 'number' && Number.isInteger(c.value) && c.value >= 72 && c.value <= 1000 ? { key: 'density', value: c.value } : null
    case 'animations':
      return typeof c.off === 'boolean' ? { key: 'animations', off: c.off } : null
    case 'locale':
      return isPackage(c.pkg) && isLocaleTag(c.value) ? { key: 'locale', pkg: c.pkg, value: c.value } : null
    default:
      return null
  }
}

export function parseNight(out: string): DevNight | null {
  const m = /Night mode:\s*(\w+)/i.exec(out)
  const v = m?.[1]?.toLowerCase()
  if (v === 'yes' || v === 'no' || v === 'auto') return v
  return v ? 'custom' : null
}

/** `settings get` → the raw value, null for unset ("null" or empty). */
export function parseSetting(out: string): string | null {
  const v = out.trim().split(/\r?\n/).pop()?.trim() ?? ''
  return !v || v === 'null' || !NUM.test(v) ? null : v
}

export function parseDensity(out: string): { physical: number | null; override: number | null } {
  const num = (re: RegExp): number | null => {
    const m = re.exec(out)
    return m ? Number(m[1]) : null
  }
  return { physical: num(/Physical density:\s*(\d+)/i), override: num(/Override density:\s*(\d+)/i) }
}

export function parseSdk(out: string): number | null {
  const n = Number(out.trim())
  return Number.isInteger(n) && n > 0 ? n : null
}

/** `Locales for com.app for user 0 are [vi-VN,en]` → `vi-VN,en`; `[]` → ''. */
export function parseAppLocales(out: string): string | null {
  const m = /Locales for \S+ for user \d+ are \[([^\]]*)\]/.exec(out)
  return m ? m[1]!.replace(/\s+/g, '') : null
}

/** `adb shell` joins its argv into one remote sh line: anything not a fixed word is single-quoted. */
export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

const put = (ns: 'system' | 'global', key: string, value: string | null): string[] =>
  value === null ? ['settings', 'delete', ns, key] : ['settings', 'put', ns, key, value]

/** Shell argv lists that apply `change`. */
export function changeCommands(change: DevUiChange, originals: UiOriginals): string[][] {
  switch (change.key) {
    case 'night':
      return [['cmd', 'uimode', 'night', change.value]]
    case 'fontScale':
      return [put('system', 'font_scale', String(change.value))]
    case 'density':
      return [change.value === null ? ['wm', 'density', 'reset'] : ['wm', 'density', String(change.value)]]
    case 'animations':
      return ANIMATION_KEYS.map((k, i) => put('global', k, change.off ? '0' : (originals.animations?.[i] ?? '1')))
    case 'locale':
      return [['cmd', 'locale', 'set-app-locales', change.pkg, '--locales', change.value ? change.value : "''"]]
  }
}

/** Shell argv lists that put every kept original back. */
export function restoreCommands(o: UiOriginals): string[][] {
  const out: string[][] = []
  if (o.night) out.push(['cmd', 'uimode', 'night', o.night === 'custom' ? 'auto' : o.night])
  if (o.fontScale !== undefined) out.push(put('system', 'font_scale', o.fontScale))
  if (o.density !== undefined) out.push(o.density === null ? ['wm', 'density', 'reset'] : ['wm', 'density', String(o.density)])
  if (o.animations) ANIMATION_KEYS.forEach((k, i) => out.push(put('global', k, o.animations![i] ?? null)))
  for (const [pkg, tags] of Object.entries(o.locales ?? {})) if (isPackage(pkg) && isLocaleList(tags)) out.push(['cmd', 'locale', 'set-app-locales', pkg, '--locales', tags ? tags : "''"])
  return out
}

export function changedKeys(o: UiOriginals | undefined): DevUiKey[] {
  if (!o) return []
  const keys: DevUiKey[] = []
  if (o.night) keys.push('night')
  if (o.fontScale !== undefined) keys.push('fontScale')
  if (o.density !== undefined) keys.push('density')
  if (o.animations) keys.push('animations')
  if (o.locales && Object.keys(o.locales).length) keys.push('locale')
  return keys
}

const URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/

export const isLaunchUri = (v: unknown): v is string => typeof v === 'string' && v.length <= 2048 && URI.test(v) && !/[\x00-\x1f\x7f]/.test(v)

export function cleanLaunch(v: unknown): DevLaunch | null {
  if (!v || typeof v !== 'object') return null
  const l = v as Record<string, unknown>
  if (l.kind === 'uri') {
    if (!isLaunchUri(l.uri)) return null
    if (l.pkg !== null && l.pkg !== undefined && !isPackage(l.pkg)) return null
    return { kind: 'uri', uri: l.uri, pkg: (l.pkg as string | null | undefined) ?? null }
  }
  if (l.kind === 'activity' && isPackage(l.pkg) && isActivity(l.activity)) return { kind: 'activity', pkg: l.pkg, activity: l.activity }
  return null
}

export function launchCommand(l: DevLaunch): string[] {
  if (l.kind === 'uri') return ['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', shQuote(l.uri), ...(l.pkg ? [l.pkg] : [])]
  return ['am', 'start', '-W', '-n', `${l.pkg}/${l.activity}`]
}

/** `am start -W` exits 0 on most failures; the text decides. */
export function parseLaunch(out: string): { ok: true; detail?: string } | { ok: false; detail: string } {
  const err = /^(Error(?: type \d+)?:.*|Exception occurred.*|java\.lang\.\w+.*)$/m.exec(out)
  if (err) return { ok: false, detail: err[1]!.trim().slice(0, 300) }
  if (/Status:\s*ok/i.test(out)) {
    const warn = /^Warning:\s*(.*)$/m.exec(out)?.[1]
    return warn ? { ok: true, detail: warn.trim().slice(0, 300) } : { ok: true }
  }
  return { ok: false, detail: out.trim().slice(0, 300) || 'no output' }
}
