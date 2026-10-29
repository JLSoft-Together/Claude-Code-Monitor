import type { ChildProcess } from 'node:child_process'
import type { AdbMdnsService, DevCapture, DevErrorCode, DevResult, DevUiDump } from '@ccm/shared'
import { collect, type Collected } from '../run/collect'
import { killAdbClient, type Spawner } from '../run/proc'
import { parseAdbDeviceRows, parseConnect, parseDisconnect, parseMdnsServices, parsePair, parseWlanIp, type AdbDeviceRow } from './parse'
import { findPngStart, parseUiDump, pngSize } from './uiDump'

export interface AdbCommandsOpts {
  spawn: Spawner
  cwd: string
  adb: () => Promise<string | null>
  timing?: Partial<{ connectMs: number; pairMs: number; cmdMs: number; captureMs: number; dumpMs: number }>
}

export interface AdbCommands {
  connect(target: string): Promise<DevResult>
  pair(hostPort: string, code: string): Promise<DevResult>
  disconnect(id: string): Promise<DevResult>
  tcpip(id: string, port: number): Promise<DevResult>
  wlanIp(id: string): Promise<string | null>
  mdnsCheck(): Promise<boolean>
  mdnsServices(): Promise<AdbMdnsService[]>
  /** One-shot `adb devices -l`; null when adb is missing, timed out or failed. */
  list(): Promise<AdbDeviceRow[] | null>
  screencap(id: string): Promise<DevCapture>
  /** Dumps to a temp file on the device, reads it back and removes it. */
  uiDump(id: string): Promise<DevUiDump>
  /** `adb -s id shell …`: the caller quotes anything that is not a fixed word (remote sh joins argv). */
  shell(id: string, args: string[], timeoutMs?: number): Promise<Collected | null>
  /** `adb -s id exec-out …` with stdout kept as bytes, stopped past `max` (`overflow`); null when adb is missing. */
  execOut(id: string, args: string[], timeoutMs: number, max: number): Promise<Bytes | null>
  /** `adb -s id shell …` fed `input` on stdin (shell protocol v2 forwards it). */
  shellInput(id: string, args: string[], input: Buffer, timeoutMs: number): Promise<Bytes | null>
}

const TIMING = { connectMs: 15_000, pairMs: 20_000, cmdMs: 10_000, captureMs: 15_000, dumpMs: 20_000 }
const CAPTURE_MAX = 64 * 1024 * 1024
export const UI_DUMP_PATH = '/sdcard/orrery-ui.xml'
const DETAIL_MAX = 300

const detailOf = (text: string): string | undefined => {
  const d = text.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX)
  return d || undefined
}

const fail = (error: DevErrorCode, text = ''): { ok: false; error: DevErrorCode; detail?: string } => {
  const detail = detailOf(text)
  return detail ? { ok: false, error, detail } : { ok: false, error }
}

export interface Bytes {
  code: number | null
  out: Buffer
  err: string
  timedOut?: boolean
  overflow?: boolean
}

/** Like `collect`, but keeps stdout as bytes (screencap PNG) and stops past `max`; `input` goes to stdin. */
function collectBytes(spawn: Spawner, file: string, args: string[], cwd: string, timeoutMs: number, max: number, input?: Buffer): Promise<Bytes> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(input ? { file, args, cwd, stdin: 'pipe' } : { file, args, cwd })
    } catch {
      resolve({ code: null, out: Buffer.alloc(0), err: '' })
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let err = ''
    let settled = false
    const finish = (code: number | null, timedOut = false, overflow = false): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const out = Buffer.concat(chunks)
      resolve(timedOut ? { code, out, err, timedOut } : overflow ? { code, out, err, overflow } : { code, out, err })
    }
    const timer = setTimeout(() => {
      killAdbClient(child)
      finish(null, true)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer | string) => {
      const b = typeof d === 'string' ? Buffer.from(d) : d
      size += b.length
      if (size > max) {
        killAdbClient(child)
        finish(null, false, true)
        return
      }
      chunks.push(b)
    })
    child.stderr?.on('data', (d: Buffer | string) => (err = (err + d.toString()).slice(-4096)))
    child.once('error', () => finish(null))
    child.once('close', (code: number | null) => finish(code))
    if (input && child.stdin) {
      child.stdin.on('error', () => undefined)
      child.stdin.end(input)
    }
  })
}

