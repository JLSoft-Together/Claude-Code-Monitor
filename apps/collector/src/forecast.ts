import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { LimitForecast, LimitWindow, PlanLimits } from '@ccm/shared'

export interface LimitSample {
  at: number
  pct: number
}

type WindowKey = 'fiveHour' | 'sevenDay'

interface WindowSpec {
  /** Only this much recent history feeds the slope, so a burst shows up quickly. */
  lookbackMs: number
  minSpanMs: number
  /** Thinning: at most one stored sample per step. */
  stepMs: number
}

const SPECS: Record<WindowKey, WindowSpec> = {
  fiveHour: { lookbackMs: 60 * 60_000, minSpanMs: 10 * 60_000, stepMs: 60_000 },
  sevenDay: { lookbackMs: 24 * 3_600_000, minSpanMs: 2 * 3_600_000, stepMs: 10 * 60_000 },
}

// Below this the window is effectively idle; a forecast days away is noise.
const MIN_PCT_PER_HOUR = 0.05

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Least-squares burn rate over the lookback, projected from the latest sample. */
export function forecastWindow(samples: LimitSample[], resetsAt: string | undefined, spec: WindowSpec): LimitForecast | undefined {
  const last = samples.at(-1)
  if (!last) return undefined
  const recent = samples.filter((s) => last.at - s.at <= spec.lookbackMs)
  const first = recent[0]
  if (!first || recent.length < 2 || last.at - first.at < spec.minSpanMs) return undefined
  const n = recent.length
  const mx = recent.reduce((a, s) => a + s.at, 0) / n
  const my = recent.reduce((a, s) => a + s.pct, 0) / n
  let num = 0
  let den = 0
  for (const s of recent) {
    num += (s.at - mx) * (s.pct - my)
    den += (s.at - mx) ** 2
  }
  const slope = den > 0 ? num / den : 0
  const pctPerHour = slope * 3_600_000
  if (pctPerHour < MIN_PCT_PER_HOUR || last.pct >= 100) return { pctPerHour: round1(Math.max(0, pctPerHour)) }
  const fullMs = last.at + (100 - last.pct) / slope
  const reset = resetsAt ? Date.parse(resetsAt) : Number.NaN
  return {
    pctPerHour: round1(pctPerHour),
    fullAt: new Date(fullMs).toISOString(),
    beforeReset: Number.isFinite(reset) ? fullMs < reset : true,
  }
}

interface WindowState {
  resetsAt?: string
  samples: LimitSample[]
}

/** Keeps a short usage history per limit window so the dashboard can say when a limit will be hit. */
export class LimitHistory {
  private readonly windows: Record<WindowKey, WindowState> = { fiveHour: { samples: [] }, sevenDay: { samples: [] } }
  private lastAt = ''
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private readonly file: string | null = null) {}

  async load(): Promise<void> {
    if (!this.file) return
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<Record<WindowKey, { resetsAt?: unknown; samples?: unknown }>>
      for (const key of Object.keys(SPECS) as WindowKey[]) {
        const w = raw[key]
        if (!w || !Array.isArray(w.samples)) continue
        this.windows[key] = {
          resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : undefined,
          samples: w.samples
            .filter((s): s is LimitSample => typeof s?.at === 'number' && typeof s?.pct === 'number')
            .slice(-500),
        }
      }
    } catch {
      return
    }
  }

  /** Records the report (once per `updatedAt`) and returns it with forecasts attached. */
  apply(limits: PlanLimits | null): PlanLimits | null {
    if (!limits) return null
    const at = Date.parse(limits.updatedAt)
    const fresh = limits.updatedAt !== this.lastAt && Number.isFinite(at)
    if (fresh) this.lastAt = limits.updatedAt
    const out: PlanLimits = { ...limits }
    for (const key of Object.keys(SPECS) as WindowKey[]) {
      const w = limits[key]
      if (!w) continue
      if (fresh) this.record(key, w, at)
      const forecast = forecastWindow(this.windows[key].samples, w.resetsAt, SPECS[key])
      out[key] = forecast ? { ...w, forecast } : { ...w }
    }
    if (fresh) this.scheduleSave()
    return out
  }

  private record(key: WindowKey, w: LimitWindow, at: number): void {
    const state = this.windows[key]
    const spec = SPECS[key]
    const last = state.samples.at(-1)
    const resetMoved = w.resetsAt !== undefined && state.resetsAt !== undefined && Math.abs(Date.parse(w.resetsAt) - Date.parse(state.resetsAt)) > 5 * 60_000
    if (resetMoved || (last && w.usedPct < last.pct - 0.5)) state.samples = []
    if (w.resetsAt) state.resetsAt = w.resetsAt
    const prev = state.samples.at(-1)
    if (prev && at - prev.at < spec.stepMs) state.samples[state.samples.length - 1] = { at: prev.at, pct: w.usedPct }
    else state.samples.push({ at, pct: w.usedPct })
    state.samples = state.samples.filter((s) => at - s.at <= spec.lookbackMs * 2)
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 60_000)
    this.saveTimer.unref?.()
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
      await writeFile(tmp, JSON.stringify(this.windows))
      await rename(tmp, this.file)
    } catch (err) {
      console.warn('[collector] cannot save limit history:', (err as Error).message)
    }
  }
}
