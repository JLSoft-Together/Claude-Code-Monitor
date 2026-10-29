import { describe, expect, it } from 'vitest'
import type { PerfSample } from '@ccm/shared'
import { comparable, compareSamples, defaultBase, fmtDelta, fmtValue, perfPrompt } from './devPerf'

const sample = (id: string, at: number, over: Partial<PerfSample> = {}): PerfSample => ({
  id,
  at,
  pkg: 'com.example.demo',
  device: 'Pixel 7',
  kind: 'measure',
  frames: { total: 1000, janky: 50, jankyPct: 5, p50: 8, p90: 14, p95: 18, p99: 32 },
  memory: { totalPss: 80_000, javaHeap: 7000, nativeHeap: 12_000, graphics: 15_000, totalRss: null },
  coldStart: null,
  ...over,
})

describe('devPerf', () => {
  it('compares with lower = better and ignores noise', () => {
    const base = sample('a', 1)
    const cur = sample('b', 2, { frames: { total: 900, janky: 18, jankyPct: 2, p50: 8.4, p90: 12, p95: 18, p99: 40 }, memory: { totalPss: 80_500, javaHeap: 9000, nativeHeap: 12_000, graphics: 15_000, totalRss: null } })
    const rows = Object.fromEntries(compareSamples(cur, base).map((r) => [r.key, r.trend]))
    expect(rows).toMatchObject({ jankyPct: 'better', p50: 'same', p90: 'better', p99: 'worse', totalPss: 'same', javaHeap: 'worse' })
    expect(rows.coldTotal).toBeUndefined()
  })

  it('picks the previous sample sharing a metric as the default base', () => {
    const cold = sample('c', 3, { kind: 'cold', frames: null, memory: null, coldStart: { totalMs: 800, waitMs: 820, launchState: 'COLD' } })
    const newest = sample('d', 4)
    const list = [newest, cold, sample('b', 2), sample('a', 1)]
    expect(defaultBase(list, newest)?.id).toBe('b')
    expect(defaultBase(list, cold)).toBeNull()
    expect(comparable(list, newest).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('formats values, deltas and the agent prompt', () => {
    expect(fmtValue(80_000, 'kb')).toBe('78.1 MB')
    expect(fmtDelta(-1.5, 'pct')).toBe('−1.50 pt')
    expect(fmtDelta(2048, 'kb')).toBe('+2.0 MB')
    const base = sample('a', Date.UTC(2026, 9, 29, 10, 0))
    const cur = sample('b', Date.UTC(2026, 9, 29, 11, 0), { frames: { total: 900, janky: 18, jankyPct: 2, p50: 8, p90: 12, p95: 18, p99: 32 } })
    const text = perfPrompt(cur, base)
    expect(text).toContain('Performance snapshot of com.example.demo on Pixel 7 (2026-10-29 11:00 UTC')
    expect(text).toContain('- Frames: 900 rendered, 18 janky (2.00 %), p50 8 ms, p90 12 ms, p95 18 ms, p99 32 ms')
    expect(text).toContain('- Memory: total PSS 78.1 MB, Java heap 6.8 MB, native heap 11.7 MB, graphics 14.6 MB')
    expect(text).toContain('- janky frames: 5.00 % → 2.00 % (−3.00 pt, better)')
    expect(perfPrompt(sample('c', 0, { kind: 'cold', frames: null, memory: null, coldStart: { totalMs: 812, waitMs: 820, launchState: 'COLD' } }), null)).toContain('- Cold start (am start -W -S): TotalTime 812 ms, WaitTime 820 ms (COLD)')
  })
})
