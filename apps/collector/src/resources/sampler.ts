import os from 'node:os'
import {
  RES_CMD_MAX,
  RES_CONFLICT_MS,
  RES_OUTSIDE_MAX,
  RES_SAMPLE_MS,
  maskSecrets,
  type Agent,
  type BackgroundJob,
  type DaemonInfo,
  type DeviceUsedMessage,
  type OutsidePort,
  type PortConflict,
  type ResPort,
  type ResourceReport,
  type ServerRes,
  type SessionRes,
  type TerminalSession,
} from '@ccm/shared'
import { emulatorIdleSince, idleSinceOf, isForgotten, serverBusy, sessionIdleSince, trackBusy, type BusyState } from './idle'
import { procKey, type ProcReader, type ProcRow } from './procs'
import { buildTree, cpuPercent, mayBeDaemon, sumOf } from './tree'

export interface SamplerDeps {
  reader: ProcReader | null
  /** R2 port table (machine-wide LISTEN sockets by pid); without it servers are judged on CPU only. */
  ports?: () => Promise<Map<number, ResPort[]> | null>
  terminals: () => Iterable<TerminalSession>
  agents: () => Iterable<Agent>
  jobs: () => readonly BackgroundJob[]
  idleMinutes: () => number
  /** Newest session tool call mentioning adb / flutter run / installDebug (epoch ms). */
  lastDeviceCallAt: () => number | null
  /** Newest "port already in use" tool failure per session (R2). */
  conflicts?: () => { sessionId: string; port: number; at: number }[]
  onReport: (report: ResourceReport) => void
  now?: () => number
  cores?: number
  mask?: (cmd: string) => string
  intervalMs?: number
}

const LINEAGE_MAX = 20_000

export function outsidePorts(ports: ReadonlyMap<number, ResPort[]>, owner: ReadonlyMap<number, string | null>, nameOf: ReadonlyMap<number, string>): OutsidePort[] {
  const out: OutsidePort[] = []
  for (const [pid, list] of ports) {
    if (owner.has(pid) || !list.length) continue
    out.push({ pid, name: nameOf.get(pid) ?? '', ports: list })
  }
  return out.sort((a, b) => a.ports[0]!.port - b.ports[0]!.port).slice(0, RES_OUTSIDE_MAX)
}

export function portConflicts(
  calls: readonly { sessionId: string; port: number; at: number }[],
  now: number,
  ports: ReadonlyMap<number, ResPort[]>,
  owner: ReadonlyMap<number, string | null>,
  nameOf: ReadonlyMap<number, string>,
): PortConflict[] {
  const holders = new Map<number, number>()
  for (const [pid, list] of ports) for (const p of list) if (!holders.has(p.port)) holders.set(p.port, pid)
  return calls
    .filter((c) => now - c.at <= RES_CONFLICT_MS && c.at <= now + 60_000)
    .map((c) => {
      const pid = holders.get(c.port)
      const holder = pid === undefined ? null : { pid, name: nameOf.get(pid) ?? '', sessionId: owner.get(pid) ?? null }
      return { port: c.port, sessionId: c.sessionId, at: c.at, holder }
    })
    .sort((a, b) => b.at - a.at)
}

export class ResourceSampler {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly prevCpu = new Map<string, { cpuMs: number; at: number }>()
  private readonly lineageMap = new Map<string, string>()
  private readonly busy = new Map<string, BusyState>()
  private readonly deviceUse = new Map<string, number>()
  private lastReport: ResourceReport | null = null
  private readonly now: () => number
  private readonly cores: number
  private readonly mask: (cmd: string) => string

  constructor(private readonly deps: SamplerDeps) {
    this.now = deps.now ?? Date.now
    this.cores = deps.cores ?? Math.max(1, os.availableParallelism?.() ?? os.cpus().length)
    const home = os.homedir()
    this.mask = deps.mask ?? ((cmd) => maskSecrets(cmd, home, process.platform))
  }

  get report(): ResourceReport | null {
    return this.lastReport
  }

