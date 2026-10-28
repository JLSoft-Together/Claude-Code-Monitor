import { execFile, execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { IPty } from '@lydell/node-pty'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  cleanPanePrompt,
  isAgentSessionId,
  isPtyPreset,
  PTY_PROTOCOL_PREFIX,
  type PaneOpenRequest,
  type PaneOpenResult,
  type PtyClientMessage,
  type PtyPreset,
  type PtyServerMessage,
  type PtySessionInfo,
  type WorktreeError,
} from '../../../../packages/shared/src/pty'
import { hasGit, isBranchName, isDir, isInside, parseWorktrees, readHeadBranch, runGit, worktreeDest } from './git'
import { copySetupFiles } from './wtCopy'
import { handleMcp, mcpGate, toOpenResult, type OpenArgs, type OpenOutcome } from './mcp'
import { ownersOf, readPidTable } from './owners'
import { childEnv, clampDim, isPaneName, MCP_CONFIG_JSON, presetCommand, taskkillPath } from './presets'
import { writeShellInit } from './shellInit'

// Native module ships outside the bundle (resources/pty in a packaged app), so it is required by path.
const pty = require(process.env.CCM_NODE_PTY || '@lydell/node-pty') as typeof import('@lydell/node-pty')

const TOKEN = process.env.CCM_PTY_TOKEN ?? ''
const ORIGINS = new Set((process.env.CCM_PTY_ORIGINS ?? '').split(',').filter(Boolean))
const IS_WIN = process.platform === 'win32'
const SCROLLBACK_CHARS = 256 * 1024
const FLUSH_MS = 8
const MAX_LIVE = 16
const EXITED_TTL_MS = 30 * 60_000
// Deck's numbers: past ~512 KB unsent the renderer is behind; pausing the PTY lets the agent block instead of us buffering.
const PAUSE_AT = 512 * 1024
const RESUME_AT = 128 * 1024
const INIT_DIR = !IS_WIN && process.env.CCM_PTY_INIT_DIR && writeShellInit(process.env.CCM_PTY_INIT_DIR) ? process.env.CCM_PTY_INIT_DIR : undefined
const MCP_FILE = process.env.CCM_PTY_MCP_CONFIG ?? ''
const MCP_READY = writeMcpConfig(MCP_FILE)
const APP_VERSION = process.env.CCM_APP_VERSION ?? '0'
const BODY_MAX = 64 * 1024
const TICKET_TTL_MS = 60_000
const OPEN_REPLY_MS = 8_000
const OPEN_RATE_MAX = 20
const OPEN_RATE_MS = 60_000
let PORT = 0

interface Session {
  id: string
  preset: PtyPreset
  cwd: string
  /** Folder the shell last reported after a `cd` (validated); preview roots and the branch follow it. */
  liveCwd: string | null
  proc: IPty
  pid: number
  ring: string
  pending: string[]
  timer: NodeJS.Timeout | null
  ws: WebSocket | null
  exitCode: number | null
  exitedAt: number
  paused: boolean
  branch: string | null
  headWatcher: FSWatcher | null
  /** Bumped per folder change so a slow `git rev-parse` for an old folder never wins. */
  branchGen: number
  token: string
  opens: number[]
}

interface Ticket {
  preset: PtyPreset
  cwd: string
  sessionId?: string
  name?: string
  expires: number
}

const sessions = new Map<string, Session>()
const tokens = new Map<string, string>()
const tickets = new Map<string, Ticket>()
const openWaiters = new Map<string, (result: PaneOpenResult) => void>()

// One bad frame or a dying child must never take every other terminal down with it.
process.on('uncaughtException', (err) => console.error('pty host error:', err))

function tokenOk(candidate: string): boolean {
  if (!TOKEN || !candidate.startsWith(PTY_PROTOCOL_PREFIX)) return false
  const a = Buffer.from(candidate.slice(PTY_PROTOCOL_PREFIX.length))
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function writeMcpConfig(file: string): boolean {
  if (!file || !path.isAbsolute(file)) return false
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, MCP_CONFIG_JSON, { mode: 0o600 })
    return true
  } catch (err) {
    console.error('mcp config write failed:', err)
    return false
  }
}

