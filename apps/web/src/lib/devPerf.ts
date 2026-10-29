import type { PerfFailure, PerfHistory, PerfMeasure, PerfReset, PerfSample } from '@ccm/shared'
import { desktop } from './desktop'

interface PerfBridge {
  perfHistory?: (pkg: string) => Promise<PerfHistory>
  perfClear?: (pkg: string) => Promise<PerfHistory>
  perfReset?: (id: string, pkg: string) => Promise<PerfReset>
  perfMeasure?: (id: string, pkg: string, device: string) => Promise<PerfMeasure>
  perfCold?: (id: string, pkg: string, device: string) => Promise<PerfMeasure>
}

const bridge = desktop as unknown as PerfBridge | undefined
const unavailable: PerfFailure = { ok: false, error: 'denied' }

export const hasDevPerf = typeof bridge?.perfMeasure === 'function'
export const perfHistory = (pkg: string): Promise<PerfHistory> => bridge?.perfHistory?.(pkg) ?? Promise.resolve(unavailable)
export const perfClear = (pkg: string): Promise<PerfHistory> => bridge?.perfClear?.(pkg) ?? Promise.resolve(unavailable)
export const perfReset = (id: string, pkg: string): Promise<PerfReset> => bridge?.perfReset?.(id, pkg) ?? Promise.resolve(unavailable)
export const perfMeasure = (id: string, pkg: string, device: string): Promise<PerfMeasure> => bridge?.perfMeasure?.(id, pkg, device) ?? Promise.resolve(unavailable)
/** Desktop asks a native confirm first: `am start -S` kills the app. */
export const perfCold = (id: string, pkg: string, device: string): Promise<PerfMeasure> => bridge?.perfCold?.(id, pkg, device) ?? Promise.resolve(unavailable)

export type PerfMetric = 'jankyPct' | 'p50' | 'p90' | 'p95' | 'p99' | 'totalPss' | 'javaHeap' | 'nativeHeap' | 'graphics' | 'coldTotal' | 'coldWait'
export type PerfUnit = 'pct' | 'ms' | 'kb'
export type PerfTrend = 'better' | 'worse' | 'same'

export const PERF_METRICS: { key: PerfMetric; unit: PerfUnit; group: 'frames' | 'memory' | 'cold'; get: (s: PerfSample) => number | null }[] = [
  { key: 'jankyPct', unit: 'pct', group: 'frames', get: (s) => s.frames?.jankyPct ?? null },
  { key: 'p50', unit: 'ms', group: 'frames', get: (s) => s.frames?.p50 ?? null },
  { key: 'p90', unit: 'ms', group: 'frames', get: (s) => s.frames?.p90 ?? null },
  { key: 'p95', unit: 'ms', group: 'frames', get: (s) => s.frames?.p95 ?? null },
  { key: 'p99', unit: 'ms', group: 'frames', get: (s) => s.frames?.p99 ?? null },
  { key: 'totalPss', unit: 'kb', group: 'memory', get: (s) => s.memory?.totalPss ?? null },
  { key: 'javaHeap', unit: 'kb', group: 'memory', get: (s) => s.memory?.javaHeap ?? null },
  { key: 'nativeHeap', unit: 'kb', group: 'memory', get: (s) => s.memory?.nativeHeap ?? null },
  { key: 'graphics', unit: 'kb', group: 'memory', get: (s) => s.memory?.graphics ?? null },
  { key: 'coldTotal', unit: 'ms', group: 'cold', get: (s) => s.coldStart?.totalMs ?? null },
  { key: 'coldWait', unit: 'ms', group: 'cold', get: (s) => s.coldStart?.waitMs ?? null },
]

export const fmtMb = (kb: number): string => `${(kb / 1024).toFixed(1)} MB`

export function fmtValue(v: number, unit: PerfUnit): string {
  if (unit === 'pct') return `${v.toFixed(2)} %`
  if (unit === 'ms') return `${Math.round(v)} ms`
  return fmtMb(v)
}

export function fmtDelta(d: number, unit: PerfUnit): string {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  const a = Math.abs(d)
  if (unit === 'pct') return `${sign}${a.toFixed(2)} pt`
  if (unit === 'ms') return `${sign}${Math.round(a)} ms`
  return `${sign}${(a / 1024).toFixed(1)} MB`
}

