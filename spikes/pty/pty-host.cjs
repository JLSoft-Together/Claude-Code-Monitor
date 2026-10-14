// Runs in Electron utilityProcess (same place the real collector lives).
const crypto = require('node:crypto')
const os = require('node:os')
const http = require('node:http')
const pty = require('@lydell/node-pty')
const { WebSocketServer } = require('ws')

const TOKEN = process.env.CCM_SPIKE_TOKEN
const PROTO_PREFIX = 'ccm.pty.'
const SCROLLBACK_BYTES = 256 * 1024
const FLUSH_MS = 8
const IS_WIN = process.platform === 'win32'

const ALLOWED_ORIGINS = new Set(['file://', 'null', undefined])

function tokenOk(candidate) {
  if (typeof candidate !== 'string' || !candidate.startsWith(PROTO_PREFIX)) return false
  const a = Buffer.from(candidate.slice(PROTO_PREFIX.length))
  const b = Buffer.from(TOKEN)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Fixed presets only: the client picks a key, never a command string.
function presetCommand(preset) {
  const shell = IS_WIN ? 'powershell.exe' : process.env.SHELL || '/bin/zsh'
  const shellArgs = IS_WIN ? ['-NoLogo'] : ['-l']
  // npm-installed agents are .cmd shims on Windows → need cmd.exe; mac/linux go through a login shell for PATH.
  const agent = (bin) => (IS_WIN ? ['cmd.exe', ['/d', '/c', bin]] : [shell, ['-l', '-c', `exec ${bin}`]])
  switch (preset) {
    case 'claude': return agent('claude')
    case 'codex': return agent('codex')
    default: return [shell, shellArgs]
  }
}

const sessions = new Map()

function createSession(preset, cols, rows, cwd) {
  const [file, args] = presetCommand(preset)
  const { ELECTRON_RUN_AS_NODE: _, CCM_SPIKE_TOKEN: __, ...env } = process.env
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols, rows,
    cwd: cwd || os.homedir(),
    env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    useConptyDll: false,
  })
  const s = { id: crypto.randomUUID(), preset, pty: p, chunks: [], size: 0, ws: null, pending: [], timer: null, exited: null }
  p.onData((d) => {
    s.chunks.push(d)
    s.size += d.length
    while (s.size > SCROLLBACK_BYTES && s.chunks.length > 1) s.size -= s.chunks.shift().length
    s.pending.push(d)
    if (!s.timer) s.timer = setTimeout(() => flush(s), FLUSH_MS)
  })
  p.onExit(({ exitCode }) => {
    flush(s)
    s.exited = exitCode
    send(s.ws, { t: 'exit', code: exitCode })
  })
  // ConPTY reports pid asynchronously (0 right after spawn).
  const started = Date.now()
  const pidTimer = setInterval(() => {
    if (p.pid || Date.now() - started > 5000) {
      clearInterval(pidTimer)
      s.pid = p.pid
      send(s.ws, { t: 'pid', pid: p.pid, afterMs: Date.now() - started })
    }
  }, 25)
  sessions.set(s.id, s)
  return s
}

function flush(s) {
  clearTimeout(s.timer)
  s.timer = null
  if (!s.pending.length) return
  const data = s.pending.join('')
  s.pending = []
  if (s.ws && s.ws.readyState === 1) s.ws.send(Buffer.from(data, 'utf8'), { binary: true })
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
}

const server = http.createServer((_, res) => { res.writeHead(404).end() })
const wss = new WebSocketServer({
  server,
  path: '/pty',
  maxPayload: 1024 * 1024,
  handleProtocols: (protocols) => [...protocols].find(tokenOk) ?? false,
  verifyClient: ({ req }) => {
    const host = req.headers.host || ''
    if (!/^127\.0\.0\.1:\d+$/.test(host)) return false
    if (!ALLOWED_ORIGINS.has(req.headers.origin)) return false
    const offered = (req.headers['sec-websocket-protocol'] || '').split(',').map((x) => x.trim())
    return offered.some(tokenOk)
  },
})

wss.on('connection', (ws) => {
  let s = null
  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (s && s.exited === null) s.pty.write(raw.toString('utf8'))
      return
    }
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg.t === 'spawn' && !s) {
      s = createSession(String(msg.preset), clampDim(msg.cols, 80), clampDim(msg.rows, 24), undefined)
      s.ws = ws
      send(ws, { t: 'ready', id: s.id, pid: s.pty.pid, preset: s.preset })
    } else if (msg.t === 'attach' && !s) {
      const found = sessions.get(String(msg.id))
      if (!found) return send(ws, { t: 'gone' })
      s = found
      if (s.ws && s.ws !== ws) s.ws.close(4000, 'replaced')
      s.ws = ws
      send(ws, { t: 'ready', id: s.id, pid: s.pty.pid, preset: s.preset, replay: true })
      ws.send(Buffer.from(s.chunks.join(''), 'utf8'), { binary: true })
      if (s.exited !== null) send(ws, { t: 'exit', code: s.exited })
    } else if (msg.t === 'resize' && s && s.exited === null) {
      s.pty.resize(clampDim(msg.cols, 80), clampDim(msg.rows, 24))
    } else if (msg.t === 'kill' && s) {
      killSession(s)
    }
  })
  ws.on('close', () => { if (s && s.ws === ws) s.ws = null })
})

function clampDim(v, fallback) {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback
}

function killSession(s) {
  try { s.pty.kill() } catch {}
  sessions.delete(s.id)
}

server.listen(0, '127.0.0.1', () => {
  process.parentPort.postMessage({ t: 'listening', port: server.address().port })
})

process.parentPort.on('message', ({ data }) => {
  if (data === 'shutdown') {
    for (const s of sessions.values()) killSession(s)
    // node-pty's ConPTY worker keeps the loop alive after kill; exit explicitly.
    setTimeout(() => process.exit(0), 200)
  }
})