function send(ws: WebSocket | null, msg: PtyServerMessage): void {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg))
}

// UNC paths are refused: a remote share's .claude/settings hooks would run, and Windows would hand it our NTLM hash.
function resolveCwd(cwd: unknown): string | null {
  if (cwd === undefined || cwd === '') return os.homedir()
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || /^[\\/]{2}/.test(cwd)) return null
  try {
    const real = realpathSync(cwd)
    return !/^[\\/]{2}/.test(real) && statSync(real).isDirectory() ? real : null
  } catch {
    return null
  }
}

const liveCount = (): number => [...sessions.values()].filter((s) => s.exitCode === null).length

function flush(s: Session): void {
  if (s.timer) clearTimeout(s.timer)
  s.timer = null
  if (!s.pending.length) return
  const data = s.pending.join('')
  s.pending = []
  const ws = s.ws
  if (ws?.readyState !== 1) return
  ws.send(Buffer.from(data, 'utf8'), { binary: true })
  if (!s.paused && ws.bufferedAmount > PAUSE_AT) {
    s.paused = true
    s.proc.pause()
    const poll = setInterval(() => {
      if (s.ws === ws && ws.readyState === 1 && ws.bufferedAmount > RESUME_AT) return
      clearInterval(poll)
      s.paused = false
      if (s.exitCode === null) s.proc.resume()
    }, 50)
  }
}

function spawn(preset: PtyPreset, cols: number, rows: number, cwd: string, resume?: string, ticket?: Ticket): Session {
  const token = randomBytes(32).toString('hex')
  const spec = presetCommand(preset, process.platform, process.env, resume, INIT_DIR, { sessionId: ticket?.sessionId, name: ticket?.name, mcp: MCP_READY })
  const env = { ...childEnv(process.env), ...spec.env, ORRERY_API: `http://127.0.0.1:${PORT}`, ORRERY_TOKEN: token, ...(MCP_READY ? { ORRERY_MCP_CONFIG: MCP_FILE } : {}) }
  const proc = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols, rows, cwd, env, useConptyDll: false })
  const s: Session = { id: randomUUID(), preset, cwd, liveCwd: null, proc, pid: proc.pid, ring: '', pending: [], timer: null, ws: null, exitCode: null, exitedAt: 0, paused: false, branch: null, headWatcher: null, branchGen: 0, token, opens: [] }
  proc.onData((d) => {
    s.ring += d
    // Amortised trim; a replay may start mid escape sequence, which xterm shrugs off.
    if (s.ring.length > SCROLLBACK_CHARS * 1.5) s.ring = s.ring.slice(-SCROLLBACK_CHARS)
    if (!s.ws) return
    s.pending.push(d)
    s.timer ??= setTimeout(() => flush(s), FLUSH_MS)
  })
  // Flush before announcing exit so the last lines are not lost behind the exit banner.
  proc.onExit(({ exitCode }) => {
    flush(s)
    s.exitCode = exitCode
    s.exitedAt = Date.now()
    tokens.delete(token)
    send(s.ws, { t: 'exit', code: exitCode })
  })
  // ConPTY hands out the pid asynchronously (0 right after spawn).
  if (!s.pid) {
    const started = Date.now()
    const poll = setInterval(() => {
      if (!proc.pid && Date.now() - started < 5000) return
      clearInterval(poll)
      s.pid = proc.pid
      send(s.ws, { t: 'pid', pid: s.pid })
    }, 25)
  }
  sessions.set(s.id, s)
  tokens.set(token, s.id)
  void trackBranch(s, cwd)
  return s
}

// Event driven: git rewrites HEAD (via HEAD.lock rename) on checkout / switch, so watch its folder, not the file.
async function trackBranch(s: Session, dir: string): Promise<void> {
  const gen = ++s.branchGen
  dropWatcher(s)
  const res = await runGit(dir, ['rev-parse', '--absolute-git-dir'], 10_000)
  if (gen !== s.branchGen || !sessions.has(s.id)) return
  const gitDir = res.ok ? res.stdout.trim() : ''
  if (!gitDir) {
    if (s.branch !== null) send(s.ws, { t: 'branch', branch: (s.branch = null) })
    return
  }
  const update = (): void => {
    if (gen !== s.branchGen) return
    const branch = readHeadBranch(gitDir)
    if (branch === s.branch) return
    s.branch = branch
    send(s.ws, { t: 'branch', branch })
  }
  update()
  let timer: NodeJS.Timeout | null = null
  dropWatcher(s)
  try {
    s.headWatcher = watch(gitDir, (_event, file) => {
      if (file !== 'HEAD') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(update, 120)
    })
    s.headWatcher.on('error', () => dropWatcher(s))
  } catch {
    s.headWatcher = null
  }
}

