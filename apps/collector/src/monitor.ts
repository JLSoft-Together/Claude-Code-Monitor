import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { CollectorConfig } from './config'
import { isPidAlive, procStartMatches, queryProcesses, type ProcessInfo } from './process'
import type { BackgroundJob, Diagnostics, FocusWindowResult, FolderPickResult, GitDiffStat, LaunchMode, MonitorEvent, OpenApp, OpenResult, SessionRecord } from '@ccm/shared'
import { AliasStore, sanitizeAlias } from './aliases'
import { readSettingsModel } from './claude-settings'
import { FavoriteStore } from './favorites'
import { focusProcessWindow } from './focus'
import { pickFolder } from './folder-pick'
import { readDiffStat } from './gitstat'
import { openFolder } from './opener'
import { LimitHistory } from './forecast'
import { SessionHistory } from './history'
import { StatusTimeline } from './timeline'
import { JobReader } from './jobs'
import { launchClaude } from './launcher'
import { readModelNames } from './model-catalog'
import { readRegistry } from './registry'
import { ResponseTracker } from './response'
import { latestLimits, StatusLineReader } from './statusline'
import type { MonitorStore } from './store'
import { SessionTracker, terminalIdOf, type ActivityDraft, type ContextHints } from './tracker'

const SESSION_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Persisted side stores; tests leave them in memory. */
export interface MonitorStores {
  limitHistory?: LimitHistory
  history?: SessionHistory
  timeline?: StatusTimeline
}

export interface MonitorDeps {
  queryProcesses: (pids: number[]) => Promise<Map<number, ProcessInfo> | null>
  isPidAlive: (pid: number) => boolean
  now: () => number
  launch?: (dir: string, mode: LaunchMode) => Promise<void>
  focusWindow?: (pid: number) => Promise<FocusWindowResult>
  pickFolder?: () => Promise<{ result: FolderPickResult; dir?: string }>
  openFolder?: (dir: string, app: OpenApp) => Promise<OpenResult>
  diffStat?: (cwd: string) => Promise<GitDiffStat | null>
  diffDelayMs?: number
}

/** Sends an answer to the socket that asked; without one (tests, internal calls) it falls back to a broadcast. */
export type Reply = (event: MonitorEvent) => void

const DIFF_DEBOUNCE_MS = 2_000

