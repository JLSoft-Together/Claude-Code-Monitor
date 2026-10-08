import {
  PROTOCOL_VERSION,
  SUPPORTED_CLAUDE_VERSION,
  type ActivityEvent,
  type Agent,
  type BackgroundJob,
  type Favorite,
  type FavoriteRejectReason,
  type DayTimeline,
  type FocusWindowResult,
  type FolderPickResult,
  type SessionRecord,
  type MonitorEvent,
  type MonitorSnapshot,
  type PlanLimits,
  type ResponseStats,
  type ServerMessage,
  type TerminalSession,
  type NotifySettings,
  type SnoozeEntry,
  type UsageBucket,
  type UsageScan,
  type UsageSnapshot,
} from '@ccm/shared'
import type { UsageSink } from './usage'

type Listener = (message: ServerMessage) => void

function diff<T extends { id: string }>(prev: T, next: T): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  let changed = false
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (key === 'id') continue
    const a = (prev as Record<string, unknown>)[key]
    const b = (next as Record<string, unknown>)[key]
    if (a === b) continue
    patch[key] = b === undefined ? null : b
    changed = true
  }
  return changed ? patch : null
}

function clean<T extends object>(obj: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out as T
}

export class MonitorStore implements UsageSink {
  private readonly terminals = new Map<string, TerminalSession>()
  private readonly agents = new Map<string, Agent>()
  private readonly activity: ActivityEvent[] = []
  /** tool.* events get their own ring so a busy session cannot push waits/completions out of history. */
  private readonly toolActivity: ActivityEvent[] = []
  private jobs: BackgroundJob[] = []
  private limits: PlanLimits | null = null
  private response: ResponseStats | null = null
  private modelNames: Record<string, string> = {}
  statusLineCommand?: string
  dayStartedAt?: string
  notify?: NotifySettings
  private snoozes: Record<string, SnoozeEntry> = {}
  private readonly usage = new Map<string, UsageBucket>()
  private usageScan: UsageScan = { state: 'idle', filesDone: 0, filesTotal: 0 }
  private favorites: Favorite[] = []
  private readonly roots = new Map<string, string>()
  /** Called with project dirs that have no repo root yet; the owner resolves them async. */
  onNewProjects: ((dirs: string[]) => void) | null = null
  private pending: MonitorEvent[] = []
  private flushTimer: NodeJS.Timeout | null = null
  private listeners = new Set<Listener>()
  private activityCounter = 0
  private seqValue = 0
  readonly startedAt = new Date().toISOString()

  constructor(
    private readonly options: { activityLimit: number; batchMs: number },
  ) {}