function dropWatcher(s: Session): void {
  try {
    s.headWatcher?.close()
  } catch {
    // already closed
  }
  s.headWatcher = null
}

const treePid = (s: Session): number | null => (IS_WIN && s.exitCode === null ? s.proc.pid || s.pid || null : null)

// node-pty's kill only ends the shell; agents and their tool processes would survive it on Windows.
function kill(s: Session, treeKilled = false): void {
  sessions.delete(s.id)
  tokens.delete(s.token)
  dropWatcher(s)
  const pid = treeKilled ? null : treePid(s)
  if (pid) execFile(taskkillPath(process.env), ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => undefined)
  try {
    s.proc.kill()
  } catch {
    // already gone
  }
}

function attachTo(ws: WebSocket, s: Session, replay: boolean): void {
  if (s.ws && s.ws !== ws) s.ws.close(4000, 'replaced')
  s.ws = ws
  s.pending = []
  send(ws, { t: 'ready', id: s.id, preset: s.preset, pid: s.pid, cwd: s.cwd, replay })
  if (s.liveCwd) send(ws, { t: 'cwd', cwd: s.liveCwd })
  if (replay && s.ring) ws.send(Buffer.from(s.ring, 'utf8'), { binary: true })
  if (s.branch !== null) send(ws, { t: 'branch', branch: s.branch })
  if (s.exitCode !== null) send(ws, { t: 'exit', code: s.exitCode })
}

let pidTable: { at: number; table: Promise<Map<number, number> | null> } | null = null

// One scan serves every pane asking in the same burst; a fresh agent shows up in the next one.
function pidTableNow(): Promise<Map<number, number> | null> {
  if (!pidTable || Date.now() - pidTable.at > 1500) pidTable = { at: Date.now(), table: readPidTable() }
  return pidTable.table
}

async function answerOwners(ws: WebSocket, pids: unknown): Promise<void> {
  const wanted = Array.isArray(pids) ? pids.filter((p): p is number => Number.isInteger(p) && p > 0).slice(0, 64) : []
  const roots = new Map<number, string>()
  for (const s of sessions.values()) if (s.exitCode === null && s.pid) roots.set(s.pid, s.id)
  if (!wanted.length || !roots.size) return send(ws, { t: 'owners', owners: {} })
  const table = await pidTableNow()
  if (!table) return send(ws, { t: 'owners', owners: null })
  send(ws, { t: 'owners', owners: Object.fromEntries([...ownersOf(wanted, roots, table)].map(([pid, id]) => [String(pid), id])) })
}

const wtError = (ws: WebSocket, code: WorktreeError, detail?: string): void =>
  send(ws, { t: 'wt.error', code, detail: detail?.trim().split(/\r?\n/)[0]?.slice(0, 200) })

async function listWorktrees(cwd: string): Promise<ReturnType<typeof parseWorktrees> | null> {
  const res = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  return res.ok ? parseWorktrees(res.stdout) : null
}

let worktreeBusy = false

