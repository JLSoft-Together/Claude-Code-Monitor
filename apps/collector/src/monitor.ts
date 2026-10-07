import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { CollectorConfig } from './config'
import { isPidAlive, procStartMatches, queryProcesses, type ProcessInfo } from './process'
import { readRegistry } from './registry'
import type { MonitorStore } from './store'
import { SessionTracker, terminalIdOf, type ActivityDraft } from './tracker'

const SESSION_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export interface MonitorDeps {
  queryProcesses: (pids: number[]) => Promise<Map<number, ProcessInfo> | null>
  isPidAlive: (pid: number) => boolean
  now: () => number
}

const defaultDeps: MonitorDeps = { queryProcesses, isPidAlive, now: () => Date.now() }

export class Monitor {
  private readonly trackers = new Map<string, SessionTracker>()
  private readonly rejected = new Set<string>()
  private readonly sessionsDir: string
  private readonly projectsDir: string
  private readonly watchers: FSWatcher[] = []
  private readonly timers: NodeJS.Timeout[] = []
  private readonly syncTimers = new Map<string, NodeJS.Timeout>()
  private registryTimer: NodeJS.Timeout | null = null
  private reconciling: Promise<void> | null = null
  private reconcileAgain = false
  private sessionsWatched = false
  private projectsWatched = false
  private stopped = false

  constructor(
    private readonly config: CollectorConfig,
    private readonly store: MonitorStore,
    private readonly deps: MonitorDeps = defaultDeps,
  ) {
    this.sessionsDir = path.join(config.claudeRoot, 'sessions')
    this.projectsDir = path.join(config.claudeRoot, 'projects')
  }

