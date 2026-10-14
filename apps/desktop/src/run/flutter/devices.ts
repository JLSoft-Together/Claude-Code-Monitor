import type { ChildProcess } from 'node:child_process'
import type { RunDevice, RunEmulator, RunResult } from '@ccm/shared'
import { flutterDevice, lineSplitter, machineRequest, parseMachineLine } from '../parse'
import { killTree, type Spawner } from '../proc'
import type { DeviceService, RunSettings } from '../types'
import { findFlutterSdk, flutterSpawn } from './env'

export interface FlutterDevicesOpts {
  settings: RunSettings
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  spawn: Spawner
  /** Overrides the global SDK lookup (setting → FLUTTER_ROOT → PATH → defaults). */
  sdkFor?: () => string | null
  kill?: (child: ChildProcess, sync?: boolean) => void
  now?: () => number
  firstBatchMs?: number
}

const FIRST_BATCH = 8_000
const BATCH_SETTLE = 500
const REQUEST_TIMEOUT = 30_000
const FALLBACK_TIMEOUT = 30_000
const FALLBACK_TTL = 10_000
const LAUNCH_TIMEOUT = 60_000
const MAX_RESTARTS = 3
const RESTART_WINDOW = 5 * 60_000

interface Daemon {
  child: ChildProcess
  alive: boolean
  ready: Promise<void>
  pending: Map<number, (r: { result?: unknown; error?: unknown }) => void>
  nextId: number
}

/** Parses the JSON array out of `--machine` output; tolerates banner text around it. */
export function machineJsonArray(stdout: string): unknown[] | null {
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(stdout.slice(start, end + 1)) as unknown
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

export function flutterEmulator(raw: unknown): RunEmulator | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || !e.id) return null
  return { id: e.id, name: typeof e.name === 'string' && e.name ? e.name : e.id, source: 'flutter' }
}

/** `flutter emulators` text: `id • name • manufacturer • platform` rows. */
export function parseEmulatorsText(out: string): RunEmulator[] {
  const list: RunEmulator[] = []
  for (const line of out.split(/\r?\n/)) {
    const cols = line.split('•').map((c) => c.trim())
    if (cols.length < 2 || !cols[0] || /\s/.test(cols[0]) || cols[0].toLowerCase() === 'id') continue
    list.push({ id: cols[0], name: cols[1] || cols[0], source: 'flutter' })
  }
  return list
}

