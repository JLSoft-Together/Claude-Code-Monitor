import type { DevFsEntry, DevFsErrorCode, DevFsKind, DevFsScope } from '@ccm/shared'
import { shQuote } from './uiToggles'

/** Shared storage and the shell user's scratch folder; anything else on the device is out of reach on purpose. */
export const SDCARD_ROOTS = ['/sdcard', '/data/local/tmp']
export const PART_SUFFIX = '.orrery-part'

const MODE = /^([-dlcbps])[-rwxsStTlL]{9}[.+@]?\s+/
const ISO_TIME = /\s(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:\s+[+-]\d{4})?\s/
const BUSYBOX_TIME = /\s([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}|\d{4})\s/

const KIND: Record<string, DevFsKind> = { d: 'dir', l: 'link', '-': 'file' }

/** `ls -la` of toybox (Android 6+), old toolbox (no link count, no folder size) and busybox. Names may hold spaces. */
export function parseLsLa(out: string): { entries: DevFsEntry[]; skipped: number; error: DevFsErrorCode | null } {
  const entries: DevFsEntry[] = []
  let skipped = 0
  let error: DevFsErrorCode | null = null
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || /^total\s+\d+/.test(line)) continue
    const mode = MODE.exec(line)
    if (!mode) {
      if (/Permission denied/i.test(line)) error ??= 'permission'
      else if (/No such file/i.test(line)) error ??= 'not-found'
      else if (/Not a directory/i.test(line)) error ??= 'not-dir'
      else skipped++
      continue
    }
    const iso = ISO_TIME.exec(line)
    const bb = iso ? null : BUSYBOX_TIME.exec(line)
    const at = iso ?? bb
    if (!at) {
      skipped++
      continue
    }
    const kind = KIND[mode[1]!] ?? 'other'
    const tokens = line.slice(mode[0].length, at.index).trim().split(/\s+/)
    const last = tokens.at(-1) ?? ''
    const sized = kind === 'file' || kind === 'link'
    // `c`/`b` nodes print `major, minor` where the size would be
    const size = sized && /^\d+$/.test(last) && !(tokens.at(-2) ?? '').endsWith(',') && tokens.length > 2 ? Number(last) : null
    let name = line.slice(at.index + at[0].length)
    let target: string | undefined
    if (kind === 'link') {
      const arrow = name.indexOf(' -> ')
      if (arrow > 0) {
        target = name.slice(arrow + 4)
        name = name.slice(0, arrow)
      }
    }
    if (name === '.' || name === '..') continue
    if (!name || /[\u0000-\u001f]/.test(name)) {
      skipped++
      continue
    }
    const modified = iso ? `${iso[1]} ${iso[2]}` : `${bb![1]} ${bb![2]} ${bb![3]}`
    entries.push(target === undefined ? { name, kind, size, modified } : { name, kind, size, modified, target })
  }
  entries.sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name))
  return { entries, skipped, error: entries.length ? null : error }
}

/** Absolute, normalised, no `.` / `..` segments, no NUL or line breaks (every path ends up in a device shell line). */
export function isDevicePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 1024 || /[\u0000\n\r]/.test(p)) return false
  if (p === '/') return true
  if (p.endsWith('/')) return false
  return p
    .slice(1)
    .split('/')
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

export const inSdcard = (p: string): boolean => SDCARD_ROOTS.some((r) => p === r || p.startsWith(`${r}/`))

/** App paths are `/`-rooted inside the app's data folder (`run-as` starts there). */
export const validPath = (scope: DevFsScope, p: unknown): p is string => isDevicePath(p) && (scope.kind === 'app' || inSdcard(p))

/** A path that may be deleted: never a scope root itself. */
export const deletable = (scope: DevFsScope, p: string): boolean => (scope.kind === 'app' ? p !== '/' : SDCARD_ROOTS.some((r) => p.startsWith(`${r}/`)))

export const isEntryName = (n: unknown): n is string =>
  typeof n === 'string' && n.length >= 1 && n.length <= 255 && n !== '.' && n !== '..' && !/[/\u0000\n\r]/.test(n)

export const joinPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)
export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

const deviceArg = (scope: DevFsScope, p: string): string => (scope.kind === 'sdcard' ? p : p === '/' ? '.' : `.${p}`)
const prefix = (scope: DevFsScope): string[] => (scope.kind === 'app' ? ['run-as', shQuote(scope.pkg)] : [])

/** Trailing slash: a symlinked folder (`/sdcard` itself) is listed, not shown as the link. */
export const lsArgs = (scope: DevFsScope, dir: string): string[] => [...prefix(scope), 'ls', '-la', shQuote(dir === '/' && scope.kind === 'sdcard' ? '/' : `${deviceArg(scope, dir)}/`)]
export const statArgs = (scope: DevFsScope, p: string): string[] => [...prefix(scope), 'ls', '-la', shQuote(deviceArg(scope, p))]
export const existsArgs = (scope: DevFsScope, p: string): string[] => [...prefix(scope), 'ls', '-d', shQuote(deviceArg(scope, p))]
export const catArgs = (scope: DevFsScope, p: string): string[] => [...prefix(scope), 'cat', shQuote(deviceArg(scope, p))]
export const mkdirArgs = (scope: DevFsScope, p: string): string[] => [...prefix(scope), 'mkdir', shQuote(deviceArg(scope, p))]
export const rmArgs = (scope: DevFsScope, p: string, dir: boolean): string[] => [...prefix(scope), 'rm', ...(dir ? ['-r'] : []), '-f', shQuote(deviceArg(scope, p))]
export const partRmArgs = (scope: DevFsScope, p: string): string[] => [...prefix(scope), 'rm', '-f', shQuote(deviceArg(scope, p) + PART_SUFFIX)]

/** stdin → temp file → rename, so a cancelled push never leaves a half file under the real name. */
export function writeArgs(scope: DevFsScope, p: string): string[] {
  const arg = deviceArg(scope, p)
  const tmp = arg + PART_SUFFIX
  return [...prefix(scope), 'sh', '-c', shQuote(`cat > ${shQuote(tmp)} && mv -f ${shQuote(tmp)} ${shQuote(arg)}`)]
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/** Device names can hold characters Windows refuses; the pulled copy gets a safe name. */
export function localSafeName(name: string): string {
  let n = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '')
  if (RESERVED.test(n)) n = `_${n}`
  return n.slice(0, 200) || 'file'
}

export function uniqueName(name: string, taken: (n: string) => boolean): string | null {
  if (!taken(name)) return name
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let i = 1; i < 1000; i++) {
    const n = `${stem} (${i})${ext}`
    if (!taken(n)) return n
  }
  return null
}

const RUNNABLE = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'msp', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'scr', 'pif', 'cpl', 'reg', 'sh', 'command', 'app', 'url', 'appref-ms', 'application', 'gadget', 'msc', 'inf', 'scf', 'dll', 'sys'])

/** Pulled files come from a device: anything the OS would run is only shown in its folder. */
export function safeToOpen(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && !RUNNABLE.has(name.slice(dot + 1).toLowerCase())
}
