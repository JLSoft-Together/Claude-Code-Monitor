import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PERF_HISTORY_MAX, type DevFailure, type PerfColdStart, type PerfFailure, type PerfFrames, type PerfHistory, type PerfMeasure, type PerfMemory, type PerfReset, type PerfSample } from '@ccm/shared'
import { parseResolvedActivity } from '../run/parse'
import type { AdbCommands } from './adb'
import { isPackage, shQuote } from './uiToggles'

export const PERF_DIR = 'perf'
const LAUNCHER = 'android.intent.category.LAUNCHER'
const DUMP_MS = 20_000
const COLD_MS = 60_000
const COMPONENT = /^[A-Za-z][\w.]*\/[\w.$]+$/
const NOT_RUNNING = /No process found for/i

const fail = (error: PerfFailure['error'], detail?: string): PerfFailure => (detail ? { ok: false, error, detail } : { ok: false, error })
const num = (re: RegExp, text: string): number | null => {
  const m = re.exec(text)
  return m ? Number(m[1]) : null
}

/** The section of the asked package when several processes are listed (remote services print their own). */
function sectionOf(out: string, header: RegExp, pkg: string): string | null {
  const parts = out.split(header)
  if (parts.length < 4) return null
  // split with two capture groups: [before, pid, name, body, pid, name, body…]
  let first: string | null = null
  for (let i = 1; i + 2 < parts.length; i += 3) {
    const body = parts[i + 2] ?? ''
    if (parts[i + 1] === pkg) return body
    first ??= body
  }
  return first
}

export function parseGfxinfo(out: string, pkg: string): PerfFrames | 'not-running' | null {
  if (NOT_RUNNING.test(out)) return 'not-running'
  const body = sectionOf(out, /\*\* Graphics info for pid (\d+) \[([^\]]+)\] \*\*/, pkg) ?? out
  const total = num(/Total frames rendered:\s*(\d+)/, body)
  if (total === null) return null
  const jank = /^\s*Janky frames:\s*(\d+)(?:\s*\(([\d.]+)%\))?/m.exec(body)
  const janky = jank ? Number(jank[1]) : 0
  const pct = jank?.[2] !== undefined ? Number(jank[2]) : total ? (janky / total) * 100 : 0
  const pc = (n: number): number | null => num(new RegExp(`^\\s*${n}th percentile:\\s*(\\d+(?:\\.\\d+)?)\\s*ms`, 'm'), body)
  return { total, janky, jankyPct: Math.round(pct * 100) / 100, p50: pc(50), p90: pc(90), p95: pc(95), p99: pc(99) }
}

export function parseMeminfo(out: string, pkg: string): PerfMemory | 'not-running' | null {
  if (NOT_RUNNING.test(out)) return 'not-running'
  const body = sectionOf(out, /\*\* MEMINFO in pid (\d+) \[([^\]]+)\] \*\*/, pkg) ?? out
  // Android 9+: `TOTAL PSS:`; older App Summaries end with `TOTAL:`; else the first column of the TOTAL table row.
  const totalPss = num(/TOTAL PSS:\s*(\d+)/, body) ?? num(/^\s*TOTAL:\s*(\d+)/m, body) ?? num(/^\s*TOTAL\s+(\d+)/m, body)
  if (totalPss === null) return null
  return {
    totalPss,
    javaHeap: num(/Java Heap:\s*(\d+)/, body),
    nativeHeap: num(/Native Heap:\s*(\d+)/, body),
    graphics: num(/Graphics:\s*(\d+)/, body),
    totalRss: num(/TOTAL RSS:\s*(\d+)/, body),
  }
}

export function parseAmStart(out: string): PerfColdStart | PerfFailure {
  const err = /^\s*(Error[^\n]*)$/m.exec(out)
  if (err) return fail('start-failed', err[1]!.trim().slice(0, 200))
  const status = /^\s*Status:\s*(\w+)/m.exec(out)?.[1]
  if (status && status.toLowerCase() !== 'ok') return fail('start-failed', `Status: ${status}`)
  const totalMs = num(/^\s*TotalTime:\s*(\d+)/m, out) ?? num(/^\s*ThisTime:\s*(\d+)/m, out)
  const waitMs = num(/^\s*WaitTime:\s*(\d+)/m, out)
  if (totalMs === null && waitMs === null) return fail('parse-failed', out.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined)
  return { totalMs, waitMs, launchState: /^\s*LaunchState:\s*(\w+)/m.exec(out)?.[1] ?? null }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** History file entries go back to the page: shape-checked, anything odd dropped. */
export function cleanSamples(raw: unknown, pkg: string): PerfSample[] {
  const list = isObj(raw) && Array.isArray(raw.samples) ? raw.samples : []
  return list
    .filter((s): s is PerfSample => isObj(s) && typeof s.id === 'string' && typeof s.at === 'number' && s.pkg === pkg && (s.kind === 'measure' || s.kind === 'cold'))
    .map((s) => ({ ...s, device: typeof s.device === 'string' ? s.device.slice(0, 80) : '' }))
    .sort((a, b) => b.at - a.at)
    .slice(0, PERF_HISTORY_MAX)
}

export const deviceLabel = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '')

