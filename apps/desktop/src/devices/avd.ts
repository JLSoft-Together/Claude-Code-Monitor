import path from 'node:path'
import type { AvdInfo } from '@ccm/shared'

/** Names Android Studio / avdmanager create; never starts with `-` so it cannot become an emulator flag. */
export const isAvdName = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/.test(v)

export const isEmulatorSerial = (id: string): boolean => /^emulator-\d{1,5}$/.test(id)

/** `emulator -list-avds`: INFO / WARNING lines (missing ANDROID_SDK_ROOT, …) come before the names. */
export function parseListAvds(out: string): string[] {
  const seen = new Set<string>()
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (isAvdName(line) && !/^(INFO|WARNING|ERROR|PANIC)\b/.test(line)) seen.add(line)
  }
  return [...seen]
}

export function parseIni(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (key && !Object.hasOwn(out, key)) out[key] = line.slice(eq + 1).trim()
  }
  return out
}

/** `adb -s emulator-NNNN emu avd name` prints the AVD name then `OK`. */
export function parseEmuAvdName(out: string): string | null {
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line === 'OK') continue
    return isAvdName(line) ? line : null
  }
  return null
}

/** Same lookup order as the emulator: ANDROID_AVD_HOME, ANDROID_USER_HOME/avd, ANDROID_EMULATOR_HOME/avd, ANDROID_SDK_HOME/.android/avd, ~/.android/avd. */
export function avdHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): { avd: string; user: string } {
  const p = platform === 'win32' ? path.win32 : path.posix
  const val = (k: string): string | null => env[k]?.trim() || null
  const user = val('ANDROID_USER_HOME') ?? val('ANDROID_EMULATOR_HOME') ?? (val('ANDROID_SDK_HOME') ? p.join(val('ANDROID_SDK_HOME')!, '.android') : p.join(home, '.android'))
  return { avd: val('ANDROID_AVD_HOME') ?? p.join(user, 'avd'), user }
}

/** Folder holding `config.ini`: `path=` of `<name>.ini`, then `path.rel=` (relative to the user home), else `<avdHome>/<name>.avd`. */
export function avdDir(name: string, ini: Record<string, string> | null, homes: { avd: string; user: string }, platform: NodeJS.Platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (ini?.path && p.isAbsolute(ini.path)) return ini.path
  if (ini?.['path.rel']) return p.join(homes.user, ini['path.rel'])
  return p.join(homes.avd, `${name}.avd`)
}

const apiOf = (v: string | undefined): number | null => {
  const m = v ? /android-(\d{1,3})(?!\d)/.exec(v.replace(/\\/g, '/')) : null
  return m ? Number(m[1]) : null
}

export function avdInfo(name: string, ini: Record<string, string> | null, config: Record<string, string> | null, serial: string | null): AvdInfo {
  const c = config ?? {}
  const api = apiOf(ini?.target) ?? apiOf(c.target) ?? apiOf(c['image.sysdir.1'])
  return {
    name,
    displayName: c['avd.ini.displayname']?.slice(0, 120) || name.replace(/_/g, ' '),
    api,
    abi: c['abi.type'] || null,
    device: c['hw.device.name'] || null,
    tag: c['tag.id'] || null,
    serial,
  }
}

export function emulatorArgs(name: string, mode: 'normal' | 'cold' | 'wipe'): string[] {
  if (mode === 'cold') return ['-avd', name, '-no-snapshot-load']
  if (mode === 'wipe') return ['-avd', name, '-wipe-data']
  return ['-avd', name]
}
