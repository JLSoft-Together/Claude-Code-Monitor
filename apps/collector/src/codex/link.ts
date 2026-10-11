import type { CodexProcess } from './processes'
import type { CodexMode } from './rollout'

export interface ThreadKey {
  id: string
  createdAt: number
  mode: CodexMode
  parentThreadId?: string
  /** Process matched earlier; kept while it is still listed with the same start. */
  pid?: number
  start?: number
}

/** A live Claude Code session that may have launched Codex. */
export interface ClaudeTarget {
  terminalId: string
  pid: number
  cwd?: string
  mainAgentId: string
  ended: boolean
  lastActivityAt?: string
  /** Bash / PowerShell tool calls whose command mentions codex, per agent (ISO time of the call). */
  codexCalls: { agentId: string; at: string }[]
}

const BEFORE_START_MS = 2_000
const AFTER_START_MS = 120_000
const CALLER_LOOKBACK_MS = 10 * 60_000
const CALLER_SLACK_MS = 5_000

const PROCESS_MODE: Partial<Record<CodexMode, CodexProcess['mode']>> = { exec: 'exec', tui: 'tui' }

/**
 * Pairs threads with Codex processes. Codex keeps no pid registry, so a thread belongs to the process that started
 * just before it (exec / TUI create the thread at startup) or that names it in `resume <id>`. App-server threads
 * (plugin) share one long-lived process and are never paired; subagents inherit their parent's process.
 */
export function matchProcesses(threads: ThreadKey[], procs: CodexProcess[]): Map<string, CodexProcess> {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const result = new Map<string, CodexProcess>()
  const taken = new Set<number>()
  const open: ThreadKey[] = []
  for (const t of threads) {
    const kept = t.pid !== undefined ? byPid.get(t.pid) : undefined
    if (kept && kept.start === t.start) {
      result.set(t.id, kept)
      if (t.mode !== 'subagent') taken.add(kept.pid)
      continue
    }
    const resumed = procs.find((p) => p.resumeId === t.id)
    if (resumed) {
      result.set(t.id, resumed)
      taken.add(resumed.pid)
      continue
    }
    open.push(t)
  }

  const pairs: { t: ThreadKey; p: CodexProcess; gap: number }[] = []
  for (const t of open) {
    const want = PROCESS_MODE[t.mode]
    if (!want) continue
    for (const p of procs) {
      const gap = t.createdAt - p.start
      if (p.mode === want && gap >= -BEFORE_START_MS && gap <= AFTER_START_MS) pairs.push({ t, p, gap: Math.abs(gap) })
    }
  }
  pairs.sort((a, b) => a.gap - b.gap)
  for (const { t, p } of pairs) {
    if (result.has(t.id) || taken.has(p.pid)) continue
    result.set(t.id, p)
    taken.add(p.pid)
  }

  // `/new` inside a TUI starts a thread long after the process; with a single candidate the owner is unambiguous.
  for (const t of open) {
    if (result.has(t.id) || t.mode !== 'tui') continue
    const candidates = procs.filter((p) => p.mode === 'tui' && p.start <= t.createdAt)
    if (candidates.length === 1) result.set(t.id, candidates[0]!)
  }

  for (const t of threads) {
    if (t.mode !== 'subagent' || result.has(t.id) || !t.parentThreadId) continue
    let parent = t.parentThreadId
    for (let depth = 0; depth < 8 && parent; depth++) {
      const owner = result.get(parent)
      if (owner) {
        result.set(t.id, owner)
        break
      }
      parent = threads.find((x) => x.id === parent)?.parentThreadId ?? ''
    }
  }
  return result
}

export function normalizeDir(dir: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  if (!dir) return undefined
  let d = dir.replace(/^\\\\\?\\/, '')
  if (platform === 'win32') d = d.replace(/\//g, '\\').toLowerCase()
  return d.replace(/[\\/]+$/, '') || d
}

/**
 * The Claude session that launched a Codex run. Process ancestry is proof; when the chain is cut (a parent already
 * exited, or the run ended before it was seen) the session whose shell call mentioned codex right before stands in.
 * Plugin threads run in a shared app-server, so they match by cwd.
 */
export function claudeTargetFor(
  proc: CodexProcess | undefined,
  thread: { mode: CodexMode; cwd?: string; createdAt: number },
  targets: ClaudeTarget[],
  platform: NodeJS.Platform = process.platform,
): ClaudeTarget | undefined {
  const live = targets.filter((t) => !t.ended)
  if (proc) {
    for (const pid of proc.ancestors) {
      const hit = live.find((t) => t.pid === pid)
      if (hit) return hit
    }
  }
  if (thread.mode === 'plugin') {
    const dir = normalizeDir(thread.cwd, platform)
    if (!dir) return undefined
    const same = live.filter((t) => normalizeDir(t.cwd, platform) === dir)
    same.sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    return same[0]
  }
  if (proc && !proc.orphan) return undefined
  let best: { target: ClaudeTarget; at: number } | undefined
  for (const t of live) {
    const at = latestCall(t, thread.createdAt)
    if (at !== undefined && (!best || at > best.at)) best = { target: t, at }
  }
  return best?.target
}

function latestCall(target: ClaudeTarget, createdAt: number): number | undefined {
  let best: number | undefined
  for (const c of target.codexCalls) {
    const at = Date.parse(c.at)
    if (!Number.isFinite(at) || at > createdAt + CALLER_SLACK_MS || at < createdAt - CALLER_LOOKBACK_MS) continue
    if (best === undefined || at > best) best = at
  }
  return best
}

/** Agent whose latest codex-mentioning shell call came right before the thread started; main agent otherwise. */
export function callerOf(target: ClaudeTarget, createdAt: number): string {
  let best: { agentId: string; at: number } | undefined
  for (const c of target.codexCalls) {
    const at = Date.parse(c.at)
    if (!Number.isFinite(at) || at > createdAt + CALLER_SLACK_MS || at < createdAt - CALLER_LOOKBACK_MS) continue
    if (!best || at > best.at) best = { agentId: c.agentId, at }
  }
  return best?.agentId ?? target.mainAgentId
}
