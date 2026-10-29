import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { AvdInfo, AvdList, AvdResult, AvdStartMode } from '@ccm/shared'
import { collect } from '../run/collect'
import { killAdbClient, type Spawner } from '../run/proc'
import { avdDir, avdHome, avdInfo, emulatorArgs, isEmulatorSerial, parseEmuAvdName, parseIni, parseListAvds } from './avd'
import type { AdbDeviceRow } from './parse'

export interface AvdManagerDeps {
  spawn: Spawner
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  tools: () => Promise<{ adb: string | null; emulator: string | null }>
  liveRows: () => Promise<AdbDeviceRow[] | null>
  readText: (file: string) => Promise<string | null>
  confirmWipe: (name: string) => Promise<boolean>
  timing?: Partial<{ listMs: number; cmdMs: number; startGraceMs: number }>
}

const TIMING = { listMs: 15_000, cmdMs: 5_000, startGraceMs: 3_000 }
const MISSING: AvdResult = { ok: false, error: 'emulator-missing' }

export class AvdManager {
  private readonly t: typeof TIMING
  private readonly starting = new Set<string>()

  constructor(private readonly deps: AvdManagerDeps) {
    this.t = { ...TIMING, ...deps.timing }
  }

  private async names(emulator: string): Promise<string[] | null> {
    const r = await collect(this.deps.spawn, emulator, ['-list-avds'], this.deps.home, { timeoutMs: this.t.listMs })
    return r.code === 0 ? parseListAvds(r.out) : null
  }

  /** AVD name → serial of every listed emulator whose console answers `emu avd name`. */
  async running(adb: string | null): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (!adb) return out
    const rows = ((await this.deps.liveRows()) ?? []).filter((r) => isEmulatorSerial(r.id))
    await Promise.all(
      rows.map(async (r) => {
        const res = await collect(this.deps.spawn, adb, ['-s', r.id, 'emu', 'avd', 'name'], this.deps.home, { timeoutMs: this.t.cmdMs, kill: killAdbClient })
        const name = res.code === 0 ? parseEmuAvdName(res.out) : null
        if (name) out.set(name, r.id)
      }),
    )
    return out
  }

  private async readIni(file: string): Promise<Record<string, string> | null> {
    const text = await this.deps.readText(file)
    return text === null ? null : parseIni(text)
  }

  async list(): Promise<AvdList> {
    const { adb, emulator } = await this.deps.tools()
    if (!emulator) return { ok: false, error: 'emulator-missing' }
    const names = await this.names(emulator)
    if (!names) return { ok: false, error: 'emulator-failed' }
    const running = await this.running(adb)
    const homes = avdHome(this.deps.env, this.deps.platform, this.deps.home)
    const p = this.deps.platform === 'win32' ? path.win32 : path.posix
    const avds: AvdInfo[] = await Promise.all(
      names.map(async (name) => {
        const ini = await this.readIni(p.join(homes.avd, `${name}.ini`))
        const config = await this.readIni(p.join(avdDir(name, ini, homes, this.deps.platform), 'config.ini'))
        return avdInfo(name, ini, config, running.get(name) ?? null)
      }),
    )
    return { ok: true, avds: avds.sort((a, b) => a.displayName.localeCompare(b.displayName)) }
  }

  /** Returns once the emulator survived the grace period; it then shows up through the held adb tracker. */
  async start(name: string, mode: AvdStartMode): Promise<AvdResult> {
    const { adb, emulator } = await this.deps.tools()
    if (!emulator) return MISSING
    const names = await this.names(emulator)
    if (!names?.includes(name)) return { ok: false, error: 'invalid' }
    if (this.starting.has(name) || (await this.running(adb)).has(name)) return { ok: false, error: 'avd-running' }
    if (mode === 'wipe' && !(await this.deps.confirmWipe(name))) return { ok: false, error: 'cancelled' }
    this.starting.add(name)
    try {
      let child: ChildProcess
      try {
        child = this.deps.spawn({ file: emulator, args: emulatorArgs(name, mode), cwd: this.deps.home, detached: true })
      } catch {
        return { ok: false, error: 'emulator-failed' }
      }
      const exited = await new Promise<number | null | false>((resolve) => {
        const timer = setTimeout(() => resolve(false), this.t.startGraceMs)
        child.once('error', () => (clearTimeout(timer), resolve(null)))
        child.once('exit', (code: number | null) => (clearTimeout(timer), resolve(code)))
      })
      return exited === false ? { ok: true } : { ok: false, error: 'emulator-failed', detail: exited === null ? undefined : `exit ${exited}` }
    } finally {
      this.starting.delete(name)
    }
  }

  async stop(name: string): Promise<AvdResult> {
    const { adb } = await this.deps.tools()
    if (!adb) return { ok: false, error: 'adb-missing' }
    const serial = (await this.running(adb)).get(name)
    if (!serial) return { ok: false, error: 'avd-not-running' }
    const r = await collect(this.deps.spawn, adb, ['-s', serial, 'emu', 'kill'], this.deps.home, { timeoutMs: this.t.cmdMs, kill: killAdbClient })
    if (r.timedOut) return { ok: false, error: 'timeout' }
    return r.code === 0 ? { ok: true } : { ok: false, error: 'emulator-failed', detail: r.out.trim().slice(0, 300) || undefined }
  }
}
