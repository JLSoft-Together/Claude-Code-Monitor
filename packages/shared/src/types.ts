import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'

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

/** Which CLI produced the session / agent; absent means Claude Code. */
export type Provider = 'claude' | 'codex'

export interface TerminalSession {
  id: string
  processId?: number
  parentProcessId?: number
  shell?: string

  title: string
  alias?: string
  note?: string
  nameSource?: string
  kind?: string
  entrypoint?: string

  cwd?: string
  provider?: Provider
  claudeSessionId?: string
  claudeVersion?: string
  /** Codex thread id (rollout file name) and CLI version, for Codex sessions. */
  codexSessionId?: string
  codexVersion?: string

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
  /** Opt-in hook bridge: a compaction is running since then (PreCompact without its PostCompact yet). */
  compactingSince?: string
  compactTrigger?: 'manual' | 'auto'
  /** Opt-in hook bridge: tool calls the auto-mode classifier denied in this session, and the last tool names. */
  deniedCount?: number
  deniedTools?: string[]
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
  provider?: Provider
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
  /** Percent of the room before auto-compact, as the status line shows it (Claude Code's own % when the bridge reported it). */
  contextPct?: number
  /** Prompt-cache TTL tier of the latest reply and when that reply landed (cache expiry estimate). */
  cacheTtl?: CacheTtl
  cacheAt?: string

  msgIn?: number
  msgOut?: number
}

export type CacheTtl = '5m' | '1h'

export type PeerLinkKind = 'message' | 'opened'

export type PeerLinkDir = 'ab' | 'ba'

export interface PeerLink {
  id: string
  kind: PeerLinkKind
  a: string
  b: string
  ab: number
  ba: number
  firstAt: string
  lastAt: string
  lastDir: PeerLinkDir
  lastAgentId?: string
}

export type PeerLinkPatch = Patch<PeerLink>

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
  | 'job.stopped'
  | 'job.stopFailed'
  | 'peer.message'

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
    jobId?: string
  }
}

export type LaunchMode = 'new' | 'continue'

export type TerminalApp = 'terminal' | 'iterm'

/** `data.error` of a `launch.failed` activity. */
export type LaunchErrorCode = 'notFound' | 'denied' | 'notInstalled' | 'failed'

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
  /** Codex account rate limits (latest `token_count` in a Codex rollout). */
  codexLimits?: PlanLimits
  response?: ResponseStats
  /** Model id → official display name from Claude Code's model catalog. */
  modelNames?: Record<string, string>
  /** Ready-to-paste `statusLine.command` for the opt-in bridge (absolute path on this machine). */
  statusLineCommand?: string
  /** First collector start today (local day), the anchor for break reminders. */
  dayStartedAt?: string
  notify?: NotifySettings
  snoozes?: Record<string, SnoozeEntry>
  /** True while the collector's first pass over live sessions runs; `sessions.loading` reports the end. */
  loading?: boolean
  peerLinks?: PeerLink[]
}

export type ToastState = 'on' | 'off' | 'unsupported'
export type ToastKind = 'waiting' | 'done' | 'job' | 'loop' | 'limit' | 'context' | 'stuck'
export type ToastHealth = 'ok' | 'globalOff' | 'appOff' | 'unknown'
export type ToastTestResult = 'ok' | 'failed' | 'unsupported'

export interface QuietHours {
  enabled: boolean
  from: string
  to: string
}

export interface NotifySettings {
  toast: ToastState
  kinds: Record<ToastKind, boolean>
  quiet: QuietHours
  stuckMinutes: number
  health?: ToastHealth
}

export interface SnoozeEntry {
  until: number
  since?: string
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
  sessionId?: string
}

export type JobStopResult = 'ok' | 'notFound' | 'notRunning' | 'unconfirmed' | 'noCli' | 'failed'

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
  /** Codex only: plan name reported with the limits (`plus`, `pro`, …). */
  plan?: string
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

/** Assistant messages per local hour for recent days (History heatmap); from the usage scan, no content. */
export interface UsageHeatmap {
  days: { day: string; hours: number[] }[]
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
  codex?: { home: string; watching: boolean; threads: number; processes: number }
  sessions: { live: number; ended: number }
  statusLine: { reports: number; lastAt?: string }
  usage?: UsageScan
  clients: number
}

/** Outcome of bringing a session's terminal window to the front. */
export type FocusWindowResult = 'ok' | 'notFound' | 'ambiguous' | 'failed' | 'unsupported' | 'appOnly' | 'denied'
export type FolderPickResult = 'ok' | 'cancelled' | 'busy' | 'failed' | 'unsupported'

export type ToolOutcome = 'ok' | 'error' | 'interrupted'

export interface ToolSpan {
  id: string
  terminalId: string
  agentId: string
  tool: string
  start: string
  end?: string
  outcome?: ToolOutcome
}

export interface ToolSpansData {
  terminalId?: string
  since?: string
  spans: ToolSpan[]
}

