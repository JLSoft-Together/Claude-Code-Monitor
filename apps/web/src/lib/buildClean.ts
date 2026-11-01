import type { BuildBusy, BuildCleanRequest, BuildCleanResult, BuildProgress, BuildProject, DiskState } from '@ccm/shared'
import { desktop } from './desktop'

interface BuildBridge {
  buildScan?: (roots: string[]) => Promise<BuildProject[] | null>
  buildClean?: (req: BuildCleanRequest) => Promise<BuildCleanResult>
  buildCancel?: () => Promise<boolean>
  onBuild?: (handler: (p: BuildProgress) => void) => () => void
  diskState?: () => Promise<DiskState | null>
  diskRefresh?: () => Promise<DiskState | null>
  diskSet?: (warnGb: number) => Promise<DiskState | null>
  diskProjects?: (dirs: string[]) => Promise<boolean>
  diskOpen?: (mount: string) => Promise<boolean>
  onDisk?: (handler: (s: DiskState) => void) => () => void
}
const bridge = desktop as unknown as BuildBridge | undefined

export const hasBuildClean = typeof bridge?.buildScan === 'function'
export const hasDisk = typeof bridge?.diskState === 'function'

const quiet = <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ? p.catch(() => fallback) : Promise.resolve(fallback))

export const buildScan = (roots: string[]): Promise<BuildProject[] | null> => quiet(bridge?.buildScan?.(roots), null)
export const buildClean = (req: BuildCleanRequest): Promise<BuildCleanResult> => quiet(bridge?.buildClean?.(req), { ok: false, error: 'failed' })
export const buildCancel = (): Promise<boolean> => quiet(bridge?.buildCancel?.(), false)
export const onBuild = (handler: (p: BuildProgress) => void): (() => void) => bridge?.onBuild?.(handler) ?? (() => undefined)
export const diskState = (): Promise<DiskState | null> => quiet(bridge?.diskState?.(), null)
export const diskRefresh = (): Promise<DiskState | null> => quiet(bridge?.diskRefresh?.(), null)
export const diskSet = (warnGb: number): Promise<DiskState | null> => quiet(bridge?.diskSet?.(warnGb), null)
export const diskProjects = (dirs: string[]): Promise<boolean> => quiet(bridge?.diskProjects?.(dirs), false)
export const diskOpen = (mount: string): Promise<boolean> => quiet(bridge?.diskOpen?.(mount), false)
export const onDisk = (handler: (s: DiskState) => void): (() => void) => bridge?.onDisk?.(handler) ?? (() => undefined)

const TRASH_KEY = 'ccm.buildClean.trash'

export function loadTrash(): boolean {
  try {
    return localStorage.getItem(TRASH_KEY) === '1'
  } catch {
    return false
  }
}

export function saveTrash(on: boolean): void {
  try {
    localStorage.setItem(TRASH_KEY, on ? '1' : '0')
  } catch {
    // private window: the choice lasts this session only
  }
}

const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()

/** Unique folders in first-seen order, ignoring case, trailing slashes and `/` vs `\`. */
export function uniqueDirs(dirs: Iterable<string | null | undefined>): string[] {
  const out: string[] = []
  const keys = new Set<string>()
  for (const d of dirs) {
    if (!d || keys.has(norm(d))) continue
    keys.add(norm(d))
    out.push(d)
  }
  return out
}

interface ClusterLike {
  root: string | null
  live: boolean
  checkouts: Array<{ path: string | null }>
  history: string[]
}

/** Projects from the rail (open and remembered) and from sessions' project roots; `openOnly` keeps open ones. */
export function knownProjects(clusters: readonly ClusterLike[], sessionRoots: Iterable<string>, openOnly = false): string[] {
  const dirs: string[] = []
  for (const c of clusters) {
    if (openOnly && !c.live) continue
    if (c.root) dirs.push(c.root)
    for (const k of c.checkouts) if (k.path) dirs.push(k.path)
    if (!openOnly) dirs.push(...c.history)
  }
  if (!openOnly) dirs.push(...sessionRoots)
  return uniqueDirs(dirs)
}

export const busyIn = (busy: readonly BuildBusy[], root: string): BuildBusy[] => busy.filter((b) => norm(b.cwd) === norm(root) || norm(b.cwd).startsWith(`${norm(root)}/`))