export function createAdbCommands(opts: AdbCommandsOpts): AdbCommands {
  const t = { ...TIMING, ...opts.timing }

  const run = async (args: string[], timeoutMs: number): Promise<Collected | null> => {
    const adb = await opts.adb()
    return adb ? collect(opts.spawn, adb, args, opts.cwd, { timeoutMs, kill: killAdbClient }) : null
  }

  const result = async (args: string[], timeoutMs: number, spawnFailed: DevErrorCode, parse: (r: Collected) => DevResult): Promise<DevResult> => {
    const r = await run(args, timeoutMs)
    if (!r) return { ok: false, error: 'adb-missing' }
    if (r.timedOut) return { ok: false, error: 'timeout' }
    if (r.code === null) return { ok: false, error: spawnFailed }
    return parse(r)
  }

  return {
    connect: (target) => result(['connect', target], t.connectMs, 'connect-failed', (r) => parseConnect(r.out)),
    pair: (hostPort, code) => result(['pair', hostPort, code], t.pairMs, 'pair-failed', (r) => parsePair(r.out)),
    disconnect: (id) => result(['disconnect', id], t.cmdMs, 'not-connected', (r) => parseDisconnect(r.out)),
    tcpip: (id, port) =>
      result(['-s', id, 'tcpip', String(port)], t.cmdMs, 'tcpip-failed', (r) => {
        if (r.code === 0 && !/error/i.test(r.out)) return { ok: true }
        const detail = r.out.trim()
        return detail ? { ok: false, error: 'tcpip-failed', detail } : { ok: false, error: 'tcpip-failed' }
      }),
    async wlanIp(id) {
      const r = await run(['-s', id, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], t.cmdMs)
      return r && r.code === 0 ? parseWlanIp(r.out) : null
    },
    async mdnsCheck() {
      const r = await run(['mdns', 'check'], t.cmdMs)
      return !!r && r.code === 0 && !/unavailable/i.test(r.out)
    },
    async mdnsServices() {
      const r = await run(['mdns', 'services'], t.cmdMs)
      return r && r.code === 0 ? parseMdnsServices(r.out) : []
    },
    async list() {
      const r = await run(['devices', '-l'], t.cmdMs)
      return r && !r.timedOut && r.code === 0 ? parseAdbDeviceRows(r.out) : null
    },
    async screencap(id) {
      const adb = await opts.adb()
      if (!adb) return fail('adb-missing')
      const r = await collectBytes(opts.spawn, adb, ['-s', id, 'exec-out', 'screencap', '-p'], opts.cwd, t.captureMs, CAPTURE_MAX)
      if (r.timedOut) return fail('timeout')
      const start = findPngStart(r.out)
      const png = start >= 0 ? r.out.subarray(start) : null
      const size = png ? pngSize(png) : null
      if (!png || !size) {
        const text = `${r.out.subarray(0, 2048).toString()} ${r.err}`
        return fail(/secure/i.test(text) ? 'secure' : 'capture-failed', text)
      }
      return { ok: true, png: `data:image/png;base64,${png.toString('base64')}`, ...size }
    },
    shell: (id, args, timeoutMs) => run(['-s', id, 'shell', ...args], timeoutMs ?? t.cmdMs),
    async execOut(id, args, timeoutMs, max) {
      const adb = await opts.adb()
      return adb ? collectBytes(opts.spawn, adb, ['-s', id, 'exec-out', ...args], opts.cwd, timeoutMs, max) : null
    },
    async shellInput(id, args, input, timeoutMs) {
      const adb = await opts.adb()
      return adb ? collectBytes(opts.spawn, adb, ['-s', id, 'shell', ...args], opts.cwd, timeoutMs, 64 * 1024, input) : null
    },
    async uiDump(id) {
      const dumped = await run(['-s', id, 'shell', 'uiautomator', 'dump', UI_DUMP_PATH], t.dumpMs)
      if (!dumped) return fail('adb-missing')
      if (dumped.timedOut) return fail('timeout')
      if (dumped.code !== 0 || !/dumped to/i.test(dumped.out)) return fail(/secure/i.test(dumped.out) ? 'secure' : 'dump-failed', dumped.out)
      try {
        const read = await run(['-s', id, 'exec-out', 'cat', UI_DUMP_PATH], t.cmdMs)
        if (!read || read.timedOut || read.code !== 0) return fail('dump-failed', read?.out ?? '')
        const parsed = parseUiDump(read.out)
        return parsed ? { ok: true, ...parsed } : fail('dump-failed', read.out.slice(0, DETAIL_MAX))
      } finally {
        await run(['-s', id, 'shell', 'rm', '-f', UI_DUMP_PATH], t.cmdMs)
      }
    },
  }
}
