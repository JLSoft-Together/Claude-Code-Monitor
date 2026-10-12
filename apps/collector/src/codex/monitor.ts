import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { Agent, AgentStatus, PlanLimits, TerminalSession, TerminalStatus } from '@ccm/shared'
import type { LimitHistory } from '../forecast'
import type { MonitorStore } from '../store'
import type { ActivityDraft } from '../tracker'
import { callerOf, claudeTargetFor, matchProcesses, type ClaudeTarget } from './link'
import type { CodexProcess } from './processes'
import { readSessionMeta, RolloutTailer } from './reader'
import { CodexThreadState, extractCodexSignals, modeOf, type CodexLimits, type CodexMeta, type CodexMode } from './rollout'

export interface CodexMonitorOptions {
  codexHome: string
  staleTtlMs: number
  reconcileMs: number
  verifyMs: number
  verifyProcesses: boolean
}

export interface CodexMonitorDeps {
  listProcesses: () => Promise<CodexProcess[] | null>
  isPidAlive: (pid: number) => boolean
  now: () => number
}

interface Thread {
  id: string
  file: string
  meta: CodexMeta
  mode: CodexMode
  state: CodexThreadState
  tailer: RolloutTailer
  proc?: { pid: number; start: number }
  procGone: boolean
  superseded: boolean
  link?: { terminalId: string; parentId: string }
  /** First publish waits for one process scan so a Claude-launched run never flashes up as its own session. */
  awaitingScan: boolean
  /** Found at collector start: shown without "started" activity. */
  initial: boolean
  chain: Promise<void>
  lastWriteAt: number
  endedAt?: string
  finishedAt?: number
  published?: { terminalId: string; agentId: string; standalone: boolean }
  lastStatus?: AgentStatus
}

const FILE_RE = /rollout-[^\\/]*?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
const TAIL_BYTES = 8 * 1024 * 1024
const LIMITS_TAIL_BYTES = 2 * 1024 * 1024
/** A thread with no process to watch is treated as gone after this long without a rollout write. */
const IDLE_END_MS = 15 * 60_000
const SCAN_DEBOUNCE_MS = 300
const SCAN_WAIT_MS = 3_000
const SYNC_DEBOUNCE_MS = 150
const MAX_FINISHED_PER_TERMINAL = 20
const MAX_INDEX_BYTES = 4 * 1024 * 1024

const iso = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString())
const round1 = (n: number): number => Math.round(n * 10) / 10
const finished = (s: AgentStatus): boolean => s === 'completed' || s === 'error' || s === 'cancelled'

function dayDir(sessionsDir: string, ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return path.join(sessionsDir, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
}

export function parseThreadNames(text: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as { id?: unknown; thread_name?: unknown }
      if (typeof r.id === 'string' && typeof r.thread_name === 'string' && r.thread_name.trim()) {
        names.set(r.id, r.thread_name.trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120))
      }
    } catch {
      continue
    }
  }
  return names
}

/**
 * Codex CLI threads from `<codexHome>/sessions` rollouts. Runs launched from a Claude Code session become agents in
 * that session's tree; other runs become their own sessions (`codex:<threadId>`). See docs/codex-integration.md.
 */
export class CodexMonitor {
  private readonly threads = new Map<string, Thread>()
  private readonly adding = new Map<string, Promise<Thread | null>>()
  private readonly skipped = new Set<string>()
  private readonly resumeSearched = new Set<string>()
  private readonly sessionsDir: string
  private readonly indexFile: string
  private names = new Map<string, string>()
  private readonly watchers: FSWatcher[] = []
  private readonly timers: NodeJS.Timeout[] = []
  private readonly syncTimers = new Map<string, NodeJS.Timeout>()
  private scanTimer: NodeJS.Timeout | null = null
  private scanning: Promise<void> | null = null
  private scanAgain = false
  private sessionsWatched = false
  private homeWatched = false
  private processes: CodexProcess[] = []
  private lastScanOk = false
  private limits?: CodexLimits
  private booting = true
  private stopped = false

  constructor(
    private readonly options: CodexMonitorOptions,
    private readonly store: MonitorStore,
    private readonly targets: () => ClaudeTarget[],
    private readonly deps: CodexMonitorDeps,
    private readonly limitHistory: LimitHistory | null = null,
  ) {
    this.sessionsDir = path.join(options.codexHome, 'sessions')
    this.indexFile = path.join(options.codexHome, 'session_index.jsonl')
  }

