import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  isAgentSessionId,
  maskSecrets,
  promptSearchTerms,
  PROMPT_SEARCH_MAX_SESSIONS,
  PROMPT_SEARCH_SNIPPET_MAX,
  PROMPT_SEARCH_SNIPPETS,
  type MonitorEvent,
  type OpenApp,
  type OpenResult,
  type PromptSearchDays,
  type PromptSearchHit,
  type PromptSearchState,
} from '@ccm/shared'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// Slash commands, their local output, `!` shell input / output and injected notices arrive as user records (docs §11af).
const NOT_PROMPT = [
  '<command-name>',
  '<command-message>',
  '<command-args>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<local-command-caveat>',
  '<bash-input>',
  '<bash-stdout>',
  '<bash-stderr>',
  '<task-notification>',
  '<system-reminder>',
  '<user-prompt-submit-hook>',
  '[Request interrupted',
  'Caveat:',
]

/** Text the owner typed, or null for tool results, meta, command, compaction summary and sub-agent records. */
export function promptTextOf(rec: unknown): string | null {
  if (!isObj(rec) || rec.type !== 'user') return null
  if (rec.isSidechain === true || rec.isMeta === true || rec.isCompactSummary === true || rec.isVisibleInTranscriptOnly === true) return null
  if (rec.toolUseResult !== undefined || rec.sourceToolUseID !== undefined) return null
  if (rec.promptSource === 'system') return null
  if (rec.origin !== undefined && (!isObj(rec.origin) || rec.origin.kind !== 'human')) return null
  const message = rec.message
  if (!isObj(message)) return null
  let text: string
  if (typeof message.content === 'string') text = message.content
  else if (Array.isArray(message.content)) {
    const parts: string[] = []
    for (const block of message.content) {
      if (!isObj(block)) continue
      if (block.type === 'tool_result') return null
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    text = parts.join('\n')
  } else return null
  const trimmed = text.trim()
  if (!trimmed || NOT_PROMPT.some((p) => trimmed.startsWith(p))) return null
  return trimmed
}

export const foldText = (s: string): string => s.normalize('NFC').toLowerCase()

export const matchesAll = (folded: string, terms: readonly string[]): boolean => terms.length > 0 && terms.every((t) => folded.includes(t))

/** ≤ max chars around the first match of any term; `text` is already masked, whitespace collapsed. */
export function snippetOf(text: string, terms: readonly string[], max = PROMPT_SEARCH_SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const lower = foldText(flat)
  let at = -1
  if (lower.length === flat.length) {
    for (const t of terms) {
      const i = lower.indexOf(t)
      if (i !== -1 && (at === -1 || i < at)) at = i
    }
  }
  const room = max - 2
  let start = at <= 0 ? 0 : Math.max(0, at - Math.floor(room / 3))
  start = Math.min(start, flat.length - room)
  const end = Math.min(flat.length, start + room)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`.slice(0, max)
}

const sameOrUnder = (dir: string, root: string, win: boolean): boolean => {
  const a = path.resolve(dir)
  const b = path.resolve(root)
  const [x, y] = win ? [a.toLowerCase(), b.toLowerCase()] : [a, b]
  return x === y || x.startsWith(y.endsWith(path.sep) ? y : y + path.sep)
}

/** Claude Code names a project folder after its cwd with every non-alphanumeric char turned into '-'. */
export const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

const NEWLINE = 0x0a
const USER_TYPE = Buffer.from('"type":"user"')
const TOOL_RESULT = Buffer.from('"tool_result"')
const META = Buffer.from('"isMeta":true')
const TITLE_TYPES = [Buffer.from('"type":"custom-title"'), Buffer.from('"type":"ai-title"')]
/** A pasted image makes a prompt line huge; such lines are skipped whole rather than buffered. */
export const MAX_LINE_BYTES = 2 * 1024 * 1024

interface SessionScan {
  cwd?: string
  startedAt?: string
  gitBranch?: string
  customTitle?: string
  aiTitle?: string
  matches: number
  snippets: string[]
}

export interface ScanFileOptions {
  terms: readonly string[]
  mask: (text: string) => string
  cancelled: () => boolean
}

/** Streams one transcript line by line; never keeps prompt text beyond the snippets of matching prompts. */
export async function scanTranscript(file: string, opts: ScanFileOptions): Promise<SessionScan> {
  const out: SessionScan = { matches: 0, snippets: [] }
  let remainder: Buffer = Buffer.alloc(0)
  let skipping = false
  const onLine = (line: Buffer) => {
    const isTitle = TITLE_TYPES.some((t) => line.indexOf(t) !== -1)
    if (!isTitle && (line.indexOf(USER_TYPE) === -1 || line.indexOf(TOOL_RESULT) !== -1 || line.indexOf(META) !== -1)) return
    let rec: unknown
    try {
      rec = JSON.parse(line.toString('utf8'))
    } catch {
      return
    }
    if (!isObj(rec)) return
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string') out.customTitle = rec.customTitle
    if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string') out.aiTitle = rec.aiTitle
    if (rec.type !== 'user') return
    if (out.startedAt === undefined && typeof rec.timestamp === 'string') out.startedAt = rec.timestamp
    if (out.cwd === undefined && typeof rec.cwd === 'string' && rec.cwd) out.cwd = rec.cwd
    if (typeof rec.gitBranch === 'string' && rec.gitBranch && rec.gitBranch !== 'HEAD') out.gitBranch = rec.gitBranch
    const text = promptTextOf(rec)
    if (text === null || !matchesAll(foldText(text), opts.terms)) return
    out.matches++
    if (out.snippets.length < PROMPT_SEARCH_SNIPPETS) out.snippets.push(snippetOf(opts.mask(text), opts.terms))
  }
  const stream = createReadStream(file)
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      if (opts.cancelled()) break
      let data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
      let start = 0
      if (skipping) {
        const nl = data.indexOf(NEWLINE)
        if (nl === -1) {
          remainder = Buffer.alloc(0)
          continue
        }
        skipping = false
        start = nl + 1
      }
      let idx: number
      while ((idx = data.indexOf(NEWLINE, start)) !== -1) {
        if (idx - start <= MAX_LINE_BYTES) onLine(data.subarray(start, idx))
        start = idx + 1
      }
      data = data.subarray(start)
      if (data.length > MAX_LINE_BYTES) {
        skipping = true
        remainder = Buffer.alloc(0)
      } else remainder = Buffer.from(data)
    }
    if (!skipping && remainder.length && !opts.cancelled()) onLine(remainder)
  } finally {
    stream.destroy()
  }
  return out
}

interface Candidate {
  file: string
  sessionId: string
  mtimeMs: number
}

/** Top-level `<project>/<uuid>.jsonl` only: sub-agent transcripts live deeper and never hold owner prompts. */
export async function listTranscripts(projectsDir: string, opts: { sinceMs: number; projectDir?: string }): Promise<Candidate[]> {
  let dirs
  try {
    dirs = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: Candidate[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    if (opts.projectDir && d.name !== opts.projectDir && !d.name.startsWith(`${opts.projectDir}-`)) continue
    const dir = path.join(projectsDir, d.name)
    let files
    try {
      files = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue
      const sessionId = f.name.slice(0, -'.jsonl'.length)
      if (!isAgentSessionId(sessionId)) continue
      const file = path.join(dir, f.name)
      const st = await stat(file).catch(() => null)
      if (!st || st.mtimeMs < opts.sinceMs) continue
      out.push({ file, sessionId, mtimeMs: st.mtimeMs })
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

const isDir = (dir: string): Promise<boolean> => stat(dir).then((s) => s.isDirectory(), () => false)

export interface PromptSearchRequest {
  searchId: string
  query: string
  days: PromptSearchDays
  project: string | null
}

export interface PromptSearcherDeps {
  now?: () => number
  home?: string
  platform?: NodeJS.Platform
  openFolder?: (dir: string, app: OpenApp) => Promise<OpenResult>
  /** Min ms between progress events. */
  progressMs?: number
  yieldFn?: () => Promise<void>
}

interface Running {
  searchId: string
  cancelled: boolean
}

const DAY_MS = 86_400_000

/** One search per client at a time; results' folders are remembered per client so Open folder never takes a path from the page. */
export class PromptSearcher {
  private readonly running = new Map<number, Running>()
  private readonly found = new Map<number, { searchId: string; cwds: Map<string, string> }>()

  constructor(
    private readonly projectsDir: string,
    private readonly deps: PromptSearcherDeps = {},
  ) {}

  async start(clientId: number, req: PromptSearchRequest, reply: (e: MonitorEvent) => void): Promise<PromptSearchState> {
    this.cancel(clientId)
    const run: Running = { searchId: req.searchId, cancelled: false }
    this.running.set(clientId, run)
    const cwds = new Map<string, string>()
    this.found.set(clientId, { searchId: req.searchId, cwds })
    const terms = promptSearchTerms(req.query)
    const now = (this.deps.now ?? Date.now)()
    const platform = this.deps.platform ?? process.platform
    const home = this.deps.home ?? os.homedir()
    const mask = (text: string) => maskSecrets(text, home, platform)
    const yieldFn = this.deps.yieldFn ?? (() => new Promise<void>((r) => setImmediate(r)))
    const progressMs = this.deps.progressMs ?? 250
    let filesDone = 0
    let filesTotal = 0
    let sessions = 0
    let state: PromptSearchState = 'done'
    let pending: PromptSearchHit[] = []
    let sentAt = 0
    const flush = (force: boolean) => {
      const t = (this.deps.now ?? Date.now)()
      if (!force && t - sentAt < progressMs) return
      sentAt = t
      reply({ type: 'promptSearch.progress', payload: { searchId: req.searchId, filesDone, filesTotal, hits: pending } })
      pending = []
    }
    try {
      if (!terms.length) return (state = 'failed')
      const files = await listTranscripts(this.projectsDir, {
        sinceMs: req.days === 0 ? 0 : now - req.days * DAY_MS,
        projectDir: req.project ? projectDirName(req.project) : undefined,
      })
      filesTotal = files.length
      flush(true)
      for (const c of files) {
        if (run.cancelled) break
        const s = await scanTranscript(c.file, { terms, mask, cancelled: () => run.cancelled }).catch(() => null)
        filesDone++
        if (run.cancelled) break
        if (s && s.matches && s.cwd && (!req.project || sameOrUnder(s.cwd, req.project, platform === 'win32'))) {
          const title = s.customTitle ?? s.aiTitle
          pending.push({
            sessionId: c.sessionId,
            cwd: s.cwd,
            cwdExists: await isDir(s.cwd),
            lastAt: new Date(c.mtimeMs).toISOString(),
            matches: s.matches,
            snippets: s.snippets,
            ...(s.startedAt && { startedAt: s.startedAt }),
            ...(s.gitBranch && { gitBranch: s.gitBranch }),
            ...(title && { title: mask(title.replace(/\s+/g, ' ').trim()).slice(0, 120) }),
          })
          cwds.set(c.sessionId, s.cwd)
          sessions++
          if (sessions >= PROMPT_SEARCH_MAX_SESSIONS) {
            state = 'capped'
            break
          }
        }
        flush(false)
        await yieldFn()
      }
      if (run.cancelled) state = 'cancelled'
      return state
    } catch {
      return (state = 'failed')
    } finally {
      if (state !== 'cancelled' && (pending.length || filesTotal)) flush(true)
      if (this.running.get(clientId) === run) this.running.delete(clientId)
      reply({ type: 'promptSearch.done', payload: { searchId: req.searchId, state, filesDone, filesTotal, sessions } })
    }
  }

  cancel(clientId: number, searchId?: string): void {
    const run = this.running.get(clientId)
    if (!run || (searchId !== undefined && run.searchId !== searchId)) return
    run.cancelled = true
    this.running.delete(clientId)
  }

  dropClient(clientId: number): void {
    this.cancel(clientId)
    this.found.delete(clientId)
  }

  async open(clientId: number, searchId: string, sessionId: string, reply: (e: MonitorEvent) => void): Promise<void> {
    const found = this.found.get(clientId)
    const cwd = found?.searchId === searchId ? found.cwds.get(sessionId) : undefined
    const open = this.deps.openFolder
    let result: OpenResult
    if (!cwd) result = 'notFound'
    else if (!open) result = 'unsupported'
    else result = await open(cwd, 'explorer').catch((): OpenResult => 'failed')
    reply({ type: 'promptSearch.openResult', payload: { searchId, sessionId, result } })
  }
}