export function createFlutterDevices(opts: FlutterDevicesOpts): DeviceService {
  const kill = opts.kill ?? killTree
  const now = opts.now ?? Date.now
  const devices = new Map<string, RunDevice>()
  const listeners = new Set<(devices: RunDevice[]) => void>()
  const starts: number[] = []
  let daemon: Daemon | null = null
  let fallback: { at: number; devices: Promise<RunDevice[]> } | null = null
  const oneShots = new Set<ChildProcess>()

  const sdk = (): string | null =>
    opts.sdkFor ? opts.sdkFor() : findFlutterSdk(opts.home, { setting: opts.settings.flutterSdk, env: opts.env, platform: opts.platform, home: opts.home }).sdk

  const snapshot = (): RunDevice[] => [...devices.values()]
  const notify = (): void => {
    const list = snapshot()
    for (const cb of listeners) cb(list)
  }

  const spawnFlutter = (root: string, args: string[], stdin: 'pipe' | 'ignore' = 'ignore'): ChildProcess => {
    const spec = flutterSpawn(root, args, opts.platform, opts.env)
    return opts.spawn({ file: spec.file, args: spec.args, cwd: opts.home, verbatim: spec.windowsVerbatimArguments === true, stdin })
  }

  /** Runs a one-shot flutter command; resolves stdout + exit code (null on timeout / spawn error). */
  const collect = (args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }> => {
    const root = sdk()
    if (!root) return Promise.resolve({ code: null, stdout: '' })
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawnFlutter(root, args)
      } catch {
        return resolve({ code: null, stdout: '' })
      }
      oneShots.add(child)
      let stdout = ''
      let done = false
      const finish = (code: number | null): void => {
        if (done) return
        done = true
        oneShots.delete(child)
        clearTimeout(timer)
        resolve({ code, stdout })
      }
      const timer = setTimeout(() => {
        kill(child)
        finish(null)
      }, timeoutMs)
      child.stdout?.on('data', (c: Buffer | string) => (stdout += c.toString()))
      child.stderr?.on('data', () => undefined)
      child.once('error', () => finish(null))
      child.once('close', (code) => finish(code))
    })
  }

  const request = (d: Daemon, method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: unknown }> => {
    if (!d.alive || !d.child.stdin || d.child.stdin.destroyed) return Promise.resolve({ error: 'daemon-down' })
    const id = d.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        d.pending.delete(id)
        resolve({ error: 'timeout' })
      }, REQUEST_TIMEOUT)
      d.pending.set(id, (r) => {
        clearTimeout(timer)
        resolve(r)
      })
      d.child.stdin!.write(machineRequest(id, method, params))
    })
  }

  function startDaemon(): Daemon | null {
    if (daemon?.alive) return daemon
    const t = now()
    while (starts.length && t - starts[0]! > RESTART_WINDOW) starts.shift()
    if (starts.length > MAX_RESTARTS) return null
    const root = sdk()
    if (!root) return null
    let child: ChildProcess
    try {
      child = spawnFlutter(root, ['daemon'], 'pipe')
    } catch {
      return null
    }
    starts.push(t)
    devices.clear()
    let markReady: () => void = () => undefined
    const d: Daemon = { child, alive: true, ready: new Promise((r) => (markReady = r)), pending: new Map(), nextId: 1 }
    const firstTimer = setTimeout(() => markReady(), opts.firstBatchMs ?? FIRST_BATCH)
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const settle = (): void => {
      settleTimer ??= setTimeout(() => markReady(), BATCH_SETTLE)
    }
    void d.ready.then(() => {
      clearTimeout(firstTimer)
      if (settleTimer) clearTimeout(settleTimer)
    })

    const out = lineSplitter((line) => {
      const msg = parseMachineLine(line)
      if (msg.kind === 'response') {
        const cb = d.pending.get(msg.id)
        d.pending.delete(msg.id)
        cb?.({ result: msg.result, error: msg.error })
      } else if (msg.kind === 'event') {
        if (msg.event === 'device.added') {
          const dev = flutterDevice(msg.params)
          if (!dev) return
          devices.set(dev.id, dev)
          notify()
          settle()
        } else if (msg.event === 'device.removed') {
          const id = typeof msg.params.id === 'string' ? msg.params.id : null
          if (id && devices.delete(id)) notify()
        }
      }
    })
    child.stdout?.on('data', out.push)
    child.stderr?.on('data', () => undefined)
    child.stdin?.on('error', () => undefined)
    const down = (): void => {
      if (!d.alive) return
      d.alive = false
      if (daemon === d) daemon = null
      for (const cb of d.pending.values()) cb({ error: 'daemon-down' })
      d.pending.clear()
      markReady()
    }
    child.once('error', down)
    child.once('close', () => {
      out.flush()
      down()
    })
    daemon = d
    void request(d, 'device.enable')
    void request(d, 'device.getDevices').then(({ result }) => {
      if (!Array.isArray(result)) return
      let changed = false
      for (const raw of result) {
        const dev = flutterDevice(raw)
        if (dev && !devices.has(dev.id)) {
          devices.set(dev.id, dev)
          changed = true
        }
      }
      if (changed) notify()
      if (devices.size) settle()
    })
    return d
  }

  async function fallbackList(): Promise<RunDevice[]> {
    if (fallback && now() - fallback.at < FALLBACK_TTL) return fallback.devices
    const devicesP = collect(['devices', '--machine'], FALLBACK_TIMEOUT).then(({ stdout }) =>
      (machineJsonArray(stdout) ?? []).map(flutterDevice).filter((d): d is RunDevice => d !== null),
    )
    fallback = { at: now(), devices: devicesP }
    return devicesP
  }

  async function list(): Promise<RunDevice[]> {
    const d = startDaemon()
    if (d) {
      await d.ready
      if (d.alive || devices.size) return snapshot()
    }
    return fallbackList()
  }

  async function emulators(): Promise<RunEmulator[]> {
    const d = startDaemon()
    if (d) {
      const { result } = await request(d, 'emulator.getEmulators')
      if (Array.isArray(result)) return result.map(flutterEmulator).filter((e): e is RunEmulator => e !== null)
    }
    const { stdout } = await collect(['emulators', '--machine'], FALLBACK_TIMEOUT)
    const json = machineJsonArray(stdout)
    return json ? json.map(flutterEmulator).filter((e): e is RunEmulator => e !== null) : parseEmulatorsText(stdout)
  }

  async function launchEmulator(id: string): Promise<RunResult> {
    const d = startDaemon()
    if (d) {
      const { error } = await request(d, 'emulator.launch', { emulatorId: id })
      if (error === undefined || error === null) return { ok: true }
      if (error !== 'daemon-down') return { ok: false, error: { code: 'emulator-launch', detail: typeof error === 'string' ? error : JSON.stringify(error) } }
    }
    const { code } = await collect(['emulators', '--launch', id], LAUNCH_TIMEOUT)
    return code === 0 ? { ok: true } : { ok: false, error: { code: 'emulator-launch', detail: id } }
  }

  function stop(sync = false): void {
    for (const c of oneShots) kill(c, sync)
    oneShots.clear()
    const d = daemon
    if (!d) return
    if (sync) {
      daemon = null
      devices.clear()
      kill(d.child, true)
      return
    }
    void request(d, 'daemon.shutdown')
    // stdin EOF also ends the daemon, covering app quit before the kill timer fires.
    d.child.stdin?.end()
    daemon = null
    devices.clear()
    const timer = setTimeout(() => kill(d.child), 2_000)
    d.child.once('close', () => clearTimeout(timer))
  }

  return {
    list,
    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    emulators,
    launchEmulator,
    stop,
  }
}
