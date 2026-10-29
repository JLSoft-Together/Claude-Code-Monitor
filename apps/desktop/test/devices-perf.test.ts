import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdbCommands } from '../src/devices/adb'
import { cleanSamples, deviceLabel, parseAmStart, parseGfxinfo, parseMeminfo, PerfService } from '../src/devices/perf'

const GFX = `Applications Graphics Acceleration Info:
Uptime: 1803422 Realtime: 1803422

** Graphics info for pid 9120 [com.example.demo:remote] **

Stats since: 100ns
Total frames rendered: 3
Janky frames: 0 (0.00%)

** Graphics info for pid 4242 [com.example.demo] **

Stats since: 1620392094843ns
Total frames rendered: 1234
Janky frames: 56 (4.54%)
Janky frames (legacy): 80 (6.48%)
50th percentile: 8ms
90th percentile: 14ms
95th percentile: 18ms
99th percentile: 32ms
Number Missed Vsync: 10
Number High input latency: 2
Number Slow UI thread: 20
HISTOGRAM: 5ms=100 6ms=200 7ms=300
50th gpu percentile: 3ms
90th gpu percentile: 6ms
Pipeline=Skia (OpenGL)
`

const GFX_OLD = `** Graphics info for pid 1200 [com.old.app] **

Stats since: 5ns
Total frames rendered: 200
Janky frames: 30 (15.00%)
90th percentile: 22ms
95th percentile: 30ms
99th percentile: 61ms
`

const MEM = `Applications Memory Usage (in Kilobytes):
Uptime: 1803422 Realtime: 1803422

** MEMINFO in pid 4242 [com.example.demo] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    12345    12300        0       20    13000    20480    15000     5480
  Dalvik Heap     5678     5600        0       10     6000    12288     6144     6144
        TOTAL    80000    50000    10000      100   120000    32768    21144    11624

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:     7000                          9000
         Native Heap:    12300                         13000
                Code:    20000                         40000
            Graphics:    15000                         15000
              System:    22200

           TOTAL PSS:    80000            TOTAL RSS:   120000       TOTAL SWAP PSS:      100
`

const MEM_OLD = `** MEMINFO in pid 1200 [com.old.app] **
 App Summary
                       Pss(KB)
                        ------
           Java Heap:     4000
         Native Heap:     3000
            Graphics:     2000

               TOTAL:    21000      TOTAL SWAP PSS:       12
`

const AM = `Stopping: com.example.demo
Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=com.example.demo/.MainActivity }
Status: ok
LaunchState: COLD
Activity: com.example.demo/.MainActivity
TotalTime: 812
WaitTime: 820
Complete
`

describe('perf parsers', () => {
  it('reads frames of the asked process from gfxinfo', () => {
    expect(parseGfxinfo(GFX, 'com.example.demo')).toEqual({ total: 1234, janky: 56, jankyPct: 4.54, p50: 8, p90: 14, p95: 18, p99: 32 })
    expect(parseGfxinfo(GFX_OLD, 'com.old.app')).toEqual({ total: 200, janky: 30, jankyPct: 15, p50: null, p90: 22, p95: 30, p99: 61 })
    expect(parseGfxinfo('No process found for: com.x\n', 'com.x')).toBe('not-running')
    expect(parseGfxinfo('garbage', 'com.x')).toBeNull()
  })

  it('reads the meminfo App Summary (new and old layout)', () => {
    expect(parseMeminfo(MEM, 'com.example.demo')).toEqual({ totalPss: 80000, javaHeap: 7000, nativeHeap: 12300, graphics: 15000, totalRss: 120000 })
    expect(parseMeminfo(MEM_OLD, 'com.old.app')).toEqual({ totalPss: 21000, javaHeap: 4000, nativeHeap: 3000, graphics: 2000, totalRss: null })
    expect(parseMeminfo('No process found for: com.x', 'com.x')).toBe('not-running')
  })

  it('reads am start -W times and failures', () => {
    expect(parseAmStart(AM)).toEqual({ totalMs: 812, waitMs: 820, launchState: 'COLD' })
    expect(parseAmStart('Status: ok\nThisTime: 300\nWaitTime: 350\n')).toEqual({ totalMs: 300, waitMs: 350, launchState: null })
    expect(parseAmStart('Starting: Intent {}\nError type 3\nError: Activity class {x} does not exist.\n')).toMatchObject({ ok: false, error: 'start-failed' })
    expect(parseAmStart('Status: timeout\n')).toEqual({ ok: false, error: 'start-failed', detail: 'Status: timeout' })
  })

  it('cleans history files and device labels', () => {
    const raw = { samples: [{ id: 'a', at: 1, pkg: 'com.a', kind: 'measure', device: 'x'.repeat(100) }, { id: 'b', at: 2, pkg: 'com.other', kind: 'measure' }, 'bad'] }
    const out = cleanSamples(raw, 'com.a')
    expect(out).toHaveLength(1)
    expect(out[0]!.device).toHaveLength(80)
    expect(deviceLabel('Pixel\n7\u0007')).toBe('Pixel7')
  })
})

