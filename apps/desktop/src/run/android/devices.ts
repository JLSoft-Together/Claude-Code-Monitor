import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { RunDevice, RunEmulator, RunResult } from '@ccm/shared'
import { parseAdbDevices } from '../parse'
import { collect } from '../collect'
import type { Spawner } from '../proc'
import { resolveCommand } from '../resolve'
import type { DeviceService, RunSettings } from '../types'
import { createAdbWatch, type AdbWatchTiming } from './adbWatch'
import { defaultSdkDir, fsEnvDeps, type EnvDeps } from './env'

export { collect, type Collected } from '../collect'

export interface AdbDevicesOpts {
  settings: RunSettings
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  spawn: Spawner
  deps?: EnvDeps
  timing?: Partial<typeof TIMING & AdbWatchTiming>
}

const TIMING = {
  bootPollMs: 2_000,
  bootTimeoutMs: 180_000,
}

const exe = (name: string, platform: NodeJS.Platform): string => (platform === 'win32' ? `${name}.exe` : name)

export async function findAdbTools(
  opts: { androidSdk: string | null; env: NodeJS.ProcessEnv; platform: NodeJS.Platform; home: string },
  deps: EnvDeps = fsEnvDeps,
): Promise<{ adb: string | null; emulator: string | null }> {
  const p = opts.platform === 'win32' ? path.win32 : path.posix
  const sdks = [opts.androidSdk, opts.env.ANDROID_HOME, opts.env.ANDROID_SDK_ROOT, defaultSdkDir(opts.env, opts.platform, opts.home)]
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

export function createAdbDevices(opts: AdbDevicesOpts): DeviceService {
  const t = { ...TIMING, ...opts.timing }
  const deps = opts.deps ?? fsEnvDeps
  let tools: Promise<{ adb: string | null; emulator: string | null }> | null = null
  const getTools = (): Promise<{ adb: string | null; emulator: string | null }> =>
    (tools ??= findAdbTools({ ...opts, androidSdk: opts.settings.androidSdk }, deps))

  // Last parsed list: launchEmulator falls back to it when a fresh `devices -l` fails.
  let devices: RunDevice[] = []
  let stopped = false
  const watch = createAdbWatch<RunDevice>({
    spawn: opts.spawn,
    cwd: opts.home,
    adb: async () => (await getTools()).adb,
    parse: (body) => (devices = parseAdbDevices(body)),
    timing: opts.timing,
  })

  const emulatorSerials = (list: RunDevice[]): Set<string> => new Set(list.filter((d) => d.emulator).map((d) => d.id))

  return {
    list: () => watch.list(),
    onChange: (cb) => watch.onChange(cb),
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
      watch.stop(sync)
    },
  }
}
