import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ResponseStats } from '@ccm/shared'

const LONG_WAIT_MS = 5 * 60_000
const MAX_SAMPLES = 1000
// A "wait" longer than this is someone away from the desk, not a reply time worth averaging.
const MAX_WAIT_MS = 8 * 3_600_000

export const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

/** Today's waiting → busy durations; persisted so a collector restart keeps the day. */
export class ResponseTracker {
  private day: string
  private samples: number[] = []
  private longWaits = 0
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.day = localDay(now())
  }

  async load(): Promise<void> {
    if (!this.file) return
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { day?: unknown; samples?: unknown; longWaits?: unknown }
      if (raw.day !== localDay(this.now()) || !Array.isArray(raw.samples)) return
      this.day = raw.day
      this.samples = raw.samples.filter((n): n is number => typeof n === 'number' && n >= 0).slice(-MAX_SAMPLES)
      this.longWaits = typeof raw.longWaits === 'number' ? raw.longWaits : 0
    } catch {
      return
    }
  }

  /** Returns true when the stats changed. */
  rollDay(): boolean {
    const today = localDay(this.now())
    if (today === this.day) return false
    this.day = today
    this.samples = []
    this.longWaits = 0
    this.scheduleSave()
    return true
  }

  record(waitMs: number): boolean {
    if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) return false
    this.rollDay()
    this.samples.push(Math.round(waitMs))
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
    if (waitMs > LONG_WAIT_MS) this.longWaits++
    this.scheduleSave()
    return true
  }

  stats(): ResponseStats {
    return {
      day: this.day,
      count: this.samples.length,
      totalMs: this.samples.reduce((a, b) => a + b, 0),
      medianMs: median(this.samples),
      longWaits: this.longWaits,
    }
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 10_000)
  }

  async save(): Promise<void> {
    if (!this.file) return
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      await mkdir(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify({ day: this.day, samples: this.samples, longWaits: this.longWaits }))
      await rename(tmp, this.file)
    } catch (err) {
      console.warn('[collector] cannot save response stats:', (err as Error).message)
    }
  }
}