describe('PerfService', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  const service = (outputs: Record<string, string>, confirm = true) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-perf-'))
    dirs.push(dir)
    const calls: string[][] = []
    const cmds = {
      shell: async (_id: string, args: string[]) => {
        calls.push(args)
        const key = Object.keys(outputs).find((k) => args.join(' ').includes(k))
        return { code: 0, out: key ? outputs[key]! : '', err: '' }
      },
    } as unknown as AdbCommands
    let t = 1000
    const perf = new PerfService({ withDevice: (_id, fn) => fn(cmds), dataDir: dir, confirmCold: async () => confirm, now: () => (t += 1000) })
    return { perf, calls, dir }
  }

  it('measures, keeps the newest 10 per package and notes the reset', async () => {
    const { perf, calls, dir } = service({ gfxinfo: GFX, meminfo: MEM })
    expect(await perf.reset('emulator-5554', 'com.example.demo')).toEqual({ ok: true, at: 2000 })
    const first = await perf.measure('emulator-5554', 'com.example.demo', 'Pixel 7')
    expect(first).toMatchObject({ ok: true, sample: { kind: 'measure', device: 'Pixel 7', sinceResetMs: 1000, frames: { total: 1234 }, memory: { totalPss: 80000 } } })
    expect(calls[1]).toEqual(['dumpsys', 'gfxinfo', "'com.example.demo'"])
    for (let i = 0; i < 11; i++) await perf.measure('emulator-5554', 'com.example.demo', 'Pixel 7')
    const h = await perf.history('com.example.demo')
    expect(h.ok && h.samples.length).toBe(10)
    const file = JSON.parse(readFileSync(path.join(dir, 'perf', 'com.example.demo.json'), 'utf8'))
    expect(file.samples[0].at).toBeGreaterThan(file.samples[9].at)
    expect(await perf.history('../evil')).toEqual({ ok: false, error: 'invalid' })
  })

  it('reports a stopped app', async () => {
    const { perf } = service({ gfxinfo: 'No process found for: com.example.demo', meminfo: 'No process found for: com.example.demo' })
    expect(await perf.measure('e', 'com.example.demo', '')).toEqual({ ok: false, error: 'not-running' })
  })

  it('cold start resolves the launcher, asks first and parses the times', async () => {
    const { perf, calls } = service({ 'resolve-activity': 'priority=0\ncom.example.demo/.MainActivity\n', 'am start': AM })
    const r = await perf.coldStart('e', 'com.example.demo', 'Pixel')
    expect(r).toMatchObject({ ok: true, sample: { kind: 'cold', coldStart: { totalMs: 812, waitMs: 820, launchState: 'COLD' } } })
    expect(calls[1]).toEqual(['am', 'start', '-W', '-S', '-n', "'com.example.demo/.MainActivity'"])
    const no = service({ 'resolve-activity': 'priority=0\ncom.example.demo/.MainActivity\n' }, false)
    expect(await no.perf.coldStart('e', 'com.example.demo', '')).toEqual({ ok: false, error: 'cancelled' })
    expect(no.calls).toHaveLength(1)
    const none = service({ 'resolve-activity': 'No activity found\n' })
    expect(await none.perf.coldStart('e', 'com.example.demo', '')).toEqual({ ok: false, error: 'no-launcher' })
  })
})
