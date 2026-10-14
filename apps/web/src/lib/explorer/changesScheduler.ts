/**
 * When the Explorer's Changes list reads git again (ported from spacevibe-deck `changes-scheduler.ts`).
 * Watch events debounce 150 ms (at most 1 s from a burst's first event); a read starts ≥ 1 s after the
 * previous start and one previous-duration after its end; focus / shown / refresh skip both; one read in
 * flight; inactive drops everything and becoming active reads once.
 */
export const DEBOUNCE_MS = 150
export const MAX_WAIT_MS = 1000
export const MIN_INTERVAL_MS = 1000

export type TriggerKind = 'watch' | 'focus' | 'shown' | 'refresh'

const IMMEDIATE: ReadonlySet<TriggerKind> = new Set(['focus', 'shown', 'refresh'])

export interface SchedulerClock {
  now(): number
  setTimer(cb: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (cb, ms) => setTimeout(cb, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface ChangesScheduler {
  trigger(kind: TriggerKind): void
  setActive(active: boolean): void
  dispose(): void
}

export function createChangesScheduler(deps: { read: () => Promise<void>; clock?: SchedulerClock }): ChangesScheduler {
  const clock = deps.clock ?? realClock
  let active = false
  let pending: { first: number; last: number; immediate: boolean } | null = null
  let timer: unknown = null
  let inFlight = false
  let lastStart = Number.NEGATIVE_INFINITY
  let lastEnd = Number.NEGATIVE_INFINITY
  let lastDuration = 0

  const cancel = (): void => {
    if (timer !== null) clock.clearTimer(timer)
    timer = null
  }

  const start = (): void => {
    pending = null
    inFlight = true
    lastStart = clock.now()
    let settled: Promise<void>
    try {
      settled = deps.read()
    } catch {
      settled = Promise.resolve()
    }
    void settled
      .catch(() => {})
      .then(() => {
        lastEnd = clock.now()
        lastDuration = lastEnd - lastStart
        inFlight = false
        schedule()
      })
  }

  function schedule(): void {
    if (!active || !pending || inFlight) return
    cancel()
    const now = clock.now()
    let due = now
    if (!pending.immediate) {
      due = Math.min(pending.last + DEBOUNCE_MS, pending.first + MAX_WAIT_MS)
      due = Math.max(due, lastStart + MIN_INTERVAL_MS, lastEnd + lastDuration)
    }
    if (due <= now) return start()
    timer = clock.setTimer(() => {
      timer = null
      schedule()
    }, due - now)
  }

  function trigger(kind: TriggerKind): void {
    if (!active) return
    const now = clock.now()
    const immediate = IMMEDIATE.has(kind)
    if (!pending) pending = { first: now, last: now, immediate }
    else {
      pending.last = now
      pending.immediate ||= immediate
    }
    schedule()
  }

  return {
    trigger,
    setActive(next) {
      if (next === active) return
      active = next
      if (active) return trigger('shown')
      cancel()
      pending = null
    },
    dispose() {
      active = false
      cancel()
      pending = null
    },
  }
}
