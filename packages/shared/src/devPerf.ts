import type { DevErrorCode } from './devices'

export type PerfErrorCode = DevErrorCode | 'not-running' | 'no-launcher' | 'start-failed' | 'parse-failed'

export type PerfFailure = { ok: false; error: PerfErrorCode; detail?: string }

/** `dumpsys gfxinfo <pkg>` since its last reset (or the process start). Times in ms; null when the device does not print it. */
export interface PerfFrames {
  total: number
  janky: number
  jankyPct: number
  p50: number | null
  p90: number | null
  p95: number | null
  p99: number | null
}

/** `dumpsys meminfo <pkg>` App Summary, in KB. */
export interface PerfMemory {
  totalPss: number
  javaHeap: number | null
  nativeHeap: number | null
  graphics: number | null
  totalRss: number | null
}

/** `am start -W -S` of the launcher activity. */
export interface PerfColdStart {
  totalMs: number | null
  waitMs: number | null
  launchState: string | null
}

export interface PerfSample {
  id: string
  at: number
  pkg: string
  device: string
  kind: 'measure' | 'cold'
  frames: PerfFrames | null
  memory: PerfMemory | null
  coldStart: PerfColdStart | null
  /** The frame counters were reset from Orrery this many ms before the measurement. */
  sinceResetMs?: number
}

export const PERF_HISTORY_MAX = 10

export type PerfHistory = { ok: true; pkg: string; samples: PerfSample[] } | PerfFailure
export type PerfMeasure = { ok: true; sample: PerfSample; samples: PerfSample[] } | PerfFailure
export type PerfReset = { ok: true; at: number } | PerfFailure
