import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_DISK_WARN_GB,
  DISK_CHECK_MS,
  diskLevel,
  diskRearmed,
  isDiskWarnGb,
  type DiskAlertMessage,
  type DiskDrive,
  type DiskPlace,
  type DiskState,
} from '@ccm/shared'

export const DISK_FILE = 'disk.json'

export interface DiskSpace {
  free: number
  total: number
}

export interface DiskDeps {
  file: string
  /** Folders to watch, re-read on every pass (capture folder and open projects change). */
  places: () => Array<{ place: DiskPlace; dir: string }>
  statfs?: (dir: string) => Promise<DiskSpace | null>
  /** Mount point of an existing folder; default walks up while the device id stays the same. */
  mountOf?: (dir: string) => Promise<string | null>
  onState: (state: DiskState) => void
  onAlert: (m: DiskAlertMessage) => void
  platform?: NodeJS.Platform
  now?: () => number
  intervalMs?: number
}

export async function defaultStatfs(dir: string): Promise<DiskSpace | null> {
  try {
    const s = await fs.statfs(dir)
    return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }
  } catch {
    return null
  }
}

/** Highest ancestor on the same device; follows a moved ~/.claude junction to the drive that really holds it. */
export async function defaultMountOf(dir: string): Promise<string | null> {
  const real = await fs.realpath(dir).catch(() => null)
  if (!real) return null
  const st = await fs.stat(real).catch(() => null)
  if (!st) return null
  let at = real
  for (;;) {
    const up = path.dirname(at)
    if (up === at) return at
    const s = await fs.stat(up).catch(() => null)
    if (!s || s.dev !== st.dev) return at
    at = up
  }
}

export function driveLabel(mount: string, platform: NodeJS.Platform): string {
  const m = /^([A-Za-z]):[\\/]?$/.exec(mount)
  return platform === 'win32' && m ? `${m[1]!.toUpperCase()}:` : mount
}

/** One alert per drive per crossing; `danger` after `warn` alerts again. Cleared only once free climbs past the re-arm line. */
export class DiskAlerts {
  private readonly alerted = new Map<string, 'warn' | 'danger'>()

  step(drives: readonly DiskDrive[], warnGb: number): DiskAlertMessage[] {
    const out: DiskAlertMessage[] = []
    for (const d of drives) {
      const was = this.alerted.get(d.mount)
      if (d.level === 'ok') {
        if (was && diskRearmed(d.freeBytes, d.totalBytes, warnGb)) this.alerted.delete(d.mount)
        continue
      }
      if (was === 'danger' || (was === 'warn' && d.level === 'warn')) continue
      this.alerted.set(d.mount, d.level)
      out.push({ type: 'disk.alert', label: d.label, level: d.level, freeBytes: d.freeBytes, totalBytes: d.totalBytes })
    }
    return out
  }

  reset(): void {
    this.alerted.clear()
  }
}

export function readWarnGb(file: string): number {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { warnGb?: unknown }
    return isDiskWarnGb(raw.warnGb) ? raw.warnGb : DEFAULT_DISK_WARN_GB
  } catch {
    return DEFAULT_DISK_WARN_GB
  }
}

/** Read-only: one statfs per drive at start, every 10 min, and shortly after a run ends or a recording is saved. */
export class DiskWatch {
  private warn: number
  private timer: NodeJS.Timeout | null = null
  private pokeTimer: NodeJS.Timeout | null = null
  private running: Promise<DiskState> | null = null
  private last: DiskState
  private readonly alerts = new DiskAlerts()

  constructor(private readonly deps: DiskDeps) {
    this.warn = readWarnGb(deps.file)
    this.last = { warnGb: this.warn, at: null, drives: [] }
  }

  get state(): DiskState {
    return this.last
  }

  start(): void {
    this.stop()
    if (this.warn <= 0) return
    void this.measure()
    this.timer = setInterval(() => void this.measure(), this.deps.intervalMs ?? DISK_CHECK_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.pokeTimer) clearTimeout(this.pokeTimer)
    this.timer = null
    this.pokeTimer = null
  }

  /** Measure again soon; repeated pokes within the delay collapse into one pass. */
  poke(delayMs = 5_000): void {
    if (this.warn <= 0 || this.pokeTimer) return
    this.pokeTimer = setTimeout(() => {
      this.pokeTimer = null
      void this.measure()
    }, delayMs)
    this.pokeTimer.unref?.()
  }

  async setWarnGb(gb: number): Promise<DiskState> {
    if (!isDiskWarnGb(gb)) return this.last
    this.warn = gb
    await fs.mkdir(path.dirname(this.deps.file), { recursive: true })
    await fs.writeFile(this.deps.file, JSON.stringify({ warnGb: gb }), 'utf8')
    this.alerts.reset()
    if (gb <= 0) {
      this.stop()
      this.last = { warnGb: 0, at: this.last.at, drives: this.last.drives.map((d) => ({ ...d, level: 'ok' })) }
      this.deps.onState(this.last)
      return this.last
    }
    this.start()
    return this.measure()
  }

  measure(): Promise<DiskState> {
    this.running ??= this.pass().finally(() => (this.running = null))
    return this.running
  }

  private async pass(): Promise<DiskState> {
    const platform = this.deps.platform ?? process.platform
    const statfs = this.deps.statfs ?? defaultStatfs
    const mountOf = this.deps.mountOf ?? defaultMountOf
    const byMount = new Map<string, { mount: string; places: Set<DiskPlace> }>()
    for (const p of this.deps.places()) {
      const mount = await mountOf(p.dir).catch(() => null)
      if (!mount) continue
      const key = platform === 'win32' ? mount.toLowerCase() : mount
      const entry = byMount.get(key)
      if (entry) entry.places.add(p.place)
      else byMount.set(key, { mount, places: new Set([p.place]) })
    }
    const drives: DiskDrive[] = []
    for (const { mount, places } of byMount.values()) {
      const s = await statfs(mount)
      if (!s) continue
      drives.push({ mount, label: driveLabel(mount, platform), freeBytes: s.free, totalBytes: s.total, level: diskLevel(s.free, s.total, this.warn), places: [...places] })
    }
    drives.sort((a, b) => a.freeBytes - b.freeBytes)
    this.last = { warnGb: this.warn, at: (this.deps.now ?? Date.now)(), drives }
    for (const m of this.alerts.step(drives, this.warn)) this.deps.onAlert(m)
    this.deps.onState(this.last)
    return this.last
  }
}
