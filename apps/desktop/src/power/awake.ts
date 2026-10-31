import { readFileSync, writeFileSync } from 'node:fs'
import { DEFAULT_AWAKE_MODE, isAwakeMode, type AwakeMode, type AwakeReason, type AwakeState } from '@ccm/shared'

export const AWAKE_FILE = 'keep-awake.json'
export const AWAKE_GRACE_MS = 2 * 60_000

export interface AwakeInput {
  mode: AwakeMode
  agents: number
  jobs: number
  onBattery: boolean
  /** Last moment something was working; null = never seen. */
  lastBusyAt: number | null
  now: number
  graceMs?: number
}

export function decideAwake(i: AwakeInput): { hold: boolean; reason: AwakeReason; releaseAt: number | null } {
  if (i.mode === 'off') return { hold: false, reason: 'off', releaseAt: null }
  const busy = i.agents + i.jobs > 0
  const releaseAt = !busy && i.lastBusyAt !== null ? i.lastBusyAt + (i.graceMs ?? AWAKE_GRACE_MS) : null
  const wanted = busy || (releaseAt !== null && i.now < releaseAt)
  if (!wanted) return { hold: false, reason: 'idle', releaseAt: null }
  if (i.mode === 'plugged' && i.onBattery) return { hold: false, reason: 'battery', releaseAt: busy ? null : releaseAt }
  return busy ? { hold: true, reason: 'working', releaseAt: null } : { hold: true, reason: 'grace', releaseAt }
}

export interface KeepAwakeDeps {
  /** `powerSaveBlocker.start('prevent-app-suspension')`: never keeps the display on. */
  start: () => number
  stop: (id: number) => void
  onBattery: () => boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  onChange?: (state: AwakeState) => void
  graceMs?: number
}

export class KeepAwake {
  private mode: AwakeMode
  private agents = 0
  private jobs = 0
  private lastBusyAt: number | null = null
  private blocker: number | null = null
  private timer: unknown = null
  private last: AwakeState

  constructor(
    private readonly deps: KeepAwakeDeps,
    mode: AwakeMode = DEFAULT_AWAKE_MODE,
  ) {
    this.mode = mode
    this.last = { mode, holding: false, reason: mode === 'off' ? 'off' : 'idle', agents: 0, jobs: 0, releaseAt: null }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  state(): AwakeState {
    return this.last
  }

  setMode(mode: AwakeMode): void {
    this.mode = mode
    this.apply()
  }

  setBusy(agents: number, jobs: number): void {
    const wasBusy = this.agents + this.jobs > 0
    this.agents = agents
    this.jobs = jobs
    // The grace window starts when the last one stops, not when it started.
    if (agents + jobs > 0 || wasBusy) this.lastBusyAt = this.now()
    this.apply()
  }

  /** AC / battery switched. */
  powerChanged(): void {
    this.apply()
  }

  dispose(): void {
    this.clear()
    if (this.blocker !== null) this.deps.stop(this.blocker)
    this.blocker = null
  }

  private clear(): void {
    if (this.timer !== null) (this.deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(this.timer)
    this.timer = null
  }

  private apply(): void {
    this.clear()
    const now = this.now()
    const d = decideAwake({ mode: this.mode, agents: this.agents, jobs: this.jobs, onBattery: this.mode === 'plugged' && this.deps.onBattery(), lastBusyAt: this.lastBusyAt, now, graceMs: this.deps.graceMs })
    if (d.hold && this.blocker === null) this.blocker = this.deps.start()
    if (!d.hold && this.blocker !== null) {
      this.deps.stop(this.blocker)
      this.blocker = null
    }
    if (d.releaseAt !== null) {
      const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
      this.timer = set(() => {
        this.timer = null
        this.apply()
      }, Math.max(0, d.releaseAt - now))
    }
    const next: AwakeState = { mode: this.mode, holding: d.hold, reason: d.reason, agents: this.agents, jobs: this.jobs, releaseAt: d.releaseAt }
    if (JSON.stringify(next) !== JSON.stringify(this.last)) {
      this.last = next
      this.deps.onChange?.(next)
    }
  }
}

export function readAwakeMode(file: string): AwakeMode {
  try {
    const raw = (JSON.parse(readFileSync(file, 'utf8')) as { mode?: unknown }).mode
    return isAwakeMode(raw) ? raw : DEFAULT_AWAKE_MODE
  } catch {
    return DEFAULT_AWAKE_MODE
  }
}

export function writeAwakeMode(file: string, mode: AwakeMode): void {
  try {
    writeFileSync(file, JSON.stringify({ mode }))
  } catch {
    // Kept for this run only.
  }
}
