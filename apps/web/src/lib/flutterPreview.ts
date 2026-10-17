import type { FwpEntry, FwpError, FwpSnapshot, FwpState, RunConfig, RunDevice } from '@ccm/shared'
import { desktop } from './desktop'

export const hasFlutterPreview = typeof desktop?.fwpScan === 'function'

export const isDartFile = (path: string): boolean => /\.dart$/i.test(path)

/** Phones / tablets only (v1 runs the host on Android or iOS, never web / desktop). */
export function mobileDevices(devices: readonly RunDevice[]): RunDevice[] {
  return devices.filter((d) => d.state === 'ready' && /^(android|ios)/i.test(d.platform))
}

/** Panel override for this project while still connected, else the Run pane's pick when it is a phone / tablet, else the first one. */
export function previewDevice(mobile: readonly RunDevice[], override: string | null | undefined, runPick: string | null | undefined): string {
  const connected = (id: string | null | undefined): id is string => !!id && mobile.some((d) => d.id === id)
  if (connected(override)) return override
  if (connected(runPick)) return runPick
  return mobile[0]?.id ?? ''
}

export const DEVICE_OVERRIDES_KEY = 'ccm.fwp.devices'

export function readDeviceOverrides(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DEVICE_OVERRIDES_KEY) ?? '{}')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string')) : {}
  } catch {
    return {}
  }
}

/** Picking the Run pane's device clears the override, so the panel follows Run again. */
export function withDeviceOverride(all: Readonly<Record<string, string>>, root: string, id: string, runPick: string | null | undefined): Record<string, string> {
  const next = { ...all }
  if (!id || id === runPick) delete next[root]
  else next[root] = id
  try {
    localStorage.setItem(DEVICE_OVERRIDES_KEY, JSON.stringify(next))
  } catch {
    // storage off: the pick lasts for this window only
  }
  return next
}

/** Entries a widget error or a compile error points at. */
export function failingEntries(entries: readonly FwpEntry[], error: FwpError | null, root: string | null): Set<string> {
  if (error?.code === 'widget' && error.entry) return new Set([error.entry])
  if (error?.code !== 'build' || !error.build || !root) return new Set()
  const rel = relativeTo(root, error.build.file) ?? error.build.file.replace(/\\/g, '/')
  return new Set(entries.filter((e) => e.file === rel).map((e) => e.id))
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

/** Widget classes (`kind: 'class'`) list only under their own file; `@Preview` entries list everywhere. */
export function groupEntries(entries: readonly FwpEntry[], fileRel: string | null): { here: FwpEntry[]; other: FwpEntry[] } {
  const here: FwpEntry[] = []
  const other: FwpEntry[] = []
  for (const e of entries) {
    if (fileRel !== null && e.file === fileRel) here.push(e)
    else if (e.kind !== 'class') other.push(e)
  }
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

export const isLive = (state: FwpState): boolean => state === 'starting' || state === 'running' || state === 'reloading' || state === 'syncing'

export const EMPTY_SNAPSHOT: FwpSnapshot = { state: 'idle', root: null, deviceId: null, appId: null, current: null, progress: null, error: null, entries: [], log: [] }
