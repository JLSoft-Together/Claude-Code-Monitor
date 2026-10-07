export const BREAK_MINUTES = 45
const BREAK_MS = BREAK_MINUTES * 60_000

/** Reminders count from the first collector start today; a collector left running overnight counts from midnight. */
export function breakAnchor(dayStartedAt: string | null | undefined, nowMs: number): number | null {
  const start = dayStartedAt ? Date.parse(dayStartedAt) : NaN
  if (!Number.isFinite(start) || start > nowMs) return null
  const midnight = new Date(nowMs)
  midnight.setHours(0, 0, 0, 0)
  return Math.max(start, midnight.getTime())
}

/** How many full break intervals have passed since the anchor. */
export const breakSlot = (anchor: number, nowMs: number): number => Math.floor((nowMs - anchor) / BREAK_MS)

export const nextBreakAt = (anchor: number, nowMs: number): number => anchor + (breakSlot(anchor, nowMs) + 1) * BREAK_MS