  get lineage(): ReadonlyMap<string, string> {
    return this.lineageMap
  }

  get active(): boolean {
    return this.timer !== null
  }

  setActive(on: boolean): void {
    if (on === this.active || !this.deps.reader) return
    if (!on) {
      clearInterval(this.timer!)
      this.timer = null
      return
    }
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? RES_SAMPLE_MS)
    this.timer.unref()
    void this.tick()
  }

  stop(): void {
    this.setActive(false)
  }

  deviceUsed(msg: DeviceUsedMessage): void {
    this.deviceUse.set(`serial:${msg.serial}`, msg.at)
    if (msg.avd) this.deviceUse.set(`avd:${msg.avd}`, msg.at)
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const report = await this.sample()
      if (report) this.deps.onReport(report)
    } catch (err) {
      console.error('[collector] resources:', err instanceof Error ? err.message : err)
    } finally {
      this.running = false
    }
  }

  async sample(): Promise<ResourceReport | null> {
    const reader = this.deps.reader
    const rows = reader ? await reader.read() : null
    if (!reader || !rows) return null
    const now = this.now()
    const terms = [...this.deps.terminals()].filter((t) => !t.endedAt && t.processId)
    reader.enrich(rows, new Set(), new Set(rows.filter((r) => mayBeDaemon(r.name)).map((r) => r.pid)))
    const ports = this.deps.ports ? await this.deps.ports().catch(() => null) : null
    const tree = buildTree({ rows, sessions: terms.map((t) => ({ sessionId: t.id, pid: t.processId! })), lineage: this.lineageMap, ports: ports ?? undefined })

    const usagePids = new Set<number>()
    for (const s of tree.sessions) for (const m of s.members) usagePids.add(m.pid)
    for (const e of tree.servers) for (const m of e.members) usagePids.add(m.pid)
    reader.enrich(rows, usagePids, new Set(tree.servers.map((e) => e.main.pid)))

    const liveKeys = new Set<string>()
    for (const r of rows) {
      const key = procKey(r)
      if (key) liveKeys.add(key)
    }
    for (const [key, sessionId] of tree.seen) if (this.lineageMap.size < LINEAGE_MAX || this.lineageMap.has(key)) this.lineageMap.set(key, sessionId)
    for (const key of this.lineageMap.keys()) if (!liveKeys.has(key)) this.lineageMap.delete(key)

    const cpu = new Map<number, number | null>()
    const sampled = new Set<string>()
    for (const r of rows) {
      if (!usagePids.has(r.pid)) continue
      const key = procKey(r)
      if (!key || r.cpuMs === null) {
        cpu.set(r.pid, null)
        continue
      }
      cpu.set(r.pid, cpuPercent(this.prevCpu.get(key), r.cpuMs, now, this.cores))
      this.prevCpu.set(key, { cpuMs: r.cpuMs, at: now })
      sampled.add(key)
    }
    for (const key of this.prevCpu.keys()) if (!sampled.has(key)) this.prevCpu.delete(key)
    const cpuOf = (r: ProcRow) => cpu.get(r.pid) ?? null
    const ramOf = (r: ProcRow) => r.ramBytes

    const idleMinutes = this.deps.idleMinutes()
    const termById = new Map(terms.map((t) => [t.id, t]))
    const agents = [...this.deps.agents()]
    const jobs = this.deps.jobs()
    const sessions: SessionRes[] = tree.sessions.map((s) => {
      const idleSince = sessionIdleSince(termById.get(s.sessionId)!, agents, jobs)
      return {
        sessionId: s.sessionId,
        pid: s.root.pid,
        start: s.root.start ?? '',
        name: s.root.name,
        ramBytes: sumOf(s.members, ramOf),
        cpuPct: sumOf(s.members, cpuOf),
        idleSinceMs: idleSince,
        forgotten: isForgotten(idleSince, now, idleMinutes),
      }
    })

    const lastCall = this.deps.lastDeviceCallAt()
    const busyKeys = new Set<string>()
    const servers: ServerRes[] = tree.servers.map((e) => {
      const key = procKey(e.root) ?? `pid:${e.root.pid}`
      busyKeys.add(key)
      const cpuPct = sumOf(e.members, cpuOf)
      let idleSince: number | null
      let lastBusyAt: number | null
      if (e.kind === 'emulator') {
        const state = this.busy.get(key) ?? { firstSeen: now, lastBusy: null }
        this.busy.set(key, state)
        const lastUse = this.lastUseOf(e.daemon)
        idleSince = emulatorIdleSince(state.firstSeen, lastUse, lastCall)
        lastBusyAt = Math.max(lastUse ?? 0, lastCall ?? 0) || null
      } else {
        const state = trackBusy(this.busy.get(key), serverBusy(cpuPct, e.ports), now)
        this.busy.set(key, state)
        idleSince = idleSinceOf(state, now)
        lastBusyAt = state.lastBusy
      }
      const cmd = e.main.cmd ? this.mask(e.main.cmd).slice(0, RES_CMD_MAX) : ''
      return {
        pid: e.root.pid,
        start: e.root.start ?? '',
        kind: e.kind,
        name: e.main.name,
        cmd,
        ports: e.ports,
        ramBytes: sumOf(e.members, ramOf),
        cpuPct,
        idleSinceMs: idleSince,
        lastBusyAt,
        forgotten: e.orphan || isForgotten(idleSince, now, idleMinutes),
        sessionId: e.sessionId,
        orphan: e.orphan,
        ...(e.daemon ? { daemon: e.daemon } : {}),
      }
    })
    for (const key of this.busy.keys()) if (!busyKeys.has(key)) this.busy.delete(key)
    servers.sort((a, b) => (b.ramBytes ?? 0) - (a.ramBytes ?? 0))

    const all = new Map<number, ProcRow>()
    const forgottenPids = new Set<number>()
    tree.sessions.forEach((s, i) => {
      for (const m of s.members) {
        all.set(m.pid, m)
        if (sessions[i]!.forgotten) forgottenPids.add(m.pid)
      }
    })
    for (const e of tree.servers) {
      const forgotten = servers.find((s) => s.pid === e.root.pid)?.forgotten
      for (const m of e.members) {
        all.set(m.pid, m)
        if (forgotten) forgottenPids.add(m.pid)
      }
    }
    let ramBytes = 0
    let cpuPct = 0
    let forgottenRamBytes = 0
    for (const [pid, r] of all) {
      ramBytes += r.ramBytes ?? 0
      cpuPct += cpu.get(pid) ?? 0
      if (forgottenPids.has(pid)) forgottenRamBytes += r.ramBytes ?? 0
    }
    const report: ResourceReport = {
      at: new Date(now).toISOString(),
      idleMinutes,
      cores: this.cores,
      sessions,
      servers,
      totals: {
        ramBytes,
        cpuPct: Math.round(cpuPct * 10) / 10,
        forgotten: sessions.filter((s) => s.forgotten).length + servers.filter((s) => s.forgotten).length,
        forgottenRamBytes,
      },
    }
    if (ports) {
      const owner = new Map<number, string | null>()
      tree.sessions.forEach((s) => s.members.forEach((m) => owner.set(m.pid, s.sessionId)))
      for (const e of tree.servers) for (const m of e.members) owner.set(m.pid, e.sessionId)
      const nameOf = new Map(rows.map((r) => [r.pid, r.name]))
      report.outside = outsidePorts(ports, owner, nameOf)
      report.conflicts = portConflicts(this.deps.conflicts?.() ?? [], now, ports, owner, nameOf)
    }
    this.lastReport = report
    return report
  }

  private lastUseOf(daemon: DaemonInfo | undefined): number | null {
    const a = daemon?.avd ? this.deviceUse.get(`avd:${daemon.avd}`) : undefined
    const s = daemon?.serial ? this.deviceUse.get(`serial:${daemon.serial}`) : undefined
    return Math.max(a ?? 0, s ?? 0) || null
  }
}