  async start(options: { watch?: boolean } = {}): Promise<void> {
    await this.reconcile(true)
    if (options.watch === false) return
    this.setupWatchers()
    this.timers.push(setInterval(() => void this.reconcile(false), this.config.reconcileMs))
    this.timers.push(setInterval(() => void this.verifyLive(), this.config.processVerifyMs))
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) w.close()
    for (const t of this.timers) clearInterval(t)
    for (const t of this.syncTimers.values()) clearTimeout(t)
    if (this.registryTimer) clearTimeout(this.registryTimer)
  }

  reconcile(initial = false): Promise<void> {
    if (this.reconciling) {
      this.reconcileAgain = true
      return this.reconciling
    }
    this.reconciling = (async () => {
      let first = initial
      do {
        this.reconcileAgain = false
        try {
          await this.reconcileOnce(first)
        } catch (err) {
          console.error('[collector] reconcile failed:', (err as Error).message)
        }
        first = false
      } while (this.reconcileAgain && !this.stopped)
    })().finally(() => {
      this.reconciling = null
    })
    return this.reconciling
  }

  private async reconcileOnce(initial: boolean): Promise<void> {
    if (!this.sessionsWatched || !this.projectsWatched) this.setupWatchers(true)
    const registry = await readRegistry(this.sessionsDir)
    const now = this.deps.now()
    const seen = new Set<string>()
    const created: SessionTracker[] = []

    for (const [pid, entry] of registry) {
      if (entry === 'unreadable') {
        for (const t of this.trackers.values()) if (t.record.pid === pid && !t.ended) seen.add(t.terminalId)
        continue
      }
      const id = terminalIdOf(entry)
      if (this.rejected.has(id) || !this.deps.isPidAlive(pid)) continue
      let tracker = this.trackers.get(id)
      if (!tracker) {
        tracker = new SessionTracker(id, entry, this.projectsDir)
        created.push(tracker)
        seen.add(id)
        continue
      }
      if (tracker.ended) continue
      seen.add(id)
      this.applyRecordChange(tracker, entry)
    }

    const accepted = await this.verifyNew(created)
    for (const tracker of accepted) {
      this.trackers.set(tracker.terminalId, tracker)
      await tracker.sync(true)
      this.publish(tracker)
      if (!initial) {
        this.pushActivity([{ kind: 'terminal.started', terminalId: tracker.terminalId, data: { title: tracker.buildTerminal().title } }])
      }
    }

    for (const tracker of this.trackers.values()) {
      if (!tracker.ended && !seen.has(tracker.terminalId)) await this.endTracker(tracker, now)
    }

    for (const tracker of [...this.trackers.values()]) {
      if (!tracker.ended) {
        if (!accepted.includes(tracker)) await this.syncTracker(tracker)
        continue
      }
      const endedAt = Date.parse(tracker.endedAt ?? '')
      if (Number.isFinite(endedAt) && now - endedAt >= this.config.staleTtlMs) {
        this.trackers.delete(tracker.terminalId)
        this.store.removeTerminal(tracker.terminalId)
      }
    }
  }

  private applyRecordChange(tracker: SessionTracker, entry: SessionTracker['record']): void {
    const prev = tracker.record
    const prevTitle = tracker.buildTerminal().title
    const { sessionChanged } = tracker.setRecord(entry)
    const drafts: ActivityDraft[] = []
    const title = tracker.buildTerminal().title
    if (title !== prevTitle) {
      drafts.push({ kind: 'terminal.renamed', terminalId: tracker.terminalId, data: { from: prevTitle, to: title } })
    }
    if (entry.status !== prev.status && entry.status === 'waiting') {
      drafts.push({ kind: 'terminal.status', terminalId: tracker.terminalId, data: { to: 'waiting', waitingFor: entry.waitingFor } })
    }
    if (sessionChanged) {
      drafts.push({ kind: 'session.cleared', terminalId: tracker.terminalId, data: { title } })
      for (const agent of this.store.agentsOf(tracker.terminalId)) {
        if (agent.role !== 'main') this.store.removeAgent(agent.id)
      }
    }
    this.pushActivity(drafts)
  }

  private async verifyNew(created: SessionTracker[]): Promise<SessionTracker[]> {
    if (created.length === 0 || !this.config.verifyProcesses) return created
    const info = await this.deps.queryProcesses(created.map((t) => t.record.pid))
    if (!info) return created
    const accepted: SessionTracker[] = []
    for (const tracker of created) {
      const proc = info.get(tracker.record.pid)
      if (!proc || !procStartMatches(tracker.record.procStart, proc.creationFileTime)) {
        this.rejected.add(tracker.terminalId)
        continue
      }
      tracker.parentPid = proc.parentPid
      tracker.shell = proc.parentName
      accepted.push(tracker)
    }
    return accepted
  }

  private async verifyLive(): Promise<void> {
    if (!this.config.verifyProcesses || this.stopped) return
    const live = [...this.trackers.values()].filter((t) => !t.ended)
    if (live.length === 0) return
    const info = await this.deps.queryProcesses(live.map((t) => t.record.pid))
    if (!info) return
    const now = this.deps.now()
    for (const tracker of live) {
      const proc = info.get(tracker.record.pid)
      if (!proc || !procStartMatches(tracker.record.procStart, proc.creationFileTime)) {
        await this.endTracker(tracker, now)
      }
    }
  }

  private async endTracker(tracker: SessionTracker, now: number): Promise<void> {
    await this.syncTracker(tracker)
    tracker.markEnded(new Date(now).toISOString())
    this.publish(tracker)
    this.pushActivity([{ kind: 'terminal.ended', terminalId: tracker.terminalId, data: { title: tracker.buildTerminal().title } }])
  }

  private async syncTracker(tracker: SessionTracker): Promise<void> {
    try {
      const drafts = await tracker.sync(false)
      this.publish(tracker)
      this.pushActivity(drafts)
    } catch (err) {
      console.error('[collector] sync failed:', (err as Error).message)
    }
  }

  private publish(tracker: SessionTracker): void {
    const terminal = tracker.buildTerminal()
    this.store.upsertTerminal(terminal)
    const agents = tracker.buildAgents(terminal)
    const ids = new Set(agents.map((a) => a.id))
    for (const agent of this.store.agentsOf(tracker.terminalId)) {
      if (!ids.has(agent.id)) this.store.removeAgent(agent.id)
    }
    for (const agent of agents) this.store.upsertAgent(agent)
  }

  private pushActivity(drafts: ActivityDraft[]): void {
    for (const d of drafts) this.store.pushActivity(d)
  }

  private setupWatchers(quiet = false): void {
    if (this.stopped) return
    if (!this.sessionsWatched) {
      try {
        const w = watch(this.sessionsDir, () => this.scheduleRegistry())
        w.on('error', () => {
          this.sessionsWatched = false
        })
        this.watchers.push(w)
        this.sessionsWatched = true
      } catch (err) {
        if (!quiet) console.warn('[collector] cannot watch sessions dir:', (err as Error).message)
      }
    }
    if (!this.projectsWatched) {
      try {
        const w = watch(this.projectsDir, { recursive: true }, (_event, file) => {
          if (file) this.routeProjectChange(String(file))
        })
        w.on('error', () => {
          this.projectsWatched = false
        })
        this.watchers.push(w)
        this.projectsWatched = true
      } catch (err) {
        if (!quiet) console.warn('[collector] cannot watch projects dir:', (err as Error).message)
      }
    }
  }

  private scheduleRegistry(): void {
    if (this.registryTimer) return
    this.registryTimer = setTimeout(() => {
      this.registryTimer = null
      void this.reconcile(false)
    }, 100)
  }

  private routeProjectChange(file: string): void {
    const sessionId = file.match(SESSION_ID_RE)?.[0]
    if (!sessionId) return
    for (const tracker of this.trackers.values()) {
      if (tracker.ended || tracker.sessionId !== sessionId) continue
      if (this.syncTimers.has(tracker.terminalId)) return
      this.syncTimers.set(
        tracker.terminalId,
        setTimeout(() => {
          this.syncTimers.delete(tracker.terminalId)
          void this.syncTracker(tracker)
        }, 150),
      )
      return
    }
  }
}