async function answerWorktree(ws: WebSocket, msg: Extract<PtyClientMessage, { t: 'wt.list' | 'wt.add' | 'wt.remove' }>): Promise<void> {
  if (!hasGit()) return wtError(ws, 'noGit')
  const cwd = resolveCwd(msg.cwd)
  if (!cwd || msg.cwd === undefined || msg.cwd === '') return wtError(ws, 'notRepo')
  const list = await listWorktrees(cwd)
  if (!list?.length) {
    if (msg.t === 'wt.list') return send(ws, { t: 'wt.list', repo: null, worktrees: [] })
    return wtError(ws, 'notRepo')
  }
  const main = list[0]!
  if (msg.t === 'wt.list') return send(ws, { t: 'wt.list', repo: main.path, worktrees: list })
  // One mutation at a time: two adds racing for the same folder would leave git's admin dir half written.
  if (worktreeBusy) return wtError(ws, 'busy')
  worktreeBusy = true
  try {
    if (msg.t === 'wt.add') {
      const branch = typeof msg.branch === 'string' ? msg.branch.trim() : ''
      if (!isBranchName(branch)) return wtError(ws, 'branch')
      if (list.some((w) => w.branch === branch)) return wtError(ws, 'exists', branch)
      const dest = worktreeDest(main.path, branch)
      if (isDir(dest)) return wtError(ws, 'exists', dest)
      const known = await runGit(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
      const args = known.ok ? ['worktree', 'add', '--', dest, branch] : ['worktree', 'add', '-b', branch, '--', dest]
      const res = await runGit(cwd, args, 120_000)
      if (!res.ok) return wtError(ws, 'git', res.stderr)
      const copied = await copySetupFiles(main.path, dest, msg.copy).catch(() => [])
      return send(ws, { t: 'wt.added', path: dest, branch, ...(copied.length ? { copied } : {}) })
    }
    const target = list.find((w) => typeof msg.path === 'string' && path.resolve(w.path) === path.resolve(msg.path))
    if (!target) return wtError(ws, 'unknown')
    if (target.main) return wtError(ws, 'main')
    if ([...sessions.values()].some((s) => s.exitCode === null && (isInside(s.cwd, target.path) || (!!s.liveCwd && isInside(s.liveCwd, target.path))))) return wtError(ws, 'busy')
    if (!target.prunable) {
      const status = await runGit(target.path, ['status', '--porcelain'])
      if (!status.ok) return wtError(ws, 'git', status.stderr)
      if (status.stdout.trim()) return wtError(ws, 'dirty')
    }
    // A prunable entry's folder is already gone; prune only drops git's stale bookkeeping, never files.
    const res = await runGit(cwd, target.prunable ? ['worktree', 'prune'] : ['worktree', 'remove', '--', target.path], 120_000)
    if (!res.ok) return wtError(ws, /modified|untracked|dirty/i.test(res.stderr) ? 'dirty' : 'git', res.stderr)
    return send(ws, { t: 'wt.removed', path: target.path })
  } finally {
    worktreeBusy = false
  }
}

/**
 * The page relays what the shell printed, so it is untrusted: real existing folder only, never a filesystem
 * root (it widens preview roots, like a terminal opened there would).
 */
function reportCwd(ws: WebSocket, s: Session, raw: unknown): void {
  const real = typeof raw === 'string' && raw !== '' ? resolveCwd(raw) : null
  const ok = real && path.parse(real).root !== real ? real : null
  send(ws, { t: 'cwd', cwd: ok })
  if (!ok || ok === (s.liveCwd ?? s.cwd)) return
  s.liveCwd = ok
  void trackBranch(s, ok)
}

function onText(ws: WebSocket, current: Session | null, raw: string): Session | null {
  let msg: PtyClientMessage
  try {
    msg = JSON.parse(raw) as PtyClientMessage
  } catch {
    return current
  }
  if (!msg || typeof msg !== 'object') return current
  if (msg.t === 'wt.list' || msg.t === 'wt.add' || msg.t === 'wt.remove') {
    void answerWorktree(ws, msg)
    return current
  }
  if (msg.t === 'owners') {
    void answerOwners(ws, msg.pids)
    return current
  }
  if (msg.t === 'kill' && typeof msg.id === 'string') {
    const target = sessions.get(msg.id)
    if (target) kill(target)
    return target === current ? null : current
  }
  if (msg.t === 'spawn' && !current) {
    if (!isPtyPreset(msg.preset)) return send(ws, { t: 'error', message: 'preset' }), null
    const cwd = resolveCwd(msg.cwd)
    if (!cwd) return send(ws, { t: 'error', message: 'cwd' }), null
    if (liveCount() >= MAX_LIVE) return send(ws, { t: 'error', message: 'limit' }), null
    if (msg.resume !== undefined && (msg.preset === 'shell' || !isAgentSessionId(msg.resume))) return send(ws, { t: 'error', message: 'preset' }), null
    const ticket = typeof msg.open === 'string' ? takeTicket(msg.open, msg.preset) : undefined
    let s: Session
    try {
      s = spawn(msg.preset, clampDim(msg.cols, 80), clampDim(msg.rows, 24), cwd, msg.resume, ticket)
    } catch (err) {
      console.error('spawn failed:', err)
      return send(ws, { t: 'error', message: 'spawn' }), null
    }
    attachTo(ws, s, false)
    return s
  }
  if (msg.t === 'attach' && !current) {
    const s = sessions.get(String(msg.id))
    if (!s) return send(ws, { t: 'gone' }), null
    attachTo(ws, s, true)
    return s
  }
  if (!current) return null
  if (msg.t === 'resize' && current.exitCode === null) {
    try {
      current.proc.resize(clampDim(msg.cols, 80), clampDim(msg.rows, 24))
    } catch {
      // process exited between the check and the call
    }
  } else if (msg.t === 'kill') {
    kill(current)
    return null
  } else if (msg.t === 'cwd') {
    reportCwd(ws, current, msg.cwd)
  }
  return current
}

function takeTicket(id: string, preset: PtyPreset): Ticket | undefined {
  const ticket = tickets.get(id)
  if (!ticket || ticket.preset !== preset) return undefined
  tickets.delete(id)
  return ticket.expires > Date.now() ? ticket : undefined
}

function sweepTickets(now: number): void {
  for (const [id, ticket] of tickets) if (ticket.expires <= now) tickets.delete(id)
}

function askPage(req: PaneOpenRequest): Promise<PaneOpenResult> {
  return new Promise((resolve) => {
    const done = (result: PaneOpenResult): void => {
      clearTimeout(timer)
      openWaiters.delete(req.id)
      resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'unavailable' }), OPEN_REPLY_MS)
    openWaiters.set(req.id, done)
    process.parentPort.postMessage({ t: 'open', req })
  })
}

