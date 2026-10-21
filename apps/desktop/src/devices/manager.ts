import type { AdbDevice, AdbState, DevBatchResult, DevEvent, DevResult, DevSnapshot } from '@ccm/shared'
import { createAdbWatch, type AdbWatch } from '../run/android/adbWatch'
import { findAdbTools } from '../run/android/devices'
import type { EnvDeps } from '../run/android/env'
import type { Spawner } from '../run/proc'
import { createAdbCommands, type AdbCommands } from './adb'
import type { DeviceHistory, HistoryEntry } from './history'
import { addressKey, isWifiId, parseAdbDeviceRows, parseAddress, transportOf, type AdbDeviceRow } from './parse'

export interface DeviceManagerTiming {
  wifiSwitchMs: number
  batchLimit: number
  connectMs: number
  pairMs: number
  cmdMs: number
  qrPairWaitMs: number
  qrConnectWaitMs: number
  mdnsPollMs: number
}

export interface DeviceManagerDeps {
  spawn: Spawner
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  getSettings: () => { androidSdk: string | null }
  history: DeviceHistory
  broadcast: (e: DevEvent) => void
  confirmRemove: (ids: string[]) => Promise<boolean>
  timing?: Partial<DeviceManagerTiming>
  /** Test seams: replace the adb commands / the SDK file checks. */
  commands?: AdbCommands
  envDeps?: EnvDeps
}

const TIMING: DeviceManagerTiming = {
  wifiSwitchMs: 1_000,
  batchLimit: 5,
  connectMs: 15_000,
  pairMs: 20_000,
  cmdMs: 10_000,
  qrPairWaitMs: 60_000,
  qrConnectWaitMs: 30_000,
  mdnsPollMs: 1_000,
}

const WIFI_PORT = 5555
const STATE_ORDER: AdbState[] = ['ready', 'unauthorized', 'authorizing', 'no-permissions', 'recovery', 'sideload', 'bootloader', 'unknown', 'offline']
const MISSING: DevResult = { ok: false, error: 'adb-missing' }
const INVALID: DevResult = { ok: false, error: 'invalid' }

export function mergeDevices(live: AdbDeviceRow[], history: Record<string, HistoryEntry>): AdbDevice[] {
  const out: AdbDevice[] = live.map((r) => {
    const h = history[r.id]
    const alias = h?.alias ?? null
    return {
      id: r.id,
      state: r.state,
      transport: transportOf(r),
      model: r.model,
      product: r.product,
      device: r.device,
      transportId: r.transportId,
      alias,
      name: alias ?? r.model ?? r.id,
      online: true,
      lastSeen: h?.lastSeen ?? null,
    }
  })
  const liveIds = new Set(live.map((r) => r.id))
  for (const [id, h] of Object.entries(history)) {
    if (liveIds.has(id)) continue
    out.push({
      id,
      state: 'offline',
      transport: h.wifi ? 'wifi' : 'usb',
      model: h.model,
      product: null,
      device: null,
      transportId: null,
      alias: h.alias,
      name: h.alias ?? h.model ?? id,
      online: false,
      lastSeen: h.lastSeen,
    })
  }
  return out.sort((a, b) => Number(b.online) - Number(a.online) || STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.name.localeCompare(b.name))
}

export async function mapLimit<I, O>(items: I[], limit: number, fn: (i: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker))
  return out
}

export class DeviceManager {
  private readonly t: DeviceManagerTiming
  private readonly holds = new Set<string>()
  private readonly commands: AdbCommands
  private adb: string | null = null
  private watch: AdbWatch<AdbDeviceRow> | null = null
  private watchAdb: string | null = null
  private unwatch: (() => void) | null = null
  private rows: AdbDeviceRow[] = []
  private autoDone = false

  constructor(private readonly deps: DeviceManagerDeps) {
    this.t = { ...TIMING, ...deps.timing }
    this.commands =
      deps.commands ??
      createAdbCommands({
        spawn: deps.spawn,
        cwd: deps.home,
        adb: async () => this.adb,
        timing: { connectMs: this.t.connectMs, pairMs: this.t.pairMs, cmdMs: this.t.cmdMs },
      })
  }

  private async resolveAdb(): Promise<string | null> {
    const { androidSdk } = this.deps.getSettings()
    const tools = await findAdbTools({ androidSdk, env: this.deps.env, platform: this.deps.platform, home: this.deps.home }, this.deps.envDeps)
    return (this.adb = tools.adb)
  }

  private makeWatch(adb: string): AdbWatch<AdbDeviceRow> {
    return createAdbWatch({ spawn: this.deps.spawn, cwd: this.deps.home, adb: async () => adb, parse: parseAdbDeviceRows })
  }

  private emit(): void {
    this.deps.broadcast({ type: 'devices', devices: mergeDevices(this.rows, this.deps.history.all()) })
  }

  private dropWatch(sync = false): void {
    this.unwatch?.()
    this.unwatch = null
    this.watch?.stop(sync)
    this.watch = null
    this.watchAdb = null
  }

  /** Rows from the held tracker, or from a throwaway one when no view is open. */
  private async liveRows(adb: string): Promise<AdbDeviceRow[]> {
    if (this.watch && this.watchAdb === adb) return (this.rows = await this.watch.list())
    const temp = this.makeWatch(adb)
    try {
      return (this.rows = await temp.list())
    } finally {
      temp.stop()
    }
  }

