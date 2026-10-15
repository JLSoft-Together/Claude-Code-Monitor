import type { FwpEntry, FwpSnapshot, FwpState, RunConfig, RunDevice } from '@ccm/shared'
import { desktop } from './desktop'

export const hasFlutterPreview = typeof desktop?.fwpScan === 'function'

export const isDartFile = (path: string): boolean => /\.dart$/i.test(path)

/** Phones / tablets only (v1 runs the host on Android or iOS, never web / desktop). */
export function mobileDevices(devices: readonly RunDevice[]): RunDevice[] {
  return devices.filter((d) => d.state === 'ready' && /^(android|ios)/i.test(d.platform))
}

/** `path` relative to `root` with `/` separators, null when outside. */
export function relativeTo(root: string, path: string): string | null {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  const win = /^[A-Za-z]:/.test(r)
  const same = (a: string, b: string): boolean => (win ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (p.length <= r.length || p[r.length] !== '/' || !same(p.slice(0, r.length), r)) return null
  return p.slice(r.length + 1)
}

export function groupEntries(entries: readonly FwpEntry[], fileRel: string | null): { here: FwpEntry[]; other: FwpEntry[] } {
  const here: FwpEntry[] = []
  const other: FwpEntry[] = []
  for (const e of entries) (fileRel !== null && e.file === fileRel ? here : other).push(e)
  return { here, other }
}

/** Flavors from the project's Flutter run configs (the preview has no flavor setting of its own). */
export function flavorsFrom(configs: readonly RunConfig[]): string[] {
  const out = new Set<string>()
  for (const c of configs) if (c.type === 'flutter' && c.flavor.trim()) out.add(c.flavor.trim())
  return [...out].sort()
}

const PROJECT_CACHE_MAX = 32
const projectByDir = new Map<string, boolean>()

/** Whether `file` sits in a Flutter project, probed once per folder (FilePane asks on every .dart open). */
export async function inFlutterProject(file: string, probe: (file: string) => Promise<{ flutter: boolean } | null | undefined>): Promise<boolean> {
  const dir = file.replace(/[\\/][^\\/]*$/, '')
  const known = projectByDir.get(dir)
  if (known !== undefined) return known
  const res = await probe(file).catch(() => null)
  if (!res) return false
  if (projectByDir.size >= PROJECT_CACHE_MAX) projectByDir.delete(projectByDir.keys().next().value!)
  projectByDir.set(dir, res.flutter)
  return res.flutter
}

export const isLive =(state: FwpState): boolean => state === 'starting' || state === 'running' || state === 'reloading'

export const EMPTY_SNAPSHOT: FwpSnapshot = { state: 'idle', root: null, deviceId: null, appId: null, current: null, progress: null, error: null, entries: [], log: [] }