export interface PerfDeps {
  withDevice: <T>(id: string, fn: (cmds: AdbCommands) => Promise<T>) => Promise<T | DevFailure>
  dataDir: string
  /** Native confirm: the cold start kills the app first. */
  confirmCold: (pkg: string) => Promise<boolean>
  now?: () => number
}

export class PerfService {
  private readonly resets = new Map<string, number>()
  private readonly busy = new Set<string>()

  constructor(private readonly deps: PerfDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private fileOf(pkg: string): string {
    return path.join(this.deps.dataDir, PERF_DIR, `${pkg}.json`)
  }

  private async load(pkg: string): Promise<PerfSample[]> {
    const text = await fs.readFile(this.fileOf(pkg), 'utf8').catch(() => null)
    if (!text) return []
    try {
      return cleanSamples(JSON.parse(text), pkg)
    } catch {
      return []
    }
  }

  private async add(sample: PerfSample): Promise<PerfSample[]> {
    const samples = [sample, ...(await this.load(sample.pkg))].slice(0, PERF_HISTORY_MAX)
    const file = this.fileOf(sample.pkg)
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ version: 1, samples }, null, 1))
      await fs.rename(tmp, file)
    } catch {
      // history is best effort; the measurement still goes back to the page
    }
    return samples
  }

  private async once<T>(id: string, fn: () => Promise<T>): Promise<T | PerfFailure> {
    if (this.busy.has(id)) return fail('busy')
    this.busy.add(id)
    try {
      return await fn()
    } finally {
      this.busy.delete(id)
    }
  }

  async history(pkg: string): Promise<PerfHistory> {
    if (!isPackage(pkg)) return fail('invalid')
    return { ok: true, pkg, samples: await this.load(pkg) }
  }

  async clear(pkg: string): Promise<PerfHistory> {
    if (!isPackage(pkg)) return fail('invalid')
    await fs.rm(this.fileOf(pkg), { force: true }).catch(() => undefined)
    return { ok: true, pkg, samples: [] }
  }

  async reset(id: string, pkg: string): Promise<PerfReset> {
    return this.once(id, () =>
      this.deps.withDevice(id, async (cmds): Promise<PerfReset> => {
        const r = await cmds.shell(id, ['dumpsys', 'gfxinfo', shQuote(pkg), 'reset'], DUMP_MS)
        if (!r) return fail('adb-missing')
        if (r.timedOut) return fail('timeout')
        if (NOT_RUNNING.test(r.out)) return fail('not-running')
        const at = this.now()
        this.resets.set(`${id}|${pkg}`, at)
        return { ok: true, at }
      }),
    )
  }

  async measure(id: string, pkg: string, device: string): Promise<PerfMeasure> {
    return this.once(id, () =>
      this.deps.withDevice(id, async (cmds): Promise<PerfMeasure> => {
        const gfx = await cmds.shell(id, ['dumpsys', 'gfxinfo', shQuote(pkg)], DUMP_MS)
        if (!gfx) return fail('adb-missing')
        if (gfx.timedOut) return fail('timeout')
        const mem = await cmds.shell(id, ['dumpsys', 'meminfo', shQuote(pkg)], DUMP_MS)
        if (!mem) return fail('adb-missing')
        if (mem.timedOut) return fail('timeout')
        const frames = parseGfxinfo(gfx.out, pkg)
        const memory = parseMeminfo(mem.out, pkg)
        if (frames === 'not-running' && memory === 'not-running') return fail('not-running')
        const f = frames === 'not-running' ? null : frames
        const m = memory === 'not-running' ? null : memory
        if (!f && !m) return fail('parse-failed', gfx.out.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined)
        const at = this.now()
        const resetAt = this.resets.get(`${id}|${pkg}`)
        const sample: PerfSample = { id: randomBytes(6).toString('hex'), at, pkg, device, kind: 'measure', frames: f, memory: m, coldStart: null }
        if (resetAt !== undefined) sample.sinceResetMs = at - resetAt
        return { ok: true, sample, samples: await this.add(sample) }
      }),
    )
  }

  async coldStart(id: string, pkg: string, device: string): Promise<PerfMeasure> {
    return this.once(id, () =>
      this.deps.withDevice(id, async (cmds): Promise<PerfMeasure> => {
        const resolved = await cmds.shell(id, ['cmd', 'package', 'resolve-activity', '--brief', '-c', LAUNCHER, shQuote(pkg)], DUMP_MS)
        if (!resolved) return fail('adb-missing')
        if (resolved.timedOut) return fail('timeout')
        const component = parseResolvedActivity(resolved.out, pkg)
        if (!component || !COMPONENT.test(component)) return fail('no-launcher')
        if (!(await this.deps.confirmCold(pkg))) return fail('cancelled')
        const r = await cmds.shell(id, ['am', 'start', '-W', '-S', '-n', shQuote(component)], COLD_MS)
        if (!r) return fail('adb-missing')
        if (r.timedOut) return fail('timeout')
        const cold = parseAmStart(r.out)
        if ('ok' in cold) return cold
        this.resets.delete(`${id}|${pkg}`)
        const sample: PerfSample = { id: randomBytes(6).toString('hex'), at: this.now(), pkg, device, kind: 'cold', frames: null, memory: null, coldStart: cold }
        return { ok: true, sample, samples: await this.add(sample) }
      }),
    )
  }
}