  static isCodexTerminal(terminalId: string): boolean {
    return terminalId.startsWith('codex:')
  }

  async start(options: { watch?: boolean } = {}): Promise<void> {
    await this.loadNames()
    await this.discoverInitial()
    if (options.watch === false) return
    this.setupWatchers()
    this.timers.push(setInterval(() => void this.tick(), this.options.reconcileMs))
    this.timers.push(setInterval(() => this.liveCount() > 0 && this.scheduleScan(0), this.options.verifyMs))
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) w.close()
    for (const t of this.timers) clearInterval(t)
    for (const t of this.syncTimers.values()) clearTimeout(t)
    if (this.scanTimer) clearTimeout(this.scanTimer)
  }

  diagnostics(): { home: string; watching: boolean; threads: number; processes: number } {
    return { home: this.options.codexHome, watching: this.sessionsWatched, threads: this.threads.size, processes: this.processes.length }
  }

  pidOf(terminalId: string): number | undefined {
    const t = this.standaloneThread(terminalId)
    return t && !t.endedAt && !t.procGone ? t.proc?.pid : undefined
  }

  cwdOf(terminalId: string): string | undefined {
    return this.standaloneThread(terminalId)?.meta.cwd
  }

  isLive(terminalId: string): boolean {
    const t = this.standaloneThread(terminalId)
    return !!t && !t.endedAt
  }

  dismissEnded(terminalId?: string): number {
    let removed = 0
    for (const t of [...this.threads.values()]) {
      if (!t.published?.standalone || !t.endedAt) continue
      if (terminalId !== undefined && t.published.terminalId !== terminalId) continue
      this.forget(t)
      removed++
    }
    return removed
  }

  private standaloneThread(terminalId: string): Thread | undefined {
    if (!CodexMonitor.isCodexTerminal(terminalId)) return undefined
    const t = this.threads.get(terminalId.slice('codex:'.length))
    return t?.published?.standalone ? t : undefined
  }

  private liveCount(): number {
    let n = 0
    for (const t of this.threads.values()) if (!t.endedAt && t.finishedAt === undefined) n++
    return n
  }

  private async loadNames(): Promise<void> {
    try {
      const st = await stat(this.indexFile)
      const text = await readFile(this.indexFile, 'utf8')
      this.names = parseThreadNames(st.size > MAX_INDEX_BYTES ? text.slice(-MAX_INDEX_BYTES) : text)
    } catch {
      this.names = new Map()
    }
  }

  private async listRecentFiles(now: number): Promise<{ file: string; mtime: number }[]> {
    const out: { file: string; mtime: number }[] = []
    for (const dir of new Set([dayDir(this.sessionsDir, now), dayDir(this.sessionsDir, now - 86_400_000)])) {
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!FILE_RE.test(name)) continue
        const file = path.join(dir, name)
        try {
          out.push({ file, mtime: (await stat(file)).mtimeMs })
        } catch {
          continue
        }
      }
    }
    return out
  }

  /** Startup: only threads that are still running are shown; finished runs from before the collector are history. */
  private async discoverInitial(): Promise<void> {
    const now = this.deps.now()
    const files = await this.listRecentFiles(now)
    for (const { file, mtime } of files) {
      if (now - mtime > this.options.staleTtlMs) continue
      await this.addThread(file, true, mtime)
    }
    await this.scanNow()
    for (const t of [...this.threads.values()]) {
      // exec / TUI always run in a process of their own: unmatched after a good scan means it already exited.
      const ownProcess = this.lastScanOk && (t.mode === 'exec' || t.mode === 'tui')
      const live = t.proc ? !t.procGone && !t.superseded : !ownProcess && t.state.turnOpen === true && now - t.lastWriteAt < IDLE_END_MS
      if (!live) this.threads.delete(t.id)
    }
    await this.seedLimits(files)
    this.booting = false
    for (const t of this.threads.values()) this.publish(t, [])
  }

  private async seedLimits(files: { file: string; mtime: number }[]): Promise<void> {
    if (this.limits) return
    const newest = files.reduce<{ file: string; mtime: number } | undefined>((a, b) => (!a || b.mtime > a.mtime ? b : a), undefined)
    if (!newest) return
    const state = new CodexThreadState()
    for (const rec of await new RolloutTailer(newest.file, LIMITS_TAIL_BYTES).read()) state.apply(extractCodexSignals(rec))
    if (state.limits) this.applyLimits(state.limits)
  }

  private addThread(file: string, initial: boolean, mtime?: number): Promise<Thread | null> {
    const id = FILE_RE.exec(file)?.[1]
    if (!id || this.threads.has(id) || this.skipped.has(id)) return Promise.resolve(this.threads.get(id ?? '') ?? null)
    let pending = this.adding.get(id)
    if (!pending) {
      pending = this.createThread(id, file, initial, mtime).finally(() => this.adding.delete(id))
      this.adding.set(id, pending)
    }
    return pending
  }

  private async createThread(id: string, file: string, initial: boolean, mtime?: number): Promise<Thread | null> {
    const meta = await readSessionMeta(file)
    const mode = meta ? modeOf(meta) : null
    if (!meta || !mode || meta.id !== id) {
      // A file without its meta line yet is retried on the next write; a Desktop/IDE thread never is.
      if (meta) this.skipped.add(id)
      return null
    }
    const thread: Thread = {
      id,
      file,
      meta,
      mode,
      state: new CodexThreadState(),
      tailer: new RolloutTailer(file, TAIL_BYTES),
      procGone: false,
      superseded: false,
      awaitingScan: !initial,
      initial,
      chain: Promise.resolve(),
      lastWriteAt: mtime ?? this.deps.now(),
    }
    thread.state.meta = meta
    thread.chain = this.read(thread, true).then(() => undefined)
    this.threads.set(id, thread)
    await thread.chain
    return thread
  }

  private async read(t: Thread, catchUp: boolean): Promise<{ drafts: ActivityDraft[]; turnStarted: boolean }> {
    const drafts: ActivityDraft[] = []
    let turnStarted = false
    const records = await t.tailer.read()
    if (records.length === 0) return { drafts, turnStarted }
    if (!catchUp) t.lastWriteAt = this.deps.now()
    for (const rec of records) {
      const signals = extractCodexSignals(rec)
      for (const s of signals) {
        if (s.k === 'turn_start') turnStarted = true
        if (s.k === 'tool_call' && !catchUp && t.published) {
          drafts.push({ kind: 'tool.started', terminalId: t.published.terminalId, agentId: t.published.agentId, at: s.at, data: { tool: s.name } })
        }
      }
      t.state.apply(signals)
    }
    if (t.state.limits) this.applyLimits(t.state.limits)
    return { drafts, turnStarted }
  }

  private applyLimits(limits: CodexLimits): void {
    if (this.limits && limits.at <= this.limits.at) return
    this.limits = limits
    const plan: PlanLimits = { fiveHour: limits.fiveHour, sevenDay: limits.sevenDay, updatedAt: limits.at, plan: limits.plan }
    const out = this.limitHistory ? this.limitHistory.apply(plan) : plan
    if (out) this.store.setCodexLimits(out)
  }

  private setupWatchers(): void {
    if (this.stopped) return
    if (!this.sessionsWatched) {
      try {
        const w = watch(this.sessionsDir, { recursive: true }, (_event, file) => {
          if (file) this.onRolloutChange(path.join(this.sessionsDir, String(file)))
        })
        w.on('error', () => {
          this.sessionsWatched = false
        })
        this.watchers.push(w)
        this.sessionsWatched = true
      } catch {
        this.sessionsWatched = false
      }
    }
    if (!this.homeWatched) {
      try {
        const w = watch(this.options.codexHome, (_event, file) => {
          if (String(file) === 'session_index.jsonl') void this.reloadNames()
        })
        w.on('error', () => {
          this.homeWatched = false
        })
        this.watchers.push(w)
        this.homeWatched = true
      } catch {
        this.homeWatched = false
      }
    }
  }

  private async reloadNames(): Promise<void> {
    await this.loadNames()
    for (const t of this.threads.values()) this.publish(t, [])
  }

  private onRolloutChange(file: string): void {
    const id = FILE_RE.exec(file)?.[1]
    if (!id || this.skipped.has(id) || this.syncTimers.has(id) || this.stopped) return
    this.syncTimers.set(
      id,
      setTimeout(() => {
        this.syncTimers.delete(id)
        void this.sync(id, file)
      }, SYNC_DEBOUNCE_MS),
    )
  }

  private async sync(id: string, file: string): Promise<void> {
    try {
      const known = this.threads.get(id)
      if (!known) {
        const t = await this.addThread(file, false)
        if (!t?.awaitingScan) return
        t.lastWriteAt = this.deps.now()
        this.scheduleScan(SCAN_DEBOUNCE_MS)
        setTimeout(() => {
          if (!t.awaitingScan) return
          t.awaitingScan = false
          this.publish(t, [])
        }, SCAN_WAIT_MS).unref?.()
        return
      }
      const t = known
      t.chain = t.chain
        .catch(() => undefined)
        .then(async () => {
          const { drafts, turnStarted } = await this.read(t, false)
          // A new turn on a thread whose process ended means it was resumed by another process.
          if (turnStarted && (t.endedAt || t.procGone || t.superseded)) this.reopen(t)
          this.publish(t, drafts)
        })
      await t.chain
    } catch (err) {
      console.error('[collector] codex sync failed:', (err as Error).message)
    }
  }

  private reopen(t: Thread): void {
    t.endedAt = undefined
    t.finishedAt = undefined
    t.procGone = false
    t.superseded = false
    t.proc = undefined
    this.scheduleScan(SCAN_DEBOUNCE_MS)
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
          console.error('[collector] codex process scan failed:', (err as Error).message)
        }
      } while (this.scanAgain && !this.stopped)
    })().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async scanOnce(): Promise<void> {
    const procs = this.options.verifyProcesses ? await this.deps.listProcesses() : null
    this.lastScanOk = procs !== null
    const pending = [...this.threads.values()].filter((t) => t.awaitingScan)
    if (procs === null) {
      const targets = this.targets()
      for (const t of pending) {
        t.awaitingScan = false
        this.link(t, undefined, targets)
        this.publish(t, [])
      }
      return
    }
    this.processes = procs
    await this.findResumed(procs)
    // A thread whose process is gone only gets one back by being resumed (see reopen).
    const live = [...this.threads.values()].filter((t) => !t.endedAt && !t.procGone && !t.superseded)
    const matches = matchProcesses(
      live.map((t) => ({ id: t.id, createdAt: t.meta.createdAt, mode: t.mode, parentThreadId: t.meta.parentThreadId, pid: t.proc?.pid, start: t.proc?.start })),
      procs,
    )
    const owners = new Map<number, Thread[]>()
    const targets = this.targets()
    for (const t of live) {
      const p = matches.get(t.id)
      if (p) {
        t.proc = { pid: p.pid, start: p.start }
        t.procGone = false
        if (t.mode === 'tui' || t.mode === 'exec') owners.set(p.pid, [...(owners.get(p.pid) ?? []), t])
      } else if (t.proc) {
        t.procGone = true
      }
      this.link(t, p, targets)
    }
    for (const group of owners.values()) {
      if (group.length < 2) continue
      group.sort((a, b) => b.meta.createdAt - a.meta.createdAt)
      for (const old of group.slice(1)) old.superseded = true
    }
    for (const t of pending) t.awaitingScan = false
    for (const t of this.threads.values()) this.publish(t, [])
  }

  // A run first shown on its own (slow scan) still moves into its Claude session once the link is found.
  private link(t: Thread, proc: CodexProcess | undefined, targets: ClaudeTarget[]): void {
    if (t.link || t.mode === 'subagent' || t.published?.standalone === false) return
    const target = claudeTargetFor(proc, { mode: t.mode, cwd: t.meta.cwd, createdAt: t.meta.createdAt }, targets)
    if (target) t.link = { terminalId: target.terminalId, parentId: callerOf(target, t.meta.createdAt) }
  }

  /** `codex resume <id>` of an old thread appends to a rollout outside the recent day folders. */
  private async findResumed(procs: CodexProcess[]): Promise<void> {
    for (const p of procs) {
      const id = p.resumeId
      if (!id || this.threads.has(id) || this.skipped.has(id) || this.resumeSearched.has(id)) continue
      this.resumeSearched.add(id)
      const file = await this.findRollout(id)
      if (file) await this.addThread(file, true, this.deps.now())
    }
  }

  private async findRollout(id: string): Promise<string | null> {
    const suffix = `-${id}.jsonl`
    const list = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort().reverse()
    for (const year of await list(this.sessionsDir)) {
      for (const month of await list(path.join(this.sessionsDir, year))) {
        for (const day of await list(path.join(this.sessionsDir, year, month))) {
          const dir = path.join(this.sessionsDir, year, month, day)
          const hit = (await list(dir)).find((n) => n.endsWith(suffix))
          if (hit) return path.join(dir, hit)
        }
      }
    }
    return null
  }

  private async tick(): Promise<void> {
    if (this.stopped) return
    if (!this.sessionsWatched || !this.homeWatched) this.setupWatchers()
    const now = this.deps.now()
    for (const t of [...this.threads.values()]) {
      if (t.proc && !t.procGone && !this.deps.isPidAlive(t.proc.pid)) t.procGone = true
      this.publish(t, [])
      if (t.endedAt && now - Date.parse(t.endedAt) >= this.options.staleTtlMs) this.forget(t)
      else if (t.finishedAt !== undefined && now - t.finishedAt >= this.options.staleTtlMs) this.forget(t)
    }
    this.pruneFinished()
  }

  private pruneFinished(): void {
    const byTerminal = new Map<string, Thread[]>()
    for (const t of this.threads.values()) {
      if (!t.link || t.finishedAt === undefined) continue
      byTerminal.set(t.link.terminalId, [...(byTerminal.get(t.link.terminalId) ?? []), t])
    }
    for (const list of byTerminal.values()) {
      if (list.length <= MAX_FINISHED_PER_TERMINAL) continue
      list.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
      for (const t of list.slice(MAX_FINISHED_PER_TERMINAL)) this.forget(t)
    }
  }

  private gone(t: Thread): boolean {
    if (t.superseded || t.procGone) return true
    if (t.proc) return false
    if (t.mode === 'exec' && t.state.turnOpen === false) return true
    return this.deps.now() - t.lastWriteAt > IDLE_END_MS
  }

  private childStatus(t: Thread): AgentStatus {
    const s = t.state
    if (s.turnOpen) return this.gone(t) ? (t.procGone ? 'cancelled' : 'unknown') : 'working'
    if (s.aborted) return 'cancelled'
    if (s.turnEndedAt) return 'completed'
    return this.gone(t) ? 'unknown' : 'idle'
  }

  private terminalStatus(t: Thread): TerminalStatus {
    if (this.gone(t)) return 'stale'
    return t.state.turnOpen ? 'working' : 'idle'
  }

  private title(t: Thread): string {
    return this.names.get(t.id) ?? (t.meta.cwd ? path.basename(t.meta.cwd.replace(/[\\/]+$/, '')) : 'Codex')
  }

  /** Where a thread shows up: inside a Claude session, under its Codex parent, or as its own session. */
  private placement(t: Thread): { terminalId: string; agentId: string; parentId?: string; standalone: boolean } {
    if (t.link) return { terminalId: t.link.terminalId, agentId: `codex:${t.id}`, parentId: t.link.parentId, standalone: false }
    const parent = t.meta.parentThreadId ? this.threads.get(t.meta.parentThreadId) : undefined
    if (parent && parent !== t && t.mode === 'subagent') {
      const p = this.placement(parent)
      return { terminalId: p.terminalId, agentId: `codex:${t.id}`, parentId: p.agentId, standalone: false }
    }
    return { terminalId: `codex:${t.id}`, agentId: `codex:${t.id}:main`, standalone: true }
  }

  private publish(t: Thread, drafts: ActivityDraft[]): void {
    if (this.booting || t.awaitingScan || !this.threads.has(t.id)) return
    const place = this.placement(t)
    if (!place.standalone && !this.store.getTerminal(place.terminalId)) {
      if (t.link) return this.forget(t)
      return
    }
    const prev = t.published
    if (prev && (prev.terminalId !== place.terminalId || prev.agentId !== place.agentId)) this.unpublish(t)
    const fresh = !t.published
    const now = this.deps.now()
    const title = this.title(t)

    let status: AgentStatus
    if (place.standalone) {
      const terminalStatus = this.terminalStatus(t)
      if (terminalStatus === 'stale' && !t.endedAt) {
        t.endedAt = new Date(now).toISOString()
        if (prev) drafts.push({ kind: 'terminal.ended', terminalId: place.terminalId, data: { title } })
      }
      status = terminalStatus === 'stale' ? (!t.state.turnOpen ? 'completed' : t.procGone ? 'cancelled' : 'unknown') : terminalStatus
      this.store.upsertTerminal(this.terminalOf(t, place.terminalId, terminalStatus, title))
      if (fresh && !t.initial && !t.endedAt) drafts.push({ kind: 'terminal.started', terminalId: place.terminalId, data: { title } })
    } else {
      status = this.childStatus(t)
      if (fresh && !t.initial) drafts.push({ kind: 'agent.started', terminalId: place.terminalId, agentId: place.agentId, data: { agentType: 'codex', description: title } })
    }

    if (finished(status) && t.finishedAt === undefined && !place.standalone) t.finishedAt = now
    if (!finished(status) && !place.standalone) t.finishedAt = undefined
    if (!place.standalone && finished(status) && t.lastStatus !== status && (t.lastStatus !== undefined || !t.initial)) {
      const kind = status === 'completed' ? 'agent.completed' : status === 'cancelled' ? 'agent.cancelled' : 'agent.failed'
      drafts.push({ kind, terminalId: place.terminalId, agentId: place.agentId, data: { agentType: 'codex', description: title } })
    }
    t.lastStatus = status
    this.store.upsertAgent(this.agentOf(t, place, status, title))
    t.published = { terminalId: place.terminalId, agentId: place.agentId, standalone: place.standalone }
    for (const d of drafts) this.store.pushActivity(d)
  }

  private terminalOf(t: Thread, id: string, status: TerminalStatus, title: string): TerminalSession {
    const s = t.state
    return {
      id,
      provider: 'codex',
      processId: t.proc?.pid,
      title,
      entrypoint: t.mode,
      cwd: t.meta.cwd,
      codexSessionId: t.id,
      codexVersion: t.meta.version,
      status,
      statusSince: status === 'working' ? s.turnStartedAt : status === 'idle' ? (s.turnEndedAt ?? iso(t.meta.createdAt)) : undefined,
      compactions: s.compactions || undefined,
      startedAt: iso(t.meta.createdAt),
      lastActivityAt: s.lastAt,
      endedAt: t.endedAt,
    }
  }

  private agentOf(t: Thread, place: { terminalId: string; agentId: string; parentId?: string; standalone: boolean }, status: AgentStatus, title: string): Agent {
    const s = t.state
    const total = s.total
    const input = total ? total.input - total.cached : undefined
    const context = s.last?.total
    const window = s.contextWindow
    return {
      id: place.agentId,
      parentId: place.parentId,
      terminalId: place.terminalId,
      role: place.standalone ? 'main' : 'subagent',
      provider: 'codex',
      name: title,
      type: t.mode,
      model: s.model,
      effort: s.effort,
      status,
      currentTool: status === 'working' ? s.currentTool() : undefined,
      startedAt: iso(t.meta.createdAt),
      updatedAt: s.lastAt,
      completedAt: finished(status) ? (s.turnEndedAt ?? s.lastAt) : undefined,
      inputTokens: input,
      outputTokens: total?.output,
      cacheReadTokens: total?.cached,
      totalTokens: total && input !== undefined ? input + total.output : undefined,
      contextTokens: context,
      contextWindow: window,
      contextPct: context !== undefined && window ? round1(Math.min(100, (context / window) * 100)) : undefined,
    }
  }

  private unpublish(t: Thread): void {
    const prev = t.published
    if (!prev) return
    if (prev.standalone) this.store.removeTerminal(prev.terminalId)
    else this.store.removeAgent(prev.agentId)
    t.published = undefined
  }

  private forget(t: Thread): void {
    this.unpublish(t)
    this.threads.delete(t.id)
    for (const child of this.threads.values()) {
      if (child.meta.parentThreadId === t.id && !child.link) this.forget(child)
    }
  }
}
