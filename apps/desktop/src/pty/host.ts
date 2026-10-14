import { execFile } from 'node:child_process'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { IPty } from '@lydell/node-pty'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  isAgentSessionId,
  isPtyPreset,
  PTY_PROTOCOL_PREFIX,
  type PtyClientMessage,
  type PtyPreset,
  type PtyServerMessage,
  type PtySessionInfo,
  type WorktreeError,
} from '../../../../packages/shared/src/pty'
import { hasGit, isBranchName, isDir, isInside, parseWorktrees, readHeadBranch, runGit, worktreeDest } from './git'
import { ownersOf, readPidTable } from './owners'
import { childEnv, clampDim, presetCommand, taskkillPath } from './presets'

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

interface Session {
  id: string
  preset: PtyPreset
  cwd: string
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
}

const sessions = new Map<string, Session>()

// One bad frame or a dying child must never take every other terminal down with it.
process.on('uncaughtException', (err) => console.error('pty host error:', err))

function tokenOk(candidate: string): boolean {
  if (!TOKEN || !candidate.startsWith(PTY_PROTOCOL_PREFIX)) return false
  const a = Buffer.from(candidate.slice(PTY_PROTOCOL_PREFIX.length))
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
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

function spawn(preset: PtyPreset, cols: number, rows: number, cwd: string, resume?: string): Session {
  const spec = presetCommand(preset, process.platform, process.env, resume)
  const proc = pty.spawn(spec.file, spec.args, { name: 'xterm-256color', cols, rows, cwd, env: childEnv(process.env), useConptyDll: false })
  const s: Session = { id: randomUUID(), preset, cwd, proc, pid: proc.pid, ring: '', pending: [], timer: null, ws: null, exitCode: null, exitedAt: 0, paused: false, branch: null, headWatcher: null }
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
  void trackBranch(s)
  return s
}

// Event driven: git rewrites HEAD (via HEAD.lock rename) on checkout / switch, so watch its folder, not the file.
async function trackBranch(s: Session): Promise<void> {
  const res = await runGit(s.cwd, ['rev-parse', '--absolute-git-dir'], 10_000)
  const gitDir = res.ok ? res.stdout.trim() : ''
  if (!gitDir || !sessions.has(s.id)) return
  const update = (): void => {
    const branch = readHeadBranch(gitDir)
    if (branch === s.branch) return
    s.branch = branch
    send(s.ws, { t: 'branch', branch })
  }
  update()
  let timer: NodeJS.Timeout | null = null
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

// node-pty's kill only ends the shell; agents and their tool processes would survive it on Windows.
function kill(s: Session): void {
  sessions.delete(s.id)
  dropWatcher(s)
  const pid = s.proc.pid || s.pid
  if (IS_WIN && pid && s.exitCode === null) execFile(taskkillPath(process.env), ['/T', '/F', '/PID', String(pid)], { windowsHide: true }, () => undefined)
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
      return send(ws, { t: 'wt.added', path: dest, branch })
    }
    const target = list.find((w) => typeof msg.path === 'string' && path.resolve(w.path) === path.resolve(msg.path))
    if (!target) return wtError(ws, 'unknown')
    if (target.main) return wtError(ws, 'main')
    if ([...sessions.values()].some((s) => s.exitCode === null && isInside(s.cwd, target.path))) return wtError(ws, 'busy')
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
    let s: Session
    try {
      s = spawn(msg.preset, clampDim(msg.cols, 80), clampDim(msg.rows, 24), cwd, msg.resume)
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
  }
  return current
}

const server = http.createServer((_req, res) => res.writeHead(404).end())
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
  [...sessions.values()].map((s) => ({ id: s.id, preset: s.preset, cwd: s.cwd, pid: s.pid, alive: s.exitCode === null }))

function shutdown(): void {
  for (const s of [...sessions.values()]) kill(s)
  // node-pty's ConPTY worker keeps the event loop alive after kill.
  setTimeout(() => process.exit(0), 300)
}

// Exited sessions linger only so a reloading page can still show their last output.
setInterval(() => {
  const now = Date.now()
  for (const s of [...sessions.values()]) if (s.exitCode !== null && !s.ws && now - s.exitedAt > EXITED_TTL_MS) {
      dropWatcher(s)
      sessions.delete(s.id)
    }
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
  process.parentPort.postMessage({ t: 'listening', port: typeof addr === 'object' && addr ? addr.port : 0 })
})

process.parentPort.on('message', ({ data }: { data: unknown }) => {
  if (data === 'census') process.parentPort.postMessage({ t: 'census', sessions: census() })
  else if (data === 'shutdown') shutdown()
})
