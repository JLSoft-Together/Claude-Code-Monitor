import { watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ActivityKind, Agent, AgentStatus, TerminalSession, TerminalStatus } from '@ccm/shared'
import type { MonitorStore } from '../store'
import { JsonlTailer } from '../tailer'
import type { ActivityDraft } from '../tracker'
import { DeepseekThreadState, outboxPathFrom, parseOutboxLine, type StateChange, type SubagentState } from './outbox'
import { matchDeepseekProcesses, type DeepseekProcess } from './processes'

export interface DeepseekMonitorOptions {
  codewhaleHome: string
  homeDir?: string
  staleTtlMs: number
  reconcileMs: number
  verifyMs: number
  verifyProcesses: boolean
}

export interface DeepseekMonitorDeps {
  listProcesses: () => Promise<DeepseekProcess[] | null>
  isPidAlive: (pid: number) => boolean
  now: () => number
}

interface Thread {
  id: string
  state: DeepseekThreadState
  firstSeenAt: number
  proc?: { pid: number; start: number }
  /** First publish waits for one process scan so the pane link (by pid) is there from the start. */
  awaitingScan: boolean
  initial: boolean
  published: boolean
  /** Activity of a session still waiting for its first publish. */
  pending: ActivityDraft[]
}

const PREFIX = 'deepseek:'
const TAIL_BYTES = 256 * 1024
const MAX_LINE = 256 * 1024
/** A session with no process to watch is treated as gone after this long without an outbox line. */
const IDLE_END_MS = 15 * 60_000
const SCAN_DEBOUNCE_MS = 300
const SCAN_WAIT_MS = 3_000
const READ_DEBOUNCE_MS = 150

const iso = (ms: number): string => new Date(ms).toISOString()
const msOf = (s: string | undefined): number | undefined => {
  const ms = s ? Date.parse(s) : NaN
  return Number.isFinite(ms) ? ms : undefined
}

function retireWatcher(watchers: FSWatcher[], w: FSWatcher): void {
  try {
    w.close()
  } catch {
    // already closed
  }
  const i = watchers.indexOf(w)
  if (i !== -1) watchers.splice(i, 1)
}

/**
 * DeepSeek CLI (Codewhale) sessions from its lifecycle outbox (`[lifecycle_outbox] path` in config.toml), published
 * as their own sessions `deepseek:<threadId>` with spawned subagents under them. See docs/deepseek-integration.md.
 */
export class DeepseekMonitor {
  private readonly threads = new Map<string, Thread>()
  private readonly watchers: FSWatcher[] = []
  private readonly timers: NodeJS.Timeout[] = []
  private outbox: string | null = null
  private outboxWatcher: { dir: string; w: FSWatcher } | null = null
  private homeWatched = false
  private tailer: JsonlTailer | null = null
  private fileKey: string | null = null
  private everOpened = false
  private reading: Promise<void> = Promise.resolve()
  private readTimer: NodeJS.Timeout | null = null
  private scanTimer: NodeJS.Timeout | null = null
  private scanning: Promise<void> | null = null
  private scanAgain = false
  private processes: DeepseekProcess[] = []
  private lastScanOk = false
  private booting = true
  private stopped = false

  constructor(
    private readonly options: DeepseekMonitorOptions,
    private readonly store: MonitorStore,
    private readonly deps: DeepseekMonitorDeps,
  ) {}

  static isDeepseekTerminal(terminalId: string): boolean {
    return terminalId.startsWith(PREFIX)
  }