async function openFrom(s: Session, args: OpenArgs): Promise<OpenOutcome> {
  const preset = args.agent ?? 'claude'
  if (!isPtyPreset(preset)) return { ok: false, error: 'preset' }
  const asked = args.cwd
  const cwd = asked === undefined || asked === null ? resolveCwd(s.liveCwd ?? s.cwd) : typeof asked === 'string' && path.isAbsolute(asked) ? resolveCwd(asked) : null
  if (!cwd) return { ok: false, error: 'cwd' }
  const resume = args.resume === undefined || args.resume === null || args.resume === '' ? undefined : args.resume
  if (resume !== undefined && (preset === 'shell' || !isAgentSessionId(resume))) return { ok: false, error: 'resume' }
  const now = Date.now()
  s.opens = s.opens.filter((t) => now - t < OPEN_RATE_MS)
  if (s.opens.length >= OPEN_RATE_MAX) return { ok: false, error: 'rate' }
  sweepTickets(now)
  if (liveCount() + tickets.size >= MAX_LIVE) return { ok: false, error: 'limit' }
  const prompt = preset === 'shell' ? undefined : cleanPanePrompt(args.prompt)
  const name = preset === 'claude' && isPaneName(args.name) ? args.name : undefined
  const sessionId = resume ?? (preset === 'claude' ? randomUUID() : undefined)
  const id = randomUUID()
  tickets.set(id, { preset, cwd, sessionId: resume ? undefined : sessionId, name: resume ? undefined : name, expires: now + TICKET_TTL_MS })
  s.opens.push(now)
  const result = await askPage({ id, from: s.id, preset, cwd, prompt, resume })
  if (result.ok) return { ok: true, preset, cwd, sessionId, prompt: !!prompt, ...(resume ? { resumed: true } : {}) }
  tickets.delete(id)
  const at = s.opens.indexOf(now)
  if (at >= 0) s.opens.splice(at, 1)
  return { ok: false, error: result.error }
}

function readBody(req: http.IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_MAX) resolve(null)
      else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