/** Below this a difference is noise (one frame bucket, a GC). Lower is better for every metric. */
function tolerance(unit: PerfUnit, base: number): number {
  if (unit === 'pct') return 0.5
  if (unit === 'ms') return 1
  return Math.max(256, base * 0.01)
}

export interface PerfCompareRow {
  key: PerfMetric
  unit: PerfUnit
  cur: number
  base: number
  delta: number
  trend: PerfTrend
}

export function compareSamples(cur: PerfSample, base: PerfSample): PerfCompareRow[] {
  const rows: PerfCompareRow[] = []
  for (const m of PERF_METRICS) {
    const a = m.get(cur)
    const b = m.get(base)
    if (a === null || b === null) continue
    const delta = a - b
    const trend: PerfTrend = Math.abs(delta) < tolerance(m.unit, b) ? 'same' : delta < 0 ? 'better' : 'worse'
    rows.push({ key: m.key, unit: m.unit, cur: a, base: b, delta, trend })
  }
  return rows
}

const sharesMetric = (a: PerfSample, b: PerfSample): boolean => PERF_METRICS.some((m) => m.get(a) !== null && m.get(b) !== null)

/** Samples are newest first: the next older one that has a metric in common. */
export function defaultBase(samples: PerfSample[], cur: PerfSample): PerfSample | null {
  const i = samples.findIndex((s) => s.id === cur.id)
  return samples.slice(i + 1).find((s) => sharesMetric(cur, s)) ?? null
}

export const comparable = (samples: PerfSample[], cur: PerfSample): PerfSample[] => samples.filter((s) => s.id !== cur.id && sharesMetric(cur, s))

const LABEL: Record<PerfMetric, string> = {
  jankyPct: 'janky frames',
  p50: 'frame p50',
  p90: 'frame p90',
  p95: 'frame p95',
  p99: 'frame p99',
  totalPss: 'total PSS',
  javaHeap: 'Java heap',
  nativeHeap: 'native heap',
  graphics: 'graphics',
  coldTotal: 'cold start TotalTime',
  coldWait: 'cold start WaitTime',
}

const stamp = (at: number): string => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

/** Agent prompt in English like the other device prompts; numbers only, nothing from the app's screen. */
export function perfPrompt(cur: PerfSample, base: PerfSample | null): string {
  const lines = [`Performance snapshot of ${cur.pkg}${cur.device ? ` on ${cur.device}` : ''} (${stamp(cur.at)} UTC, measured by Orrery):`]
  const f = cur.frames
  if (f) {
    const pcs = (['p50', 'p90', 'p95', 'p99'] as const).filter((k) => f[k] !== null).map((k) => `${k} ${f[k]} ms`)
    lines.push(`- Frames: ${f.total} rendered, ${f.janky} janky (${f.jankyPct.toFixed(2)} %)${pcs.length ? `, ${pcs.join(', ')}` : ''}`)
  }
  const m = cur.memory
  if (m) {
    const parts = [`total PSS ${fmtMb(m.totalPss)}`]
    if (m.javaHeap !== null) parts.push(`Java heap ${fmtMb(m.javaHeap)}`)
    if (m.nativeHeap !== null) parts.push(`native heap ${fmtMb(m.nativeHeap)}`)
    if (m.graphics !== null) parts.push(`graphics ${fmtMb(m.graphics)}`)
    lines.push(`- Memory: ${parts.join(', ')}`)
  }
  const c = cur.coldStart
  if (c) {
    const parts = [c.totalMs !== null ? `TotalTime ${c.totalMs} ms` : null, c.waitMs !== null ? `WaitTime ${c.waitMs} ms` : null].filter(Boolean)
    lines.push(`- Cold start (am start -W -S): ${parts.join(', ')}${c.launchState ? ` (${c.launchState})` : ''}`)
  }
  if (base) {
    const rows = compareSamples(cur, base).filter((r) => r.trend !== 'same')
    lines.push('', rows.length ? `Compared with ${stamp(base.at)} UTC:` : `No notable change compared with ${stamp(base.at)} UTC.`)
    for (const r of rows) lines.push(`- ${LABEL[r.key]}: ${fmtValue(r.base, r.unit)} → ${fmtValue(r.cur, r.unit)} (${fmtDelta(r.delta, r.unit)}, ${r.trend})`)
  }
  return lines.join('\n')
}
