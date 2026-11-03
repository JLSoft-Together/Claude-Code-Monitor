import path from 'node:path'
import { normalizeDir } from '../codex/link'
import { listProcessesNamed, splitArgs, topLevel, type CliProcess } from '../codex/processes'

export interface DeepseekProcess {
  pid: number
  start: number
  ancestors: number[]
  /** Absolute `-C` / `--workspace` value; the rest of the command line is never kept (a PROMPT can be an argument). */
  workspace?: string
  /** `-r` / `--resume` / `--session-id` value: an id or a unique prefix. */
  resumeId?: string
}

// The npm wrapper runs `node_modules/codewhale/bin/downloads/codewhale.exe`, so its exe name is the same.
const WIN_EXE = ['codewhale.exe', 'codewhale-windows-x64.exe', 'codew.exe']
// Linux truncates `comm` to 15 characters.
const UNIX_NAMES = ['codewhale', 'codew', 'codewhale-linux', 'codewhale-macos', 'codewhale-darwi']
const VALUE_FLAGS = new Set(['-C', '--workspace', '-r', '--resume', '--session-id', '-m', '--model', '-p', '--provider', '--profile', '-c', '--config', '--output-format'])
// Commands that never open a session.
const NON_SESSION = new Set(['auth', 'config', 'mcp', 'doctor', 'login', 'logout', 'help', 'completion', 'completions', 'update', 'upgrade', 'version', 'models', 'telemetry'])
const isAbsolutePath = (p: string): boolean => path.win32.isAbsolute(p) || path.posix.isAbsolute(p)
const RESUME_ID = /^[A-Za-z0-9._:-]{1,128}$/

/** Session-bearing processes only; null for `codewhale auth …` and other one-shot commands. */
export function parseCodewhaleArgs(cmd: string): { workspace?: string; resumeId?: string } | null {
  const args = splitArgs(cmd).slice(1)
  let workspace: string | undefined
  let resumeId: string | undefined
  let first: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--') break
    if (a.startsWith('-')) {
      const eq = a.indexOf('=')
      const flag = eq > 0 ? a.slice(0, eq) : a
      const value = eq > 0 ? a.slice(eq + 1) : VALUE_FLAGS.has(a) ? args[++i] : undefined
      if ((flag === '-C' || flag === '--workspace') && value && isAbsolutePath(value)) workspace = value
      if ((flag === '-r' || flag === '--resume' || flag === '--session-id') && value && RESUME_ID.test(value)) resumeId = value
      continue
    }
    first ??= a
  }
  if (first && NON_SESSION.has(first)) return null
  return { workspace, resumeId }
}

export function toDeepseekProcesses(rows: CliProcess[]): DeepseekProcess[] {
  const out: DeepseekProcess[] = []
  for (const { cmd, orphan: _orphan, ...p } of topLevel(rows)) {
    const parsed = parseCodewhaleArgs(cmd)
    if (parsed) out.push({ ...p, ...parsed })
  }
  return out
}

export async function listDeepseekProcesses(platform: NodeJS.Platform = process.platform): Promise<DeepseekProcess[] | null> {
  const rows = await listProcessesNamed({ win: WIN_EXE, unix: UNIX_NAMES }, platform)
  return rows && toDeepseekProcesses(rows)
}

export interface DeepseekThreadKey {
  id: string
  workspace?: string
  /** `session_start` time, else the first event seen (ms). */
  startedAt: number
  pid?: number
  start?: number
}

const BEFORE_START_MS = 2_000
const AFTER_START_MS = 120_000

/**
 * One process per session. Codewhale keeps no pid registry, so a session belongs to the process that resumes it by
 * id, else one launched with its workspace, else the one started right before its `session_start`; a lone process
 * started before an unmatched session (its start fell outside the tail read) takes it last.
 */
export function matchDeepseekProcesses(threads: DeepseekThreadKey[], procs: DeepseekProcess[], platform: NodeJS.Platform = process.platform): Map<string, DeepseekProcess> {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const result = new Map<string, DeepseekProcess>()
  const taken = new Set<number>()
  const claim = (t: DeepseekThreadKey, p: DeepseekProcess) => {
    result.set(t.id, p)
    taken.add(p.pid)
  }
  const open: DeepseekThreadKey[] = []
  for (const t of threads) {
    const kept = t.pid !== undefined ? byPid.get(t.pid) : undefined
    if (kept && kept.start === t.start && !taken.has(kept.pid)) claim(t, kept)
    else open.push(t)
  }
  for (const t of [...open]) {
    const p = procs.find((x) => !taken.has(x.pid) && x.resumeId && t.id.startsWith(x.resumeId))
    if (p) {
      claim(t, p)
      open.splice(open.indexOf(t), 1)
    }
  }
  const sameDir = (t: DeepseekThreadKey, p: DeepseekProcess) => !!p.workspace && !!t.workspace && normalizeDir(p.workspace, platform) === normalizeDir(t.workspace, platform)
  const greedy = (fits: (t: DeepseekThreadKey, p: DeepseekProcess, gap: number) => boolean) => {
    const pairs: { t: DeepseekThreadKey; p: DeepseekProcess; gap: number }[] = []
    for (const t of open) {
      if (result.has(t.id)) continue
      for (const p of procs) {
        const gap = t.startedAt - p.start
        if (!taken.has(p.pid) && fits(t, p, gap)) pairs.push({ t, p, gap: Math.abs(gap) })
      }
    }
    pairs.sort((a, b) => a.gap - b.gap)
    for (const { t, p } of pairs) if (!result.has(t.id) && !taken.has(p.pid)) claim(t, p)
  }
  greedy((t, p, gap) => sameDir(t, p) && gap >= -BEFORE_START_MS)
  greedy((t, p, gap) => (!p.workspace || sameDir(t, p)) && gap >= -BEFORE_START_MS && gap <= AFTER_START_MS)
  for (const t of open) {
    if (result.has(t.id)) continue
    const candidates = procs.filter((p) => !taken.has(p.pid) && (!p.workspace || sameDir(t, p)) && p.start <= t.startedAt + BEFORE_START_MS)
    if (candidates.length === 1) claim(t, candidates[0]!)
  }
  return result
}