const replyJson = (res: http.ServerResponse, status: number, json: unknown): void =>
  void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json))

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const gate = mcpGate({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization }, PORT)
  if ('status' in gate) return void res.writeHead(gate.status, gate.allow ? { Allow: gate.allow } : {}).end()
  const id = tokens.get(gate.token)
  const caller = id ? sessions.get(id) : undefined
  if (!caller || caller.exitCode !== null) return void res.writeHead(401).end()
  if (Number(req.headers['content-length'] ?? 0) > BODY_MAX) return void res.writeHead(413, { Connection: 'close' }).end()
  const raw = await readBody(req)
  if (raw === null) return void res.writeHead(413, { Connection: 'close' }).end()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return replyJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  const out = await handleMcp(body, (args) => openFrom(caller, args), APP_VERSION)
  if (out.json === undefined) res.writeHead(out.status).end()
  else replyJson(res, out.status, out.json)
}

const server = http.createServer((req, res) => {
  onRequest(req, res).catch((err: unknown) => {
    console.error('mcp request failed:', err)
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})
const wss = new WebSocketServer({
  server,
  path: '/pty',
  maxPayload: 1024 * 1024,
  handleProtocols: (protocols) => [...protocols].find(tokenOk) ?? false,
  verifyClient: ({ req }: { req: http.IncomingMessage }) => {
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '')) return false
    if (!ORIGINS.has(req.headers.origin ?? '')) return false
    const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim())
    return offered.some(tokenOk)
  },
})
wss.on('error', (err) => console.error('pty ws server error:', err))

wss.on('connection', (ws) => {
  let s: Session | null = null
  ws.on('error', () => ws.terminate())
  ws.on('message', (raw: Buffer, isBinary: boolean) => {
    if (isBinary) {
      if (s && s.exitCode === null) {
        try {
          s.proc.write(raw)
        } catch {
          // process exited between the check and the call
        }
      }
      return
    }
    s = onText(ws, s, raw.toString('utf8'))
  })
  ws.on('close', () => {
    for (const session of sessions.values()) if (session.ws === ws) session.ws = null
  })
})

const census = (): PtySessionInfo[] =>
  [...sessions.values()].map((s) => ({ id: s.id, preset: s.preset, cwd: s.cwd, liveCwd: s.liveCwd ?? undefined, pid: s.pid, alive: s.exitCode === null }))

// Sync: the process exits right after, and an async taskkill still pending then would never run (orphaned agents).
function shutdown(): void {
  const all = [...sessions.values()]
  const pids = all.map(treePid).filter((p): p is number => p !== null)
  if (pids.length) {
    try {
      execFileSync(taskkillPath(process.env), ['/T', '/F', ...pids.flatMap((p) => ['/PID', String(p)])], { windowsHide: true, timeout: 2_500, stdio: 'ignore' })
    } catch {
      // some trees already gone (exit 128) or timeout; node-pty kill below still ends the shells
    }
  }
  for (const s of all) kill(s, true)
  // node-pty's ConPTY worker keeps the event loop alive after kill.
  setTimeout(() => process.exit(0), 300)
}

// Exited sessions linger only so a reloading page can still show their last output.
setInterval(() => {
  const now = Date.now()
  for (const s of [...sessions.values()]) if (s.exitCode !== null && !s.ws && now - s.exitedAt > EXITED_TTL_MS) {
      dropWatcher(s)
      sessions.delete(s.id)
      tokens.delete(s.token)
    }
  sweepTickets(now)
}, 60_000).unref()

// If Electron dies without a clean shutdown, don't leave shells (and agents) running headless.
const parentPid = process.ppid
setInterval(() => {
  try {
    process.kill(parentPid, 0)
  } catch {
    shutdown()
  }
}, 5_000).unref()

server.listen(0, '127.0.0.1', () => {
  const addr = server.address()
  PORT = typeof addr === 'object' && addr ? addr.port : 0
  process.parentPort.postMessage({ t: 'listening', port: PORT })
})

process.parentPort.on('message', ({ data }: { data: unknown }) => {
  if (data === 'census') process.parentPort.postMessage({ t: 'census', sessions: census() })
  else if (data === 'shutdown') shutdown()
  else if (data && typeof data === 'object' && (data as { t?: unknown }).t === 'open-reply') {
    const { id, result } = data as { id?: unknown; result?: unknown }
    const parsed = toOpenResult(result)
    if (typeof id === 'string' && parsed) openWaiters.get(id)?.(parsed)
  }
})
