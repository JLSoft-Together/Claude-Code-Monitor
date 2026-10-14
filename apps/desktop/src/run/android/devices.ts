import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { RunDevice, RunEmulator, RunResult } from '@ccm/shared'
import { parseAdbDevices, readAdbFrames } from '../parse'
import { killTree, type Spawner } from '../proc'
import { resolveCommand } from '../resolve'
import type { DeviceService, RunSettings } from '../types'
import { defaultSdkDir, fsEnvDeps, type EnvDeps } from './env'

export interface Collected {
  code: number | null
  out: string
}

/** Spawns, collects stdout + stderr, resolves on close (code null when it could not start or timed out). */
export function collect(
  spawn: Spawner,
  file: string,
  args: string[],
  cwd: string,
  opts: { timeoutMs?: number; env?: Record<string, string>; track?: (child: ChildProcess, done: boolean) => void } = {},
): Promise<Collected> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn({ file, args, cwd, env: opts.env })
    } catch {
      resolve({ code: null, out: '' })
      return
    }
    opts.track?.(child, false)
    let out = ''
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.track?.(child, true)
      resolve({ code, out })
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killTree(child)
          finish(null)
        }, opts.timeoutMs)
      : null
    child.stdout?.on('data', (d: Buffer | string) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer | string) => (out += d.toString()))
    child.once('error', () => finish(null))
    child.once('close', (code: number | null) => finish(code))
  })
}

export interface AdbDevicesOpts {
  settings: RunSettings
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  spawn: Spawner
  deps?: EnvDeps
  timing?: Partial<typeof TIMING>
}

const TIMING = {
  firstListMs: 3_000,
  pollMs: 3_000,
  restartWindowMs: 5 * 60_000,
  maxRestarts: 3,
  bootPollMs: 2_000,
  bootTimeoutMs: 180_000,
}

const exe = (name: string, platform: NodeJS.Platform): string => (platform === 'win32' ? `${name}.exe` : name)

async function findTools(opts: AdbDevicesOpts, deps: EnvDeps): Promise<{ adb: string | null; emulator: string | null }> {
  const p = opts.platform === 'win32' ? path.win32 : path.posix
  const sdks = [opts.settings.androidSdk, opts.env.ANDROID_HOME, opts.env.ANDROID_SDK_ROOT, defaultSdkDir(opts.env, opts.platform, opts.home)]
  for (const sdk of sdks) {
    if (!sdk?.trim()) continue
    const adb = p.join(sdk.trim(), 'platform-tools', exe('adb', opts.platform))
    if (!(await deps.isFile(adb))) continue
    const emu = p.join(sdk.trim(), 'emulator', exe('emulator', opts.platform))
    return { adb, emulator: (await deps.isFile(emu)) ? emu : null }
  }
  const onPath = resolveCommand('adb', opts.home, opts.env, opts.platform)
  return { adb: onPath && !onPath.verbatim ? onPath.file : null, emulator: null }
}

const sameDevices = (a: RunDevice[], b: RunDevice[]): boolean => JSON.stringify(a) === JSON.stringify(b)

