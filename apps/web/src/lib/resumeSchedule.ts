import type { LimitHit } from '@ccm/shared'

export interface ResumeEntry {
  paneKey: string
  text: string
  /** When to prefill (ms): the reset plus `RESET_GRACE_MS`. */
  at: number
  createdAt: number
}

export const RESUME_STORAGE_KEY = 'ccm.resumeSchedule'
export const RESUME_TEXT_KEY = 'ccm.resumeText'
export const RESUME_TEXT_MAX = 2000
/** Claude Code's own auto-continue also waits a little past the reset before it retries. */
export const RESET_GRACE_MS = 15_000
/** An entry restored this late after its time (app closed over the reset) is dropped instead of filled. */
export const STALE_MS = 6 * 3_600_000
/** setTimeout clamps above 2^31-1 ms; longer waits re-arm when this fires. */
export const MAX_DELAY_MS = 2_147_000_000

/** Reset time (ms) of a limit hit still in the future, else null. */
export function resetAtOf(hit: LimitHit | undefined, nowMs: number): number | null {
  const at = hit?.resetsAt ? Date.parse(hit.resetsAt) : NaN
  return Number.isFinite(at) && at + RESET_GRACE_MS > nowMs ? at : null
}

export function upsert(list: ResumeEntry[], entry: ResumeEntry): ResumeEntry[] {
  return [...list.filter((e) => e.paneKey !== entry.paneKey), entry]
}

export const without = (list: ResumeEntry[], paneKey: string): ResumeEntry[] => list.filter((e) => e.paneKey !== paneKey)

export function nextFire(list: ResumeEntry[]): number | null {
  return list.length ? Math.min(...list.map((e) => e.at)) : null
}

export function splitDue(list: ResumeEntry[], nowMs: number): { due: ResumeEntry[]; rest: ResumeEntry[] } {
  return { due: list.filter((e) => e.at <= nowMs), rest: list.filter((e) => e.at > nowMs) }
}

/** Fill order: the earliest scheduled pane last, so it ends up focused (each prefill activates its pane). */
export function fillOrder(due: ResumeEntry[]): ResumeEntry[] {
  return [...due].sort((a, b) => b.createdAt - a.createdAt)
}

export function delayTo(at: number, nowMs: number): number {
  return Math.min(MAX_DELAY_MS, Math.max(0, at - nowMs))
}

export const cleanText = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim().slice(0, RESUME_TEXT_MAX)

export function parseEntries(raw: string | null, nowMs: number): ResumeEntry[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter(
        (e): e is ResumeEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof e.paneKey === 'string' &&
          e.paneKey.length <= 200 &&
          typeof e.text === 'string' &&
          typeof e.at === 'number' &&
          Number.isFinite(e.at) &&
          typeof e.createdAt === 'number',
      )
      .map((e) => ({ paneKey: e.paneKey, text: cleanText(e.text), at: e.at, createdAt: e.createdAt }))
      .filter((e) => e.text && e.at > nowMs - STALE_MS)
      .slice(0, 100)
  } catch {
    return []
  }
}

/** `14:30`, or `Mon 14:30` when the reset is not today. */
export function resetLabel(at: number, nowMs: number, locale: string): string {
  const d = new Date(at)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  if (d.toDateString() === new Date(nowMs).toDateString()) return time
  return `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)} ${time}`
}