  get seq(): number {
    return this.seqValue
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  terminalList(): IterableIterator<TerminalSession> {
    return this.terminals.values()
  }

  contextPct(terminalId: string): number | null {
    for (const a of this.agents.values()) {
      if (a.terminalId !== terminalId || a.role !== 'main') continue
      return a.contextTokens !== undefined && a.contextWindow ? (a.contextTokens / a.contextWindow) * 100 : null
    }
    return null
  }

  jobList(): readonly BackgroundJob[] {
    return this.jobs
  }

  currentLimits(): PlanLimits | null {
    return this.limits
  }

  toolEvents(): readonly ActivityEvent[] {
    return this.toolActivity
  }

  setNotify(settings: NotifySettings): void {
    if (JSON.stringify(settings) === JSON.stringify(this.notify)) return
    this.notify = { ...settings, kinds: { ...settings.kinds }, quiet: { ...settings.quiet } }
    this.emit({ type: 'notify.settings', payload: this.notify })
  }

  setSnoozes(snoozes: Record<string, SnoozeEntry>): void {
    if (JSON.stringify(snoozes) === JSON.stringify(this.snoozes)) return
    this.snoozes = { ...snoozes }
    this.emit({ type: 'snooze.updated', payload: { snoozes: this.snoozes } })
  }

  getTerminal(id: string): TerminalSession | undefined {
    return this.terminals.get(id)
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  agentsOf(terminalId: string): Agent[] {
    return [...this.agents.values()].filter((a) => a.terminalId === terminalId)
  }

  upsertTerminal(next: TerminalSession): void {
    const value = clean(next)
    const prev = this.terminals.get(value.id)
    this.terminals.set(value.id, value)
    if (!prev) return this.emit({ type: 'terminal.created', payload: value })
    const patch = diff(prev, value)
    if (patch) this.emit({ type: 'terminal.updated', payload: { ...patch, id: value.id } })
  }

  removeTerminal(id: string): void {
    for (const agent of this.agentsOf(id)) this.removeAgent(agent.id)
    if (this.terminals.delete(id)) this.emit({ type: 'terminal.removed', payload: { id } })
  }

  upsertAgent(next: Agent): void {
    const value = clean(next)
    const prev = this.agents.get(value.id)
    this.agents.set(value.id, value)
    if (!prev) return this.emit({ type: 'agent.created', payload: value })
    const patch = diff(prev, value)
    if (patch) this.emit({ type: 'agent.updated', payload: { ...patch, id: value.id } })
  }

  removeAgent(id: string): void {
    if (this.agents.delete(id)) this.emit({ type: 'agent.removed', payload: { id } })
  }

  pushActivity(event: Omit<ActivityEvent, 'id' | 'at'> & { at?: string }): void {
    const value: ActivityEvent = clean({
      ...event,
      id: `${Date.now().toString(36)}-${(this.activityCounter++).toString(36)}`,
      at: event.at ?? new Date().toISOString(),
    })
    const ring = value.kind.startsWith('tool.') ? this.toolActivity : this.activity
    ring.push(value)
    if (ring.length > this.options.activityLimit) ring.splice(0, ring.length - this.options.activityLimit)
    this.emit({ type: 'activity', payload: value })
  }

  resetUsage(snapshot: UsageSnapshot): void {
    this.usage.clear()
    for (const b of snapshot.buckets) this.usage.set(b.key, b)
    this.usageScan = snapshot.scan
    this.emit({ type: 'usage.reset', payload: this.usageSnapshot() })
    this.reportNewProjects(snapshot.buckets)
  }

  setProjectRoots(roots: Record<string, string>): void {
    const added: Record<string, string> = {}
    for (const [dir, root] of Object.entries(roots)) {
      if (this.roots.get(dir) === root) continue
      this.roots.set(dir, root)
      added[dir] = root
    }
    if (Object.keys(added).length) this.emit({ type: 'usage.roots', payload: { roots: added } })
  }

  private reportNewProjects(buckets: UsageBucket[]): void {
    if (!this.onNewProjects) return
    const dirs = [...new Set(buckets.map((b) => b.project))].filter((d) => !this.roots.has(d))
    if (dirs.length) this.onNewProjects(dirs)
  }

  updateUsage(buckets: UsageBucket[]): void {
    if (buckets.length === 0) return
    for (const b of buckets) this.usage.set(b.key, b)
    this.emit({ type: 'usage.updated', payload: { buckets } })
    this.reportNewProjects(buckets)
  }

  setUsageScan(scan: UsageScan): void {
    this.usageScan = scan
    this.emit({ type: 'usage.scan', payload: scan })
  }

  setFavorites(favorites: Favorite[]): void {
    this.favorites = favorites.map((f) => ({ ...f }))
    this.emit({ type: 'favorites.updated', payload: { favorites: this.favorites } })
  }

  rejectFavorite(dir: string, reason: FavoriteRejectReason): void {
    this.emit({ type: 'favorite.rejected', payload: { dir, reason } })
  }

  historyData(sessions: SessionRecord[]): void {
    this.emit({ type: 'history.data', payload: { sessions } })
  }

  historyAdded(record: SessionRecord): void {
    this.emit({ type: 'history.added', payload: record })
  }

  timelineData(timeline: DayTimeline): void {
    this.emit({ type: 'timeline.data', payload: timeline })
  }

  folderPicked(requestId: string, result: FolderPickResult, dir?: string): void {
    this.emit({ type: 'folder.picked', payload: { requestId, result, dir } })
  }

  focusResult(terminalId: string, result: FocusWindowResult): void {
    this.emit({ type: 'terminal.focusResult', payload: { terminalId, result } })
  }

  setJobs(jobs: BackgroundJob[]): void {
    if (JSON.stringify(jobs) === JSON.stringify(this.jobs)) return
    this.jobs = jobs.map((j) => clean({ ...j }))
    this.emit({ type: 'jobs.updated', payload: { jobs: this.jobs } })
  }

  setLimits(limits: PlanLimits | null): void {
    if (!limits || JSON.stringify(limits) === JSON.stringify(this.limits)) return
    this.limits = clean({ ...limits })
    this.emit({ type: 'limits.updated', payload: this.limits })
  }

  setResponse(stats: ResponseStats): void {
    if (JSON.stringify(stats) === JSON.stringify(this.response)) return
    this.response = clean({ ...stats })
    this.emit({ type: 'response.updated', payload: this.response })
  }

  setModelNames(names: Record<string, string>): void {
    if (JSON.stringify(names) === JSON.stringify(this.modelNames)) return
    this.modelNames = { ...names }
    this.emit({ type: 'models.updated', payload: { modelNames: this.modelNames } })
  }

  usageSnapshot(): UsageSnapshot {
    return { buckets: [...this.usage.values()], scan: { ...this.usageScan }, roots: Object.fromEntries(this.roots) }
  }

  snapshot(): MonitorSnapshot {
    return {
      protocolVersion: PROTOCOL_VERSION,
      collectorStartedAt: this.startedAt,
      supportedClaudeVersion: SUPPORTED_CLAUDE_VERSION,
      terminals: [...this.terminals.values()],
      agents: [...this.agents.values()],
      activity: [...this.activity, ...this.toolActivity].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
      usage: this.usageSnapshot(),
      favorites: [...this.favorites],
      jobs: [...this.jobs],
      limits: this.limits ?? undefined,
      response: this.response ?? undefined,
      modelNames: { ...this.modelNames },
      statusLineCommand: this.statusLineCommand,
      dayStartedAt: this.dayStartedAt,
      notify: this.notify,
      snoozes: { ...this.snoozes },
    }
  }

  snapshotMessage(): ServerMessage {
    this.flush()
    return { seq: this.seqValue, events: [{ type: 'snapshot', payload: this.snapshot() }] }
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pending.length === 0) return
    const message: ServerMessage = { seq: ++this.seqValue, events: this.pending }
    this.pending = []
    for (const listener of this.listeners) listener(message)
  }

  private emit(event: MonitorEvent): void {
    this.pending.push(event)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), this.options.batchMs)
  }
}
