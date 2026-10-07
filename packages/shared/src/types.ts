export type TerminalStatus = 'working' | 'waiting' | 'idle' | 'stale' | 'error' | 'unknown'

export type AgentStatus =
  | 'working'
  | 'waiting'
  | 'idle'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'unknown'

export type AgentRole = 'main' | 'subagent'

export interface TerminalSession {
  id: string
  processId?: number
  parentProcessId?: number
  shell?: string

  title: string
  alias?: string
  nameSource?: string
  kind?: string
  entrypoint?: string

  cwd?: string
  claudeSessionId?: string
  claudeVersion?: string

  rawStatus?: string
  status: TerminalStatus
  /** When the registry status last changed (e.g. how long a session has been waiting). */
  statusSince?: string
  waitingFor?: string
  backgroundShell?: boolean
  permissionMode?: string
  gitBranch?: string
  compactions?: number
  /** Session cost as reported by Claude Code's status line (opt-in bridge). */
  costUsd?: number
  /** Uncommitted changes in the session's git checkout (read-only `git diff --shortstat`, refreshed when a turn ends). */
  diff?: GitDiffStat

  startedAt?: string
  lastActivityAt?: string
  endedAt?: string
}

export interface Agent {
  id: string
  parentId?: string
  terminalId: string

  role: AgentRole
  name?: string
  type?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
  model?: string
  /** Reasoning effort of the latest reply (`low` … `max`). */
  effort?: string

  status: AgentStatus

  currentTool?: string

  startedAt?: string
  updatedAt?: string
  completedAt?: string

  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  totalTokens?: number
  /** Prompt size of the latest API call (input + cache write + cache read). */
  contextTokens?: number
  contextWindow?: number
  /** Prompt-cache TTL tier of the latest reply and when that reply landed (cache expiry estimate). */
  cacheTtl?: CacheTtl
  cacheAt?: string
}

export type CacheTtl = '5m' | '1h'

export type ActivityKind =
  | 'terminal.started'
  | 'terminal.ended'
  | 'terminal.renamed'
  | 'terminal.status'
  | 'session.cleared'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.cancelled'
  | 'tool.started'
  | 'tool.failed'
  | 'terminal.compacted'
  | 'terminal.mode'
  | 'launch.started'
  | 'launch.failed'
  | 'job.blocked'
  | 'job.done'

export interface ActivityEvent {
  id: string
  at: string
  kind: ActivityKind
  terminalId?: string
  agentId?: string
  data?: {
    title?: string
    from?: string
    to?: string
    tool?: string
    agentType?: string
    description?: string
    waitingFor?: string
    trigger?: string
    mode?: string
    preTokens?: number
    postTokens?: number
    error?: string
  }
}

export type LaunchMode = 'new' | 'continue'

export interface Favorite {
  dir: string
  label: string
  addedAt: string
}

export interface MonitorSnapshot {
  protocolVersion: number
  collectorStartedAt: string
  supportedClaudeVersion: string
  terminals: TerminalSession[]
  agents: Agent[]
  activity: ActivityEvent[]
  usage?: UsageSnapshot
  favorites?: Favorite[]
  jobs?: BackgroundJob[]
  limits?: PlanLimits
  response?: ResponseStats
  /** Model id → official display name from Claude Code's model catalog. */
  modelNames?: Record<string, string>
  /** Ready-to-paste `statusLine.command` for the opt-in bridge (absolute path on this machine). */
  statusLineCommand?: string
  /** First collector start today (local day), the anchor for break reminders. */
  dayStartedAt?: string
}

export type JobState = 'working' | 'blocked' | 'done' | 'unknown'

/** Background job started with `claude agents` / the daemon (`<claudeRoot>/jobs/<id>/state.json`). */
export interface BackgroundJob {
  id: string
  name?: string
  state: JobState
  tempo?: string
  tasks?: number
  queued?: number
  tokens?: number
  stateSince?: string
  updatedAt?: string
}

export interface LimitWindow {
  /** 0–100. */
  usedPct: number
  resetsAt?: string
  forecast?: LimitForecast
}

/** Linear projection of recent burn (estimate). `fullAt` only when the rate is meaningful. */
export interface LimitForecast {
  pctPerHour: number
  fullAt?: string
  /** True when `fullAt` falls before the window resets (or the reset time is unknown). */
  beforeReset?: boolean
}

/** Subscription rate limits from the status line bridge (account wide, latest report wins). */
export interface PlanLimits {
  fiveHour?: LimitWindow
  sevenDay?: LimitWindow
  updatedAt: string
}

/** Today's wait → reply times, measured from registry status changes (waiting → busy). */
export interface ResponseStats {
  day: string
  count: number
  totalMs: number
  medianMs?: number
  /** Waits longer than 5 minutes. */
  longWaits: number
}

