import { BUCKET_MS, type TimelineBucket, type TimelineDayInfo } from '@ccm/habblaud/client/src/net/timeline'

/** Constants of upstream `client/src/ui/timelapse.ts`. */
export const SPEEDS = [60, 180, 600] as const
export type Speed = (typeof SPEEDS)[number]
export const DEFAULT_SPEED: Speed = 180
/** Replay snapshot to the feed at most every 200 ms (the collector's commit rate). */
export const PUSH_MS = 200
/** While scrubbing, the world restarts at most every 120 ms. */
export const SEEK_MS = 120
/** Scrubber step (arrow keys): 1 min. */
export const STEP_S = 60

/** Newest day first, so today leads the picker. */
export function sortDays(days: readonly TimelineDayInfo[]): TimelineDayInfo[] {
  return [...days].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/** Whole hours for the ruler: at most ~6, every 1, 2, 3, 4 or 6 hours (upstream `hourTicks`). */
export function hourTicks(from: number, to: number): number[] {
  const span = (to - from) / 3_600_000
  const step = [1, 2, 3, 4, 6].find((s) => span / s <= 6) ?? 12
  const out: number[] = []
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  for (let t = d.getTime(); t <= to; ) {
    if (t > from && new Date(t).getHours() % step === 0) out.push(t)
    d.setHours(d.getHours() + 1)
    t = d.getTime()
  }
  return out
}

/** `fetchTimelineDays` / `fetchTimelineDay` throw `HTTP <status>`; a 404 means no recorded history, not a failure. */
export function isNotFound(err: unknown): boolean {
  return err instanceof Error && err.message === 'HTTP 404'
}

export interface ChartPaths {
  /** viewBox: x in minutes since `from` (one bar per `BUCKET_MS` bucket), y in agents. */
  width: number
  height: number
  present: string
  working: string
  waiting: string
}

/** One SVG path per series (a bar per minute bucket, placed by time like the scrubber), stretched by `preserveAspectRatio="none"`. */
export function chartPaths(buckets: readonly TimelineBucket[], from: number, to: number): ChartPaths {
  const max = Math.max(1, ...buckets.map((b) => b.present))
  const mark = max * 0.06
  const height = max + 2 * mark
  let present = ''
  let working = ''
  let waiting = ''
  const bar = (x: number, top: number, h: number): string => `M${x.toFixed(2)} ${top.toFixed(3)}h1v${h.toFixed(3)}h-1z`
  for (const b of buckets) {
    const x = (b.at - from) / BUCKET_MS
    if (b.present) present += bar(x, height - b.present, b.present)
    if (b.working) working += bar(x, height - b.working, b.working)
    if (b.waiting) waiting += bar(x, height - Math.max(b.present, b.working) - mark, mark)
  }
  return { width: Math.max(1, (to - from) / BUCKET_MS), height, present, working, waiting }
}