export type MonitorEvent =
  | { type: 'snapshot'; payload: MonitorSnapshot }
  | { type: 'sessions.loading'; payload: { loading: boolean } }
  | { type: 'terminal.created'; payload: TerminalSession }
  | { type: 'terminal.updated'; payload: TerminalPatch }
  | { type: 'terminal.removed'; payload: { id: string } }
  | { type: 'agent.created'; payload: Agent }
  | { type: 'agent.updated'; payload: AgentPatch }
  | { type: 'agent.removed'; payload: { id: string } }
  | { type: 'link.created'; payload: PeerLink }
  | { type: 'link.updated'; payload: PeerLinkPatch }
  | { type: 'link.removed'; payload: { id: string } }
  | { type: 'activity'; payload: ActivityEvent }
  | { type: 'usage.reset'; payload: UsageSnapshot }
  | { type: 'usage.updated'; payload: { buckets: UsageBucket[] } }
  | { type: 'usage.scan'; payload: UsageScan }
  | { type: 'usage.roots'; payload: { roots: Record<string, string> } }
  | { type: 'favorites.updated'; payload: { favorites: Favorite[] } }
  | { type: 'favorite.rejected'; payload: { dir: string; reason: FavoriteRejectReason } }
  | { type: 'tool.span'; payload: ToolSpan }
  /** Direct reply to office subscribers only (never batched into seq); see apps/collector/src/office/hub.ts. */
  | { type: 'office.snapshot'; payload: OfficeSnapshot }
  | { type: 'toolSpans.data'; payload: ToolSpansData }
  | { type: 'jobs.updated'; payload: { jobs: BackgroundJob[] } }
  | { type: 'limits.updated'; payload: PlanLimits }
  | { type: 'codexLimits.updated'; payload: PlanLimits }
  | { type: 'response.updated'; payload: ResponseStats }
  | { type: 'models.updated'; payload: { modelNames: Record<string, string> } }
  | { type: 'terminal.focusResult'; payload: { terminalId: string; result: FocusWindowResult } }
  | { type: 'folder.picked'; payload: { requestId: string; result: FolderPickResult; dir?: string } }
  | { type: 'history.data'; payload: { sessions: SessionRecord[] } }
  | { type: 'history.added'; payload: SessionRecord }
  | { type: 'timeline.data'; payload: DayTimeline }
  | { type: 'heatmap.data'; payload: UsageHeatmap }
  | { type: 'terminal.openResult'; payload: { terminalId: string; app: OpenApp; result: OpenResult } }
  | { type: 'diagnostics.data'; payload: Diagnostics }
  | { type: 'notify.settings'; payload: NotifySettings }
  | { type: 'snooze.updated'; payload: { snoozes: Record<string, SnoozeEntry> } }
  | { type: 'notify.testResult'; payload: { result: ToastTestResult; health?: ToastHealth } }

export interface ServerMessage {
  seq: number
  events: MonitorEvent[]
  /** Answer to one socket's request; outside the broadcast sequence, so it never triggers a resync. */
  direct?: true
}

export type ClientMessage =
  | { type: 'resync' }
  | { type: 'office.subscribe'; on: boolean }
  | { type: 'toolSpans.get'; terminalId?: string; since?: string }
  | { type: 'terminal.alias'; terminalId: string; alias: string | null }
  | { type: 'favorite.toggle'; terminalId: string }
  | { type: 'favorite.remove'; dir: string }
  | { type: 'favorite.reorder'; dirs: string[] }
  /** Star a folder by path; must be an existing local absolute directory. */
  | { type: 'favorite.add'; dir: string; label?: string | null }
  | { type: 'folder.pick'; requestId: string }
  /** terminalApp picks Terminal.app or iTerm2 on macOS; ignored elsewhere. */
  | { type: 'favorite.open'; dir: string; mode: LaunchMode; terminalApp?: TerminalApp }
  /** null or blank label resets to the folder name. */
  | { type: 'favorite.rename'; dir: string; label: string | null }
  /** Drop ended sessions from the dashboard; without terminalId every ended session goes. Live sessions are never touched. */
  | { type: 'terminal.dismiss'; terminalId?: string }
  /** Bring the terminal window hosting this session to the front (Windows only; never sends input). */
  | { type: 'terminal.focusWindow'; terminalId: string }
  /** Ask for the ended-session history / today's status timeline (answered with `history.data` / `timeline.data`). */
  | { type: 'history.get' }
  | { type: 'timeline.get' }
  | { type: 'heatmap.get' }
  /** Open the session's working folder in Explorer or VS Code (path comes from the collector, never the client). */
  | { type: 'terminal.open'; terminalId: string; app: OpenApp }
  | { type: 'diagnostics.get' }
  | { type: 'job.dismiss'; jobId?: string }
  | { type: 'job.stop'; jobId: string }
  | { type: 'client.presence'; attentive: boolean; locale?: 'en' | 'vi' }
  | { type: 'notify.update'; toast?: boolean; kinds?: Partial<Record<ToastKind, boolean>>; quiet?: QuietHours; stuckMinutes?: number }
  | { type: 'notify.test' }
  | { type: 'terminal.note'; terminalId: string; note: string | null }
  | { type: 'terminal.snooze'; terminalId: string; minutes: number | null }