export interface UsageTotals {
  messages: number
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export interface UsageBucket extends UsageTotals {
  key: string
  day: string
  model: string
  project: string
  fast?: boolean
}

export type UsageScanState = 'idle' | 'scanning' | 'ready'

export interface UsageScan {
  state: UsageScanState
  filesDone: number
  filesTotal: number
}

export interface UsageSnapshot {
  buckets: UsageBucket[]
  scan: UsageScan
  /** Project cwd → nearest ancestor holding `.git` (itself when none). */
  roots?: Record<string, string>
}

export type Patch<T extends { id: string }> = { [K in Exclude<keyof T, 'id'>]?: T[K] | null } & { id: string }

export type TerminalPatch = Patch<TerminalSession>
export type AgentPatch = Patch<Agent>

export type FavoriteRejectReason = 'invalid' | 'notFound' | 'exists' | 'limit'

/** A session that ended, kept by the collector (`<dataDir>/history.json`, newest first, capped). Counters only. */
export interface SessionRecord {
  id: string
  title: string
  cwd?: string
  gitBranch?: string
  model?: string
  startedAt?: string
  endedAt: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  subagents: number
  compactions?: number
  costUsd?: number
  /** Time spent working / waiting today, from the status timeline (only what the collector saw). */
  workingMs?: number
  waitingMs?: number
}

export type LaneStatus = 'working' | 'waiting' | 'idle'

export interface TimelineSegment {
  from: string
  /** Open segment when missing. */
  to?: string
  status: LaneStatus
}

export interface TimelineLane {
  id: string
  title: string
  segments: TimelineSegment[]
}

/** Status lanes per session for one local day (registry status changes). */
export interface DayTimeline {
  day: string
  lanes: TimelineLane[]
}

export interface GitDiffStat {
  files: number
  insertions: number
  deletions: number
  untracked: number
  at: string
}

export type OpenApp = 'explorer' | 'vscode'
export type OpenResult = 'ok' | 'notFound' | 'noApp' | 'failed' | 'unsupported'

/** Collector self-report for the diagnostics panel; paths are the user's own local folders. */
export interface Diagnostics {
  collectorVersion?: string
  startedAt: string
  platform: string
  node: string
  claudeRoot: string
  claudeRootFound: boolean
  dataDir: string
  watchers: { sessions: boolean; projects: boolean }
  verifyProcesses: boolean
  sessions: { live: number; ended: number }
  statusLine: { reports: number; lastAt?: string }
  usage?: UsageScan
  clients: number
}

/** Outcome of bringing a session's terminal window to the front. */
export type FocusWindowResult = 'ok' | 'notFound' | 'ambiguous' | 'failed' | 'unsupported'
export type FolderPickResult = 'ok' | 'cancelled' | 'busy' | 'failed' | 'unsupported'

export type MonitorEvent =
  | { type: 'snapshot'; payload: MonitorSnapshot }
  | { type: 'terminal.created'; payload: TerminalSession }
  | { type: 'terminal.updated'; payload: TerminalPatch }
  | { type: 'terminal.removed'; payload: { id: string } }
  | { type: 'agent.created'; payload: Agent }
  | { type: 'agent.updated'; payload: AgentPatch }
  | { type: 'agent.removed'; payload: { id: string } }
  | { type: 'activity'; payload: ActivityEvent }
  | { type: 'usage.reset'; payload: UsageSnapshot }
  | { type: 'usage.updated'; payload: { buckets: UsageBucket[] } }
  | { type: 'usage.scan'; payload: UsageScan }
  | { type: 'usage.roots'; payload: { roots: Record<string, string> } }
  | { type: 'favorites.updated'; payload: { favorites: Favorite[] } }
  | { type: 'favorite.rejected'; payload: { dir: string; reason: FavoriteRejectReason } }
  | { type: 'jobs.updated'; payload: { jobs: BackgroundJob[] } }
  | { type: 'limits.updated'; payload: PlanLimits }
  | { type: 'response.updated'; payload: ResponseStats }
  | { type: 'models.updated'; payload: { modelNames: Record<string, string> } }
  | { type: 'terminal.focusResult'; payload: { terminalId: string; result: FocusWindowResult } }
  | { type: 'folder.picked'; payload: { requestId: string; result: FolderPickResult; dir?: string } }
  | { type: 'history.data'; payload: { sessions: SessionRecord[] } }
  | { type: 'history.added'; payload: SessionRecord }
  | { type: 'timeline.data'; payload: DayTimeline }
  | { type: 'terminal.openResult'; payload: { terminalId: string; app: OpenApp; result: OpenResult } }
  | { type: 'diagnostics.data'; payload: Diagnostics }

export interface ServerMessage {
  seq: number
  events: MonitorEvent[]
  /** Answer to one socket's request; outside the broadcast sequence, so it never triggers a resync. */
  direct?: true
}

export type ClientMessage =
  | { type: 'resync' }
  | { type: 'terminal.alias'; terminalId: string; alias: string | null }
  | { type: 'favorite.toggle'; terminalId: string }
  | { type: 'favorite.remove'; dir: string }
  /** Star a folder by path; must be an existing local absolute directory. */
  | { type: 'favorite.add'; dir: string; label?: string | null }
  | { type: 'folder.pick'; requestId: string }
  | { type: 'favorite.open'; dir: string; mode: LaunchMode }
  /** null or blank label resets to the folder name. */
  | { type: 'favorite.rename'; dir: string; label: string | null }
  /** Drop ended sessions from the dashboard; without terminalId every ended session goes. Live sessions are never touched. */
  | { type: 'terminal.dismiss'; terminalId?: string }
  /** Bring the terminal window hosting this session to the front (Windows only; never sends input). */
  | { type: 'terminal.focusWindow'; terminalId: string }
  /** Ask for the ended-session history / today's status timeline (answered with `history.data` / `timeline.data`). */
  | { type: 'history.get' }
  | { type: 'timeline.get' }
  /** Open the session's working folder in Explorer or VS Code (path comes from the collector, never the client). */
  | { type: 'terminal.open'; terminalId: string; app: OpenApp }
  | { type: 'diagnostics.get' }