  async start(options: { watch?: boolean } = {}): Promise<void> {
    await this.resolveOutbox()
    await this.readOutbox(true)
    await this.scanNow()
    const now = this.deps.now()
    for (const t of [...this.threads.values()]) {
      const last = msOf(t.state.lastAt) ?? t.firstSeenAt
      // A live session always has its own process: unmatched after a good scan means it already exited.
      const live = !t.state.endedAt && (t.proc ? true : !this.lastScanOk && now - last < IDLE_END_MS)
      if (!live) this.threads.delete(t.id)
    }
    this.booting = false
    for (const t of this.threads.values()) this.publish(t, [])
    if (options.watch === false) return
    this.setupWatchers()
    this.timers.push(setInterval(() => void this.tick(), this.options.reconcileMs))
    this.timers.push(setInterval(() => this.liveCount() > 0 && this.scheduleScan(0), this.options.verifyMs))
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) w.close()
    this.outboxWatcher?.w.close()
    for (const t of this.timers) clearInterval(t)
    if (this.readTimer) clearTimeout(this.readTimer)
    if (this.scanTimer) clearTimeout(this.scanTimer)
  }

  diagnostics(): { outbox: string | null; threads: number; processes: number } {
    return { outbox: this.outbox, threads: this.threads.size, processes: this.processes.length }
  }

  pidOf(terminalId: string): number | undefined {
    const t = this.threadOf(terminalId)
    return t && !t.state.endedAt ? t.proc?.pid : undefined
  }

  cwdOf(terminalId: string): string | undefined {
    return this.threadOf(terminalId)?.state.workspace
  }

  dismissEnded(terminalId?: string): number {
    let removed = 0
    for (const t of [...this.threads.values()]) {
      if (!t.state.endedAt || (terminalId !== undefined && `${PREFIX}${t.id}` !== terminalId)) continue
      this.forget(t)
      removed++
    }
    return removed
  }

  /** Re-reads config.toml; the Settings sync can switch the outbox on while the app runs. */
  async resolveOutbox(): Promise<void> {
    const text = await readFile(path.join(this.options.codewhaleHome, 'config.toml'), 'utf8').catch(() => null)
    const next = outboxPathFrom(text, this.options.codewhaleHome, this.options.homeDir)
    if (next === this.outbox) return
    this.outbox = next
    this.tailer = null
    this.fileKey = null
    this.everOpened = false
    this.outboxWatcher?.w.close()
    this.outboxWatcher = null
    if (!this.booting) {
      this.setupWatchers()
      this.scheduleRead()
    }
  }

  private threadOf(terminalId: string): Thread | undefined {
    return DeepseekMonitor.isDeepseekTerminal(terminalId) ? this.threads.get(terminalId.slice(PREFIX.length)) : undefined
  }

  private liveCount(): number {
    let n = 0
    for (const t of this.threads.values()) if (!t.state.endedAt) n++
    return n
  }

  private scheduleRead(): void {
    if (this.readTimer || this.stopped) return
    this.readTimer = setTimeout(() => {
      this.readTimer = null
      void this.readOutbox(false)
    }, READ_DEBOUNCE_MS)
  }

  private readOutbox(catchUp: boolean): Promise<void> {
    this.reading = this.reading.catch(() => undefined).then(() => this.readOnce(catchUp))
    return this.reading
  }

  private async readOnce(catchUp: boolean): Promise<void> {
    const file = this.outbox
    if (!file) return
    let key: string
    try {
      const st = await stat(file)
      key = `${st.ino}:${st.birthtimeMs}`
    } catch {
      return
    }
    if (key !== this.fileKey || !this.tailer) {
      // Only the first open starts near the end; a rotated file is new, so it is read whole.
      this.tailer = new JsonlTailer(file, undefined, { fromEnd: this.everOpened ? undefined : TAIL_BYTES, maxLine: MAX_LINE })
      this.fileKey = key
      this.everOpened = true
    }
    const touched = new Map<string, ActivityDraft[]>()
    let fresh = false
    await this.tailer.readEach((record) => {
      const e = parseOutboxLine(record)
      if (!e) return
      let t = this.threads.get(e.threadId)
      if (!t) {
        // An ended session seen again (resume) comes back as a new entry; a stray end of an unknown one is ignored.
        if (e.event === 'session_end') return
        t = { id: e.threadId, state: new DeepseekThreadState(), firstSeenAt: this.deps.now(), awaitingScan: !catchUp, initial: catchUp, published: false, pending: [] }
        this.threads.set(t.id, t)
        fresh = true
      }
      const wasEnded = !!t.state.endedAt
      const changes = t.state.apply(e)
      // Resumed (`-r`) in a new process: the old pid no longer speaks for it.
      if (!catchUp && t.published && ((wasEnded && !t.state.endedAt) || e.event === 'session_start')) {
        t.proc = undefined
        t.awaitingScan = true
        fresh = true
      }
      const drafts = touched.get(t.id) ?? []
      if (!catchUp) drafts.push(...this.draftsOf(t, changes))
      touched.set(t.id, drafts)
    })
    if (catchUp) return
    for (const [id, drafts] of touched) {
      const t = this.threads.get(id)
      if (t) this.publish(t, drafts)
    }
    if (fresh) {
      this.scheduleScan(SCAN_DEBOUNCE_MS)
      setTimeout(() => {
        for (const t of this.threads.values()) {
          if (!t.awaitingScan) continue
          t.awaitingScan = false
          this.publish(t, [])
        }
      }, SCAN_WAIT_MS).unref?.()
    }
  }

  private draftsOf(t: Thread, changes: StateChange[]): ActivityDraft[] {
    const terminalId = `${PREFIX}${t.id}`
    const title = this.title(t)
    const out: ActivityDraft[] = []
    for (const c of changes) {
      if (c.k === 'turn_start') out.push({ kind: 'turn.started', terminalId, agentId: `${terminalId}:main`, at: c.at, data: { title } })
      else if (c.k === 'turn_end') {
        const kind: ActivityKind = c.outcome === 'failed' ? 'turn.failed' : c.outcome === 'interrupted' ? 'turn.interrupted' : 'turn.completed'
        out.push({ kind, terminalId, agentId: `${terminalId}:main`, at: c.at, data: { title } })
      } else if (c.k === 'sub_spawn') {
        out.push({ kind: 'agent.started', terminalId, agentId: this.subId(t, c.sub), at: c.sub.startedAt, data: { agentType: c.sub.name ?? 'subagent' } })
      } else if (c.k === 'sub_done') {
        const kind: ActivityKind = c.sub.outcome === 'error' ? 'agent.failed' : c.sub.outcome === 'cancelled' ? 'agent.cancelled' : 'agent.completed'
        out.push({ kind, terminalId, agentId: this.subId(t, c.sub), at: c.sub.completedAt, data: { agentType: c.sub.name ?? 'subagent' } })
      }
    }
    return out
  }

  private setupWatchers(): void {
    if (this.stopped) return
    if (!this.homeWatched) {
      try {
        const w = watch(this.options.codewhaleHome, (_event, file) => {
          if (String(file) === 'config.toml') void this.resolveOutbox()
        })
        w.on('error', () => {
          this.homeWatched = false
          retireWatcher(this.watchers, w)
        })
        this.watchers.push(w)
        this.homeWatched = true
      } catch {
        this.homeWatched = false
      }
    }
    const file = this.outbox
    if (!file || this.outboxWatcher) return
    const dir = path.dirname(file)
    const base = path.basename(file)
    try {
      const w = watch(dir, (_event, name) => {
        if (!name || String(name) === base) this.scheduleRead()
      })
      w.on('error', () => {
        try {
          w.close()
        } catch {
          // already closed
        }
        if (this.outboxWatcher?.w === w) this.outboxWatcher = null
      })
      this.outboxWatcher = { dir, w }
      this.scheduleRead()
    } catch {
      this.outboxWatcher = null
    }
  }

  private scheduleScan(delay: number): void {
    if (this.scanTimer || this.stopped) return
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      void this.scanNow()
    }, delay)
  }

  private scanNow(): Promise<void> {
    if (this.scanning) {
      this.scanAgain = true
      return this.scanning
    }
    this.scanning = (async () => {
      do {
        this.scanAgain = false
        try {
          await this.scanOnce()
        } catch (err) {
          console.error('[collector] deepseek process scan failed:', (err as Error).message)
        }
      } while (this.scanAgain && !this.stopped)
    })().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async scanOnce(): Promise<void> {
    if (this.threads.size === 0) return
    const procs = this.options.verifyProcesses ? await this.deps.listProcesses() : null
    this.lastScanOk = procs !== null
    if (procs !== null) {
      this.processes = procs
      const live = [...this.threads.values()].filter((t) => !t.state.endedAt)
      const matches = matchDeepseekProcesses(
        live.map((t) => ({
          id: t.id,
          workspace: t.state.workspace,
          startedAt: msOf(t.state.sessionStartAt) ?? msOf(t.state.startedAt) ?? t.firstSeenAt,
          pid: t.proc?.pid,
          start: t.proc?.start,
        })),
        procs,
      )
      const now = this.deps.now()
      for (const t of live) {
        const p = matches.get(t.id)
        if (p) t.proc = { pid: p.pid, start: p.start }
        else if (t.proc) this.end(t, now)
        else if (!this.booting && (procs.length === 0 || now - (msOf(t.state.lastAt) ?? t.firstSeenAt) > IDLE_END_MS)) this.end(t, now)
      }
    }
    for (const t of this.threads.values()) t.awaitingScan = false
    if (!this.booting) for (const t of this.threads.values()) this.publish(t, [])
  }

  private end(t: Thread, now: number): void {
    t.state.endedAt = iso(now)
    t.state.turnOpen = false
  }

  private async tick(): Promise<void> {
    if (this.stopped) return
    if (!this.homeWatched || (this.outbox && !this.outboxWatcher)) this.setupWatchers()
    const now = this.deps.now()
    for (const t of [...this.threads.values()]) {
      if (!t.state.endedAt && t.proc && !this.deps.isPidAlive(t.proc.pid)) this.end(t, now)
      if (!t.state.endedAt && !t.proc && now - (msOf(t.state.lastAt) ?? t.firstSeenAt) >= this.options.staleTtlMs) this.end(t, now)
      this.publish(t, [])
      const ended = msOf(t.state.endedAt)
      if (ended !== undefined && now - ended >= this.options.staleTtlMs) this.forget(t)
    }
  }

  private title(t: Thread): string {
    const ws = t.state.workspace
    return ws ? path.win32.basename(ws.replace(/[\\/]+$/, '')) || 'DeepSeek' : 'DeepSeek'
  }

  private subId(t: Thread, sub: SubagentState): string {
    return `${PREFIX}${t.id}:sub:${sub.id}`
  }

  private publish(t: Thread, drafts: ActivityDraft[]): void {
    if (this.booting || t.awaitingScan || !this.threads.has(t.id)) {
      t.pending.push(...drafts)
      return
    }
    const s = t.state
    const terminalId = `${PREFIX}${t.id}`
    const mainId = `${terminalId}:main`
    const title = this.title(t)
    const status: TerminalStatus = s.endedAt ? 'stale' : s.turnOpen ? 'working' : 'idle'
    const out: ActivityDraft[] = []
    if (!t.published && !t.initial && !s.endedAt) out.push({ kind: 'terminal.started', terminalId, data: { title } })
    const wasEnded = this.store.getTerminal(terminalId)?.endedAt
    if (t.published && s.endedAt && !wasEnded) out.push({ kind: 'terminal.ended', terminalId, data: { title } })
    const terminal: TerminalSession = {
      id: terminalId,
      provider: 'deepseek',
      processId: s.endedAt ? undefined : t.proc?.pid,
      title,
      cwd: s.workspace,
      deepseekSessionId: t.id,
      status,
      statusSince: status === 'working' ? s.turnStartedAt : status === 'idle' ? (s.turnEndedAt ?? s.sessionStartAt ?? s.startedAt) : undefined,
      startedAt: s.sessionStartAt ?? s.startedAt,
      lastActivityAt: s.lastAt,
      endedAt: s.endedAt,
    }
    this.store.upsertTerminal(terminal)
    const mainStatus: AgentStatus = s.endedAt ? 'completed' : s.turnOpen ? 'working' : 'idle'
    const main: Agent = {
      id: mainId,
      terminalId,
      role: 'main',
      provider: 'deepseek',
      name: title,
      status: mainStatus,
      startedAt: terminal.startedAt,
      updatedAt: s.lastAt,
      completedAt: s.endedAt,
    }
    this.store.upsertAgent(main)
    for (const sub of s.subagents.values()) {
      const subStatus: AgentStatus = sub.outcome ?? (s.endedAt ? 'unknown' : 'working')
      this.store.upsertAgent({
        id: this.subId(t, sub),
        parentId: mainId,
        terminalId,
        role: 'subagent',
        provider: 'deepseek',
        name: sub.name,
        type: sub.name ?? 'subagent',
        status: subStatus,
        startedAt: sub.startedAt,
        updatedAt: sub.completedAt ?? sub.startedAt,
        completedAt: sub.completedAt,
      })
    }
    const keep = new Set([mainId, ...[...s.subagents.keys()].map((id) => `${terminalId}:sub:${id}`)])
    for (const a of this.store.agentsOf(terminalId)) if (!keep.has(a.id)) this.store.removeAgent(a.id)
    t.published = true
    for (const d of [...out, ...t.pending.splice(0), ...drafts]) this.store.pushActivity(d)
  }

  private forget(t: Thread): void {
    if (t.published) this.store.removeTerminal(`${PREFIX}${t.id}`)
    this.threads.delete(t.id)
  }
}