  async snapshot(): Promise<DevSnapshot> {
    const { history } = this.deps
    const adb = await this.resolveAdb()
    if (!adb) {
      this.rows = []
      return { adb: null, devices: mergeDevices([], history.all()), autoConnect: history.autoConnect }
    }
    const rows = await this.liveRows(adb)
    history.seen(rows, Date.now())
    return { adb, devices: mergeDevices(rows, history.all()), autoConnect: history.autoConnect }
  }

  /** A Devices view (`owner`, e.g. "7:view") needs the live tracker; it stops with the last hold. */
  async hold(owner: string, on: boolean): Promise<void> {
    if (!on) {
      this.holds.delete(owner)
      if (!this.holds.size) this.dropWatch()
      return
    }
    this.holds.add(owner)
    const adb = await this.resolveAdb()
    if (!this.holds.size) return
    if (this.watch && this.watchAdb !== adb) this.dropWatch()
    if (!adb || this.watch) return
    const watch = this.makeWatch(adb)
    this.watch = watch
    this.watchAdb = adb
    this.unwatch = watch.onChange((rows) => {
      this.rows = rows
      this.deps.history.seen(rows, Date.now())
      this.emit()
    })
  }

  /** Window closed / reloaded: every hold whose owner key starts with `prefix` ("<senderId>:") goes. */
  releaseOwner(prefix: string): void {
    for (const o of [...this.holds]) if (o.startsWith(prefix)) this.holds.delete(o)
    if (!this.holds.size) this.dropWatch()
  }

  async connect(address: string): Promise<DevResult> {
    const a = parseAddress(address)
    if (!a) return INVALID
    if (!(await this.resolveAdb())) return MISSING
    return this.commands.connect(a.target)
  }

  async pair(address: string, code: string): Promise<DevResult> {
    const a = parseAddress(address)
    if (!a?.host || !a.port || !/^\d{6}$/.test(code)) return INVALID
    if (!(await this.resolveAdb())) return MISSING
    const r = await this.commands.pair(`${a.host}:${a.port}`, code)
    if (!r.ok) return r
    const host = addressKey(a.host, 0)
    const svc = (await this.commands.mdnsServices()).find((s) => s.kind === 'connect' && addressKey(s.host, 0) === host)
    return svc ? this.connect(`${svc.host}:${svc.port}`) : { ok: true, detail: 'paired' }
  }

  async disconnect(ids: string[]): Promise<DevBatchResult[]> {
    const adb = await this.resolveAdb()
    if (!adb) return ids.map((id) => ({ id, result: MISSING }))
    const online = new Set((await this.liveRows(adb)).map((r) => r.id))
    return mapLimit(ids, this.t.batchLimit, async (id) => ({
      id,
      result: online.has(id) && isWifiId(id) ? await this.commands.disconnect(id) : { ok: false, error: 'not-connected' },
    }))
  }

  async connectMany(ids: string[]): Promise<DevBatchResult[]> {
    return mapLimit(ids, this.t.batchLimit, async (id) => ({ id, result: await this.connect(id) }))
  }

  async toWifi(id: string): Promise<DevResult> {
    if (!(await this.resolveAdb())) return MISSING
    const ip = await this.commands.wlanIp(id)
    if (!ip) return { ok: false, error: 'no-ip' }
    const r = await this.commands.tcpip(id, WIFI_PORT)
    if (!r.ok) return r
    await new Promise((resolve) => setTimeout(resolve, this.t.wifiSwitchMs))
    return this.connect(`${ip}:${WIFI_PORT}`)
  }

  async remove(ids: string[]): Promise<DevResult> {
    const { history } = this.deps
    const adb = await this.resolveAdb()
    const online = new Set(adb ? (await this.liveRows(adb)).map((r) => r.id) : [])
    const targets = ids.filter((id) => !online.has(id) && id in history.all())
    if (!targets.length) return { ok: true }
    if (!(await this.deps.confirmRemove(targets))) return { ok: false, error: 'cancelled' }
    history.remove(targets)
    this.emit()
    return { ok: true }
  }

  setAlias(id: string, alias: string | null): DevResult {
    const cur = this.deps.history.all()[id]
    if (!cur) return INVALID
    const before = cur.alias
    this.deps.history.setAlias(id, alias)
    if (cur.alias !== before) this.emit()
    return { ok: true }
  }

  setAutoConnect(on: boolean): DevResult {
    const { history } = this.deps
    if (history.autoConnect !== on) {
      history.setAutoConnect(on)
      this.emit()
    }
    return { ok: true }
  }

  async discover(): Promise<DevBatchResult[] | DevResult> {
    const adb = await this.resolveAdb()
    if (!adb) return MISSING
    if (!(await this.commands.mdnsCheck())) return { ok: false, error: 'mdns-unavailable' }
    const online = new Set((await this.liveRows(adb)).map((r) => r.id))
    const targets = new Set<string>()
    for (const s of await this.commands.mdnsServices()) {
      if (s.kind === 'pairing') continue
      if (online.has(addressKey(s.host, s.port)) || online.has(`${s.name}._adb-tls-connect._tcp`)) continue
      targets.add(`${s.host}:${s.port}`)
    }
    return targets.size ? this.connectMany([...targets]) : { ok: false, error: 'no-devices' }
  }

  async autoConnectOnce(): Promise<void> {
    if (this.autoDone) return
    this.autoDone = true
    const { history } = this.deps
    const ids = history.wifiIds()
    if (!history.autoConnect || !ids.length) return
    await mapLimit(ids, this.t.batchLimit, (id) => this.connect(id))
  }

  stop(sync = false): void {
    this.holds.clear()
    this.dropWatch(sync)
  }
}
