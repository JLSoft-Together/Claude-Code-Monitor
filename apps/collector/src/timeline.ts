import type { DayTimeline, LaneStatus, TerminalStatus } from '@ccm/shared'
import { localDay } from './response'
import { JsonFile } from './json-file'

interface Segment {
  from: number
  to?: number
  status: LaneStatus
}

interface Lane {
  title: string
  segments: Segment[]
}

const MAX_SEGMENTS = 2000
const LANE_STATUS: Partial<Record<TerminalStatus, LaneStatus>> = { working: 'working', waiting: 'waiting', idle: 'idle' }

const midnight = (ms: number): number => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Today's working / waiting / idle segments per session, from registry status changes. Persisted, rolls at midnight. */
export class StatusTimeline {
  private day: string
  private lanes = new Map<string, Lane>()
  private readonly file: JsonFile | null

  constructor(
    file: string | null = null,
    private readonly now: () => number = Date.now,
  ) {
    this.file = file ? new JsonFile(file, 30_000) : null
    this.day = localDay(now())
  }

  async load(): Promise<void> {
    const raw = (await this.file?.read()) as { day?: unknown; savedAt?: unknown; lanes?: unknown } | null | undefined
    if (!raw || raw.day !== this.day || typeof raw.lanes !== 'object' || raw.lanes === null) return
    const savedAt = typeof raw.savedAt === 'number' ? Math.min(raw.savedAt, this.now()) : 0
    for (const [id, value] of Object.entries(raw.lanes as Record<string, unknown>)) {
      const lane = value as { title?: unknown; segments?: unknown }
      if (typeof lane.title !== 'string' || !Array.isArray(lane.segments)) continue
      const segments = lane.segments.filter(
        (s): s is Segment => typeof s?.from === 'number' && (s.to === undefined || typeof s.to === 'number') && ['working', 'waiting', 'idle'].includes(s.status),
      )
      // Open segments from before a collector restart end where the old process stopped watching.
      const last = segments.at(-1)
      if (last && last.to === undefined) last.to = Math.max(last.from, savedAt)
      this.lanes.set(id, { title: lane.title, segments })
    }
  }

  private roll(nowMs: number): void {
    const today = localDay(nowMs)
    if (today === this.day) return
    const start = midnight(nowMs)
    const carried = new Map<string, Lane>()
    for (const [id, lane] of this.lanes) {
      const last = lane.segments.at(-1)
      if (last && last.to === undefined) carried.set(id, { title: lane.title, segments: [{ from: start, status: last.status }] })
    }
    this.lanes = carried
    this.day = today
  }

  /** Called on every publish; only status changes add segments. `since` = when the registry says the status began. */
  observe(id: string, title: string, status: TerminalStatus, since?: string): void {
    const nowMs = this.now()
    this.roll(nowMs)
    const next = LANE_STATUS[status]
    let lane = this.lanes.get(id)
    if (!lane) {
      if (!next) return
      lane = { title, segments: [] }
      this.lanes.set(id, lane)
    }
    lane.title = title
    const last = lane.segments.at(-1)
    const open = last && last.to === undefined ? last : undefined
    if (open?.status === next) return
    if (!open && !next) return
    const sinceMs = since ? Date.parse(since) : Number.NaN
    let at = Number.isFinite(sinceMs) ? sinceMs : nowMs
    at = Math.min(nowMs, Math.max(at, midnight(nowMs), open?.from ?? 0, last?.to ?? 0))
    if (open) open.to = at
    if (next) lane.segments.push({ from: at, status: next })
    if (lane.segments.length > MAX_SEGMENTS) lane.segments.splice(0, lane.segments.length - MAX_SEGMENTS)
    this.file?.schedule(() => this.serialize())
  }

  /** Total ms per status for one session today (open segment counted up to now). */
  totals(id: string): Record<LaneStatus, number> {
    const out: Record<LaneStatus, number> = { working: 0, waiting: 0, idle: 0 }
    const nowMs = this.now()
    for (const s of this.lanes.get(id)?.segments ?? []) out[s.status] += (s.to ?? nowMs) - s.from
    return out
  }

  data(): DayTimeline {
    this.roll(this.now())
    return {
      day: this.day,
      lanes: [...this.lanes].map(([id, lane]) => ({
        id,
        title: lane.title,
        segments: lane.segments.map((s) => ({
          from: new Date(s.from).toISOString(),
          to: s.to === undefined ? undefined : new Date(s.to).toISOString(),
          status: s.status,
        })),
      })),
    }
  }

  private serialize(): unknown {
    return { day: this.day, savedAt: this.now(), lanes: Object.fromEntries(this.lanes) }
  }

  save(): Promise<void> {
    return this.file?.flush(() => this.serialize()) ?? Promise.resolve()
  }
}