const defaultDeps: MonitorDeps = { queryProcesses, isPidAlive, now: () => Date.now(), launch: launchClaude, focusWindow: focusProcessWindow, pickFolder, openFolder, diffStat: readDiffStat }

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
  onProjectFile: ((file: string) => void) | null = null
  readonly contextHints: ContextHints = {}
  private readonly jobReader: JobReader
  private readonly statusLine: StatusLineReader
  private readonly costs = new Map<string, number>()
  private jobs = new Map<string, BackgroundJob>()
  private jobsLoaded = false
  private focusing: Promise<void> = Promise.resolve()
  private picking = false
  private readonly diffs = new Map<string, GitDiffStat>()
  private readonly diffTimers = new Map<string, NodeJS.Timeout>()
  private readonly startedAt = new Date().toISOString()
  private statusReports: { count: number; lastAt?: string } = { count: 0 }
  private readonly limitHistory: LimitHistory
  private readonly history: SessionHistory
  private readonly timeline: StatusTimeline

  constructor(
    private readonly config: CollectorConfig,
    private readonly store: MonitorStore,
    private readonly deps: MonitorDeps = defaultDeps,
    private readonly aliases: AliasStore = new AliasStore(),
    private readonly favorites: FavoriteStore = new FavoriteStore(),
    private readonly response: ResponseTracker = new ResponseTracker(),
    stores: MonitorStores = {},
  ) {
    this.limitHistory = stores.limitHistory ?? new LimitHistory()
    this.history = stores.history ?? new SessionHistory()
    this.timeline = stores.timeline ?? new StatusTimeline(null, () => this.deps.now())
    this.sessionsDir = path.join(config.claudeRoot, 'sessions')
    this.projectsDir = path.join(config.claudeRoot, 'projects')
    this.jobReader = new JobReader(path.join(config.claudeRoot, 'jobs'))
    this.statusLine = new StatusLineReader(path.join(config.dataDir, 'statusline'))
  }

  async start(options: { watch?: boolean } = {}): Promise<void> {
    await this.refreshHints()
    this.store.setFavorites(this.favorites.list())
    this.store.setResponse(this.response.stats())
    await this.pollExtras()
    await this.reconcile(true)
    if (options.watch === false) return
    this.setupWatchers()
    this.timers.push(setInterval(() => void this.reconcile(false), this.config.reconcileMs))
    this.timers.push(setInterval(() => void this.verifyLive(), this.config.processVerifyMs))
    this.timers.push(setInterval(() => void this.refreshHints(), this.config.processVerifyMs))
    this.timers.push(setInterval(() => void this.pollExtras(), this.config.reconcileMs))
  }

  private async refreshHints(): Promise<void> {
    this.contextHints.settingsModel = await readSettingsModel(this.config.claudeRoot)
    this.store.setModelNames(await readModelNames(this.config.claudeRoot))
  }

  /** Background jobs + status line bridge files; both are small directories, polled with the reconcile cadence. */
  async pollExtras(): Promise<void> {
    if (this.stopped) return
    try {
      const now = this.deps.now()
      await this.pollJobs(now)
      const records = await this.statusLine.read(now)
      this.statusReports = { count: records.length, lastAt: newest(records.map((r) => r.at)) ?? this.statusReports.lastAt }
      this.store.setLimits(this.limitHistory.apply(latestLimits(records)))
      const changed = new Set<string>()
      const live = new Set<string>()
      for (const r of records) {
        if (r.costUsd === undefined) continue
        live.add(r.sessionId)
        if (this.costs.get(r.sessionId) === r.costUsd) continue
        this.costs.set(r.sessionId, r.costUsd)
        changed.add(r.sessionId)
      }
      // A status line file can expire while its session is still open; keep the last cost until the tracker goes.
      const tracked = new Set([...this.trackers.values()].map((t) => t.sessionId).filter(Boolean))
      for (const id of this.costs.keys()) if (!live.has(id) && !tracked.has(id)) this.costs.delete(id)
      if (changed.size) for (const t of this.trackers.values()) if (t.sessionId && changed.has(t.sessionId)) this.publish(t)
      if (this.response.rollDay()) this.store.setResponse(this.response.stats())
    } catch (err) {
      console.error('[collector] extras poll failed:', (err as Error).message)
    }
  }

  private async pollJobs(now: number): Promise<void> {
    const list = await this.jobReader.read(now)
    const drafts: ActivityDraft[] = []
    const next = new Map(list.map((j) => [j.id, j]))
    if (this.jobsLoaded) {
      for (const job of list) {
        const prev = this.jobs.get(job.id)
        if (prev?.state === job.state || (!prev && job.state === 'done')) continue
        if (job.state === 'blocked') drafts.push({ kind: 'job.blocked', data: { title: job.name ?? job.id } })
        else if (job.state === 'done') drafts.push({ kind: 'job.done', data: { title: job.name ?? job.id } })
      }
    }
    this.jobs = next
    this.jobsLoaded = true
    this.store.setJobs(list)
    this.pushActivity(drafts)
  }

  stop(): void {
    this.stopped = true
    for (const w of this.watchers) w.close()
    for (const t of this.timers) clearInterval(t)
    for (const t of this.syncTimers.values()) clearTimeout(t)
    for (const t of this.diffTimers.values()) clearTimeout(t)
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
        tracker = new SessionTracker(id, entry, this.projectsDir, this.contextHints)
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
      this.scheduleDiff(tracker)
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
      if (Number.isFinite(endedAt) && now - endedAt >= this.config.staleTtlMs) this.forget(tracker)
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
    if (prev.status === 'waiting' && entry.status === 'busy' && prev.statusUpdatedAt !== undefined) {
      const repliedAt = entry.statusUpdatedAt ?? this.deps.now()
      if (this.response.record(repliedAt - prev.statusUpdatedAt)) this.store.setResponse(this.response.stats())
    }
    if (entry.status !== prev.status && entry.status !== 'busy') this.scheduleDiff(tracker)
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
    const record = this.recordOf(tracker)
    if (record) {
      this.history.add(record)
      this.store.historyAdded(record)
    }
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

  setAlias(terminalId: string, value: unknown): boolean {
    const tracker = this.trackers.get(terminalId)
    if (!tracker) return false
    const before = this.titleOf(tracker)
    if (!this.aliases.set(terminalId, sanitizeAlias(value))) return false
    this.publish(tracker)
    const after = this.titleOf(tracker)
    if (after !== before) this.pushActivity([{ kind: 'terminal.renamed', terminalId, data: { from: before, to: after } }])
    return true
  }

  /** Returns how many ended sessions were removed. */
  dismissEnded(terminalId?: string): number {
    let removed = 0
    for (const tracker of [...this.trackers.values()]) {
      if (!tracker.ended || (terminalId !== undefined && tracker.terminalId !== terminalId)) continue
      this.forget(tracker)
      removed++
    }
    return removed
  }

  private forget(tracker: SessionTracker): void {
    this.trackers.delete(tracker.terminalId)
    this.diffs.delete(tracker.terminalId)
    clearTimeout(this.diffTimers.get(tracker.terminalId))
    this.diffTimers.delete(tracker.terminalId)
    this.store.removeTerminal(tracker.terminalId)
    this.aliases.delete(tracker.terminalId)
  }

  toggleFavorite(terminalId: string): boolean {
    const tracker = this.trackers.get(terminalId)
    const cwd = tracker?.record.cwd
    if (!tracker || !cwd) return false
    this.favorites.toggle(cwd, this.titleOf(tracker))
    this.store.setFavorites(this.favorites.list())
    return true
  }

  renameFavorite(dir: string, label: string | null): boolean {
    if (!this.favorites.rename(dir, label)) return false
    this.store.setFavorites(this.favorites.list())
    return true
  }

  async addFavorite(dir: string, label: string | null | undefined): Promise<boolean> {
    const trimmed = dir.trim().replace(/^"(.*)"$/, '$1')
    // UNC paths would make stat reach out over SMB (and leak NTLM credentials); only local absolute dirs are accepted.
    if (!trimmed || trimmed.length > 1024 || !path.isAbsolute(trimmed) || /^[\\/]{2}/.test(trimmed)) {
      this.store.rejectFavorite(dir, 'invalid')
      return false
    }
    const isDir = await stat(trimmed).then((s) => s.isDirectory(), () => false)
    if (!isDir) {
      this.store.rejectFavorite(dir, 'notFound')
      return false
    }
    const result = this.favorites.add(trimmed, label)
    if (result !== 'ok') {
      this.store.rejectFavorite(dir, result)
      return false
    }
    this.store.setFavorites(this.favorites.list())
    return true
  }

  removeFavorite(dir: string): boolean {
    if (!this.favorites.remove(dir)) return false
    this.store.setFavorites(this.favorites.list())
    return true
  }

  async openFavorite(dir: string, mode: LaunchMode): Promise<boolean> {
    const favorite = this.favorites.get(dir)
    const launch = this.deps.launch
    if (!favorite || !launch) return false
    try {
      await launch(favorite.dir, mode)
      this.pushActivity([{ kind: 'launch.started', data: { title: favorite.label, mode } }])
      return true
    } catch (err) {
      const error = (err as Error).message === 'directory not found' ? 'notFound' : 'failed'
      this.pushActivity([{ kind: 'launch.failed', data: { title: favorite.label, mode, error } }])
      return false
    }
  }

  private recordOf(tracker: SessionTracker): SessionRecord | null {
    const terminal = this.store.getTerminal(tracker.terminalId)
    if (!terminal?.endedAt) return null
    const agents = this.store.agentsOf(tracker.terminalId)
    const main = agents.find((a) => a.role === 'main')
    const totals = this.timeline.totals(tracker.terminalId)
    let input = 0
    let output = 0
    let cacheRead = 0
    for (const a of agents) {
      input += a.inputTokens ?? 0
      output += a.outputTokens ?? 0
      cacheRead += a.cacheReadTokens ?? 0
    }
    return {
      id: terminal.id,
      title: terminal.alias ?? terminal.title,
      cwd: terminal.cwd,
      gitBranch: terminal.gitBranch,
      model: main?.model,
      startedAt: terminal.startedAt,
      endedAt: terminal.endedAt,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      subagents: agents.length - (main ? 1 : 0),
      compactions: terminal.compactions,
      costUsd: terminal.costUsd,
      workingMs: totals.working || undefined,
      waitingMs: totals.waiting || undefined,
    }
  }

  sendHistory(reply?: Reply): void {
    if (reply) reply({ type: 'history.data', payload: { sessions: this.history.list() } })
    else this.store.historyData(this.history.list())
  }

  sendTimeline(reply?: Reply): void {
    if (reply) reply({ type: 'timeline.data', payload: this.timeline.data() })
    else this.store.timelineData(this.timeline.data())
  }

  /** Opens the tracked session's own cwd; the client only names the session. */
  async openFolder(terminalId: string, app: OpenApp, reply: Reply): Promise<void> {
    const cwd = this.trackers.get(terminalId)?.record.cwd
    const open = this.deps.openFolder
    let result: OpenResult
    if (!cwd) result = 'notFound'
    else if (!open) result = 'unsupported'
    else result = await open(cwd, app).catch((): OpenResult => 'failed')
    reply({ type: 'terminal.openResult', payload: { terminalId, app, result } })
  }

  diagnostics(): Omit<Diagnostics, 'usage' | 'clients'> {
    let live = 0
    let ended = 0
    for (const t of this.trackers.values()) {
      if (t.ended) ended++
      else live++
    }
    return {
      startedAt: this.startedAt,
      platform: `${process.platform} ${process.arch}`,
      node: process.version,
      claudeRoot: this.config.claudeRoot,
      claudeRootFound: this.sessionsWatched || this.projectsWatched,
      dataDir: this.config.dataDir,
      watchers: { sessions: this.sessionsWatched, projects: this.projectsWatched },
      verifyProcesses: this.config.verifyProcesses,
      sessions: { live, ended },
      statusLine: { reports: this.statusReports.count, lastAt: this.statusReports.lastAt },
    }
  }

  /** Refreshes the uncommitted-change count once a turn settles; debounced per session. */
  private scheduleDiff(tracker: SessionTracker): void {
    const read = this.deps.diffStat
    const cwd = tracker.record.cwd
    if (!read || !cwd || this.stopped) return
    clearTimeout(this.diffTimers.get(tracker.terminalId))
    this.diffTimers.set(
      tracker.terminalId,
      setTimeout(() => {
        this.diffTimers.delete(tracker.terminalId)
        void read(cwd)
          .catch(() => null)
          .then((stat) => {
            if (this.trackers.get(tracker.terminalId) !== tracker) return
            const prev = this.diffs.get(tracker.terminalId)
            if (!stat && !prev) return
            if (stat && prev && sameDiff(stat, prev)) return
            if (stat) this.diffs.set(tracker.terminalId, stat)
            else this.diffs.delete(tracker.terminalId)
            this.publish(tracker)
          })
      }, this.deps.diffDelayMs ?? DIFF_DEBOUNCE_MS),
    )
  }

  /** Opens the native folder dialog; one at a time, a second request while it is open answers busy. */
  async pickFolder(requestId: string, reply?: Reply): Promise<void> {
    const answer = (result: FolderPickResult, dir?: string) =>
      reply ? reply({ type: 'folder.picked', payload: { requestId, result, dir } }) : this.store.folderPicked(requestId, result, dir)
    const pick = this.deps.pickFolder
    if (!pick) return answer('unsupported')
    if (this.picking) return answer('busy')
    this.picking = true
    try {
      const r = await pick().catch(() => ({ result: 'failed' as const, dir: undefined }))
      answer(r.result, r.dir)
    } finally {
      this.picking = false
    }
  }

  /** Raises the window of a live session; requests run one at a time and every request gets an answer. */
  focusWindow(terminalId: string, reply?: Reply): Promise<void> {
    const run = async () => {
      const tracker = this.trackers.get(terminalId)
      const focus = this.deps.focusWindow
      let result: FocusWindowResult
      if (!tracker || tracker.ended) result = 'notFound'
      else if (!focus) result = 'unsupported'
      else result = await focus(tracker.record.pid).catch((): FocusWindowResult => 'failed')
      if (reply) reply({ type: 'terminal.focusResult', payload: { terminalId, result } })
      else this.store.focusResult(terminalId, result)
    }
    this.focusing = this.focusing.then(run, run)
    return this.focusing
  }

  private titleOf(tracker: SessionTracker): string {
    return this.aliases.get(tracker.terminalId) ?? tracker.buildTerminal().title
  }

  private publish(tracker: SessionTracker): void {
    const sessionId = tracker.sessionId
    const terminal = {
      ...tracker.buildTerminal(),
      alias: this.aliases.get(tracker.terminalId),
      costUsd: sessionId ? this.costs.get(sessionId) : undefined,
      diff: this.diffs.get(tracker.terminalId),
    }
    this.store.upsertTerminal(terminal)
    this.timeline.observe(terminal.id, terminal.alias ?? terminal.title, terminal.status, terminal.statusSince)
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
          if (!file) return
          this.routeProjectChange(String(file))
          this.onProjectFile?.(String(file))
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

function newest(values: (string | undefined)[]): string | undefined {
  let best: string | undefined
  for (const v of values) if (v && (!best || v > best)) best = v
  return best
}

const sameDiff = (a: GitDiffStat, b: GitDiffStat) =>
  a.files === b.files && a.insertions === b.insertions && a.deletions === b.deletions && a.untracked === b.untracked
