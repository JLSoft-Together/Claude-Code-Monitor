export const BUILD_BUDGET_MS = 8
export const REVEAL_MS = 280
export const REVEAL_WINDOW_MS = 340
export const REVEAL_STAGGER_MIN = 40
export const REVEAL_STAGGER_MAX = 80
export const REVEAL_DROP = 8
export const CHAR_LAG_MS = 60
export const CHAR_STAGGER_MS = 25
export const CHAR_SHOWN = 0.5

export type Clock = () => number

const perfNow: Clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function easeOutCubic(t: number): number {
  const k = Math.max(0, Math.min(1, t))
  return 1 - (1 - k) ** 3
}

export class BuildBudget {
  private until = 0
  private count = 0

  constructor(
    readonly ms: number = BUILD_BUDGET_MS,
    private readonly clock: Clock = perfNow,
  ) {}

  begin(): void {
    this.until = this.clock() + this.ms
    this.count = 0
  }

  spend(): void {
    this.count++
  }

  get built(): number {
    return this.count
  }

  exhausted(): boolean {
    return this.count > 0 && this.clock() >= this.until
  }
}

export interface RevealCandidate {
  id: string
  box: { x0: number; y0: number; x1: number; y1: number }
}

export function revealOrder<T extends RevealCandidate>(items: readonly T[], view: { x0: number; y0: number; x1: number; y1: number }): T[] {
  const cx = (view.x0 + view.x1) / 2
  const cy = (view.y0 + view.y1) / 2
  const rank = (it: T) => {
    const b = it.box
    const visible = b.x0 < view.x1 && b.x1 > view.x0 && b.y0 < view.y1 && b.y1 > view.y0
    const d = Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy)
    return { visible, d }
  }
  const keyed = items.map((it) => ({ it, ...rank(it) }))
  keyed.sort((a, b) => (a.visible === b.visible ? a.d - b.d || (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0) : a.visible ? -1 : 1))
  return keyed.map((k) => k.it)
}

export class IsoReveal {
  private readonly starts = new Map<string, number>()
  private last = -Infinity
  private charsAt = Infinity
  private expected = 1
  private endAt = Infinity

  constructor(
    readonly reduced: boolean,
    private readonly clock: Clock = perfNow,
  ) {}

  now(): number {
    return this.clock()
  }

  setExpected(n: number): void {
    this.expected = Math.max(1, n)
  }

  stagger(): number {
    if (this.reduced) return 0
    return Math.max(REVEAL_STAGGER_MIN, Math.min(REVEAL_STAGGER_MAX, REVEAL_WINDOW_MS / Math.max(1, this.expected - 1)))
  }

  has(id: string): boolean {
    return this.starts.has(id)
  }

  schedule(id: string): number {
    const hit = this.starts.get(id)
    if (hit !== undefined) return hit
    const now = this.clock()
    const at = this.reduced ? now : Math.max(now, this.last + this.stagger())
    this.last = at
    this.starts.set(id, at)
    return at
  }

  startOf(id: string): number | undefined {
    return this.starts.get(id)
  }

  started(id: string, now: number = this.clock()): boolean {
    const at = this.starts.get(id)
    return at === undefined || at <= now
  }

  alpha(id: string, now: number = this.clock()): number {
    const at = this.starts.get(id)
    if (at === undefined) return 1
    if (this.reduced) return now >= at ? 1 : 0
    return easeOutCubic((now - at) / REVEAL_MS)
  }

  drop(id: string, now: number = this.clock()): number {
    if (this.reduced) return 0
    return (1 - this.alpha(id, now)) * REVEAL_DROP
  }

  finishAreas(charGroups: number): void {
    if (this.charsAt !== Infinity) return
    const now = this.clock()
    const lastArea = this.last === -Infinity ? now : this.last
    this.charsAt = this.reduced ? Math.max(now, lastArea) : Math.max(now, lastArea + CHAR_LAG_MS)
    const groups = Math.max(1, charGroups)
    this.endAt = this.charsAt + (this.reduced ? 0 : (groups - 1) * CHAR_STAGGER_MS + REVEAL_MS)
  }

  get areasDone(): boolean {
    return this.charsAt !== Infinity
  }

  charAlpha(group: number, now: number = this.clock()): number {
    if (this.charsAt === Infinity) return 0
    const at = this.charsAt + (this.reduced ? 0 : Math.max(0, group) * CHAR_STAGGER_MS)
    if (this.reduced) return now >= at ? 1 : 0
    return easeOutCubic((now - at) / REVEAL_MS)
  }

  done(now: number = this.clock()): boolean {
    if (this.charsAt === Infinity || now < this.endAt) return false
    for (const at of this.starts.values()) if (!this.reduced && now < at + REVEAL_MS) return false
    return true
  }
}

export class AlphaContext {
  private k = 1
  readonly proxy: CanvasRenderingContext2D
  private readonly fns = new Map<PropertyKey, unknown>()

  constructor(readonly real: CanvasRenderingContext2D) {
    this.proxy = new Proxy(real, {
      get: (t, p) => {
        if (p === 'globalAlpha') return t.globalAlpha / (this.k || 1)
        const v: unknown = Reflect.get(t, p, t)
        if (typeof v !== 'function') return v
        let f = this.fns.get(p)
        if (!f) {
          f = (v as (...a: unknown[]) => unknown).bind(t)
          this.fns.set(p, f)
        }
        return f
      },
      set: (t, p, v) => {
        if (p === 'globalAlpha') t.globalAlpha = (v as number) * this.k
        else Reflect.set(t, p, v, t)
        return true
      },
    })
  }

  get factor(): number {
    return this.k
  }

  begin(k: number, dy = 0): void {
    this.real.save()
    if (dy) this.real.translate(0, dy)
    this.k = Math.max(0, Math.min(1, k))
    this.real.globalAlpha = this.k
  }

  end(): void {
    this.k = 1
    this.real.restore()
  }
}