export function createAdbDevices(opts: AdbDevicesOpts): DeviceService {
  const t = { ...TIMING, ...opts.timing }
  const deps = opts.deps ?? fsEnvDeps
  let tools: Promise<{ adb: string | null; emulator: string | null }> | null = null
  const getTools = (): Promise<{ adb: string | null; emulator: string | null }> => (tools ??= findTools(opts, deps))

  let devices: RunDevice[] = []
  let started: Promise<void> | null = null
  let gotFirst = false
  let firstWaiters: (() => void)[] = []
  let tracker: ChildProcess | null = null
  let restarts: number[] = []
  let polling = false
  let pollTimer: NodeJS.Timeout | null = null
  let stopped = false
  const listeners = new Set<(d: RunDevice[]) => void>()

  const publish = (next: RunDevice[]): void => {
    const changed = !sameDevices(devices, next)
    devices = next
    if (!gotFirst) {
      gotFirst = true
      for (const w of firstWaiters) w()
      firstWaiters = []
    }
    if (changed) for (const cb of listeners) cb(devices)
  }

  const pollOnce = async (): Promise<void> => {
    const { adb } = await getTools()
    if (!adb) return publish([])
    const r = await collect(opts.spawn, adb, ['devices', '-l'], opts.home, { timeoutMs: 10_000 })
    if (r.code === 0) publish(parseAdbDevices(r.out))
  }

  const schedulePoll = (): void => {
    if (pollTimer || stopped || !polling || !listeners.size) return
    pollTimer = setTimeout(() => {
      pollTimer = null
      void pollOnce().finally(schedulePoll)
    }, t.pollMs)
  }

  const startTracker = (adb: string): void => {
    let child: ChildProcess
    try {
      child = opts.spawn({ file: adb, args: ['track-devices', '-l'], cwd: opts.home })
    } catch {
      return onTrackerExit()
    }
    tracker = child
    let buf = ''
    child.stdout?.on('data', (d: Buffer | string) => {
      try {
        const { frames, rest } = readAdbFrames(buf + d.toString())
        // A frame is at most 4 + 0xffff chars; anything longer is not adb framing.
        buf = rest.length > 4 + 0xffff ? '' : rest
        const last = frames[frames.length - 1]
        if (last !== undefined) publish(parseAdbDevices(last))
      } catch {
        buf = ''
      }
    })
    child.stderr?.on('data', () => undefined)
    let exited = false
    const exit = (): void => {
      if (exited) return
      exited = true
      if (tracker === child) tracker = null
      onTrackerExit()
    }
    child.once('error', exit)
    child.once('close', exit)
  }

  const onTrackerExit = (): void => {
    if (stopped) return
    const now = Date.now()
    restarts = restarts.filter((at) => now - at < t.restartWindowMs)
    if (restarts.length < t.maxRestarts) {
      restarts.push(now)
      void getTools().then(({ adb }) => {
        if (adb && !stopped) startTracker(adb)
      })
      return
    }
    polling = true
    void pollOnce().finally(schedulePoll)
  }

  const start = (): Promise<void> =>
    (started ??= getTools().then(({ adb }) => {
      if (stopped) return
      if (!adb) return publish([])
      startTracker(adb)
    }))

  const waitFirst = (): Promise<void> =>
    gotFirst
      ? Promise.resolve()
      : new Promise((resolve) => {
          const timer = setTimeout(resolve, t.firstListMs)
          firstWaiters.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })

  const emulatorSerials = (list: RunDevice[]): Set<string> => new Set(list.filter((d) => d.emulator).map((d) => d.id))

  return {
    async list() {
      await start()
      await waitFirst()
      return devices
    },
    onChange(cb) {
      listeners.add(cb)
      void start()
      schedulePoll()
      return () => {
        listeners.delete(cb)
        if (!listeners.size && pollTimer) {
          clearTimeout(pollTimer)
          pollTimer = null
        }
      }
    },
    async emulators(): Promise<RunEmulator[]> {
      const { emulator } = await getTools()
      if (!emulator) return []
      const r = await collect(opts.spawn, emulator, ['-list-avds'], opts.home, { timeoutMs: 15_000 })
      if (r.code !== 0) return []
      return r.out
        .split(/\r?\n/)
        .map((l) => l.trim())
        // The emulator prints INFO/WARNING lines (e.g. missing ANDROID_SDK_ROOT) before the AVD names.
        .filter((l) => l && /^[\w.-]+$/.test(l))
        .map((id) => ({ id, name: id.replace(/_/g, ' '), source: 'adb' as const }))
    },
    async launchEmulator(id): Promise<RunResult> {
      const { adb, emulator } = await getTools()
      if (!adb || !emulator) return { ok: false, error: { code: 'emulator-missing' } }
      const r0 = await collect(opts.spawn, adb, ['devices', '-l'], opts.home, { timeoutMs: 10_000 })
      const before = emulatorSerials(r0.code === 0 ? parseAdbDevices(r0.out) : devices)
      let child: ChildProcess
      try {
        child = opts.spawn({ file: emulator, args: ['-avd', id], cwd: opts.home, detached: true })
      } catch {
        return { ok: false, error: { code: 'emulator-failed', detail: id } }
      }
      // Never tracked or killed: the emulator outlives the run and the app. Pipes are drained so it cannot block.
      child.stdout?.resume()
      child.stderr?.resume()
      child.unref?.()
      let exitedEarly = false
      child.once('error', () => (exitedEarly = true))
      child.once('close', () => (exitedEarly = true))

      const deadline = Date.now() + t.bootTimeoutMs
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
      let serial: string | null = null
      while (Date.now() < deadline && !stopped) {
        if (exitedEarly && !serial) return { ok: false, error: { code: 'emulator-failed', detail: id } }
        if (!serial) {
          const r = await collect(opts.spawn, adb, ['devices', '-l'], opts.home, { timeoutMs: 10_000 })
          const fresh = (r.code === 0 ? parseAdbDevices(r.out) : []).filter((d) => d.emulator && !before.has(d.id))
          for (const d of fresh) {
            const name = await collect(opts.spawn, adb, ['-s', d.id, 'emu', 'avd', 'name'], opts.home, { timeoutMs: 10_000 })
            const avd = name.out.trim().split(/\r?\n/)[0]?.trim()
            if (!avd || avd === id) {
              serial = d.id
              break
            }
          }
        }
        if (serial) {
          const boot = await collect(opts.spawn, adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], opts.home, { timeoutMs: 10_000 })
          if (boot.out.trim() === '1') return { ok: true }
        }
        await sleep(t.bootPollMs)
      }
      return { ok: false, error: { code: 'emulator-timeout', detail: id } }
    },
    stop(sync = false) {
      stopped = true
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      listeners.clear()
      if (tracker) killTree(tracker, sync)
      tracker = null
    },
  }
}
