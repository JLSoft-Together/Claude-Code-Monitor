#!/usr/bin/env node
// One-click launcher: install → build → start collector, with a local setup page showing progress.
// Zero dependencies on purpose: it must run before `npm install`.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_PORT = Number.parseInt(process.env.CCM_PORT ?? '', 10) || 4317
const SETUP_PORT = 4316
const APP_URL = `http://127.0.0.1:${APP_PORT}`
const NO_OPEN = process.argv.includes('--no-open')
const LOG_LIMIT = 400
const IS_WIN = process.platform === 'win32'
const LNK_NAME = 'Claude-Code-Monitor.lnk'
const SHORTCUT_KINDS = { desktop: { args: '', style: '1' }, startup: { args: '--no-open', style: '7' } }

const steps = [
  { id: 'node', status: 'pending', detail: '' },
  { id: 'deps', status: 'pending', detail: '' },
  { id: 'build', status: 'pending', detail: '' },
  { id: 'start', status: 'pending', detail: '' },
]
let phase = 'running' // running | ready | error
let error = ''
const logs = []
const clients = new Set()
let collector = null
let running = false

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) res.write(frame)
}

let folders = null
const shortcutPath = (kind) => (folders?.[kind] ? path.join(folders[kind], LNK_NAME) : null)
const shortcuts = () =>
  folders ? Object.fromEntries(Object.keys(SHORTCUT_KINDS).map((k) => [k, existsSync(shortcutPath(k) ?? '')])) : null
const state = () => ({ steps, phase, error, appUrl: APP_URL, shortcuts: shortcuts() })
const pushState = () => broadcast('state', state())

function log(line) {
  const text = line.replace(/\x1b\[[0-9;]*m/g, '').trimEnd()
  if (!text) return
  logs.push(text)
  if (logs.length > LOG_LIMIT) logs.shift()
  process.stdout.write(`${text}\n`)
  broadcast('log', text)
}

function setStep(id, status, detail = '') {
  const step = steps.find((s) => s.id === id)
  step.status = status
  step.detail = detail
  pushState()
}

function run(cmd, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    log(`> ${path.basename(cmd)} ${args.join(' ')}`)
    const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0' }, windowsHide: true })
    const onData = (buf) => String(buf).split(/\r?\n/).forEach(log)
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with code ${code}`))))
  })
}

function npm(args) {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(cli)) return run(process.execPath, [cli, ...args])
  // npm.cmd cannot be spawned without a shell since the Node 20 CVE-2024-27980 fix.
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd: ROOT, shell: true, windowsHide: true })
    child.stdout.on('data', (b) => String(b).split(/\r?\n/).forEach(log))
    child.stderr.on('data', (b) => String(b).split(/\r?\n/).forEach(log))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`npm exited with code ${code}`))))
  })
}

const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0)

function newest(p) {
  if (!existsSync(p)) return 0
  const st = statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  let max = st.mtimeMs
  for (const name of readdirSync(p)) max = Math.max(max, newest(path.join(p, name)))
  return max
}

async function health() {
  try {
    const res = await fetch(`${APP_URL}/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

function nodeSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23
}

async function stepNode() {
  setStep('node', 'running')
  if (!nodeSupported()) throw new Error(`Node ${process.versions.node} is too old — install Node 22 LTS from https://nodejs.org`)
  setStep('node', 'done', `v${process.versions.node}`)
}

async function stepDeps() {
  setStep('deps', 'running')
  const marker = path.join(ROOT, 'node_modules', '.package-lock.json')
  const lock = path.join(ROOT, 'package-lock.json')
  if (existsSync(marker) && mtime(marker) >= mtime(lock)) return setStep('deps', 'skipped')
  await npm(['install', '--no-audit', '--no-fund'])
  setStep('deps', 'done')
}

async function stepBuild() {
  setStep('build', 'running')
  const web = path.join(ROOT, 'apps', 'web')
  const built = mtime(path.join(web, 'dist', 'index.html'))
  const sources = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json'].map((p) => path.join(web, p))
  sources.push(path.join(ROOT, 'packages', 'shared', 'src'))
  if (built && Math.max(...sources.map(newest)) <= built) return setStep('build', 'skipped')
  await run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], web)
  setStep('build', 'done')
}

async function stepStart() {
  setStep('start', 'running')
  if (await health()) return setStep('start', 'skipped', APP_URL)
  const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  collector = spawn(process.execPath, [tsx, path.join('apps', 'collector', 'src', 'index.ts')], {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
    windowsHide: true,
  })
  let exited = null
  collector.stdout.on('data', (b) => String(b).split(/\r?\n/).forEach(log))
  collector.stderr.on('data', (b) => String(b).split(/\r?\n/).forEach(log))
  collector.on('close', (code) => {
    exited = code
    collector = null
    if (phase === 'ready') {
      log(`collector stopped (code ${code})`)
      phase = 'error'
      error = `collector stopped (code ${code})`
      setStep('start', 'error')
    }
  })
  for (let i = 0; i < 120; i++) {
    if (exited !== null) throw new Error(`collector exited with code ${exited} — is port ${APP_PORT} already in use?`)
    if (await health()) return setStep('start', 'done', APP_URL)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('collector did not respond within 60 s')
}

async function pipeline() {
  if (running) return
  running = true
  phase = 'running'
  error = ''
  for (const s of steps) if (s.status !== 'done' && s.status !== 'skipped') s.status = 'pending'
  pushState()
  let current = null
  try {
    for (const [id, fn] of [['node', stepNode], ['deps', stepDeps], ['build', stepBuild], ['start', stepStart]]) {
      current = id
      const step = steps.find((s) => s.id === id)
      if (step.status === 'done' || step.status === 'skipped') continue
      await fn()
    }
    phase = 'ready'
    pushState()
    log(`Dashboard: ${APP_URL}`)
    if (!collector) setTimeout(() => process.exit(0), 5000)
    else log('Keep this window open — closing it stops the monitor.')
  } catch (err) {
    phase = 'error'
    error = err instanceof Error ? err.message : String(err)
    log(`ERROR: ${error}`)
    if (current) setStep(current, 'error')
    else pushState()
  } finally {
    running = false
  }
}

// Paths travel through env vars so nothing is spliced into the PowerShell source.
const SHORTCUT_PS = [
  "if ($env:CCM_LNK_ACTION -eq 'folders') { @{ desktop = [Environment]::GetFolderPath('Desktop'); startup = [Environment]::GetFolderPath('Startup') } | ConvertTo-Json -Compress; exit }",
  '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:CCM_LNK_PATH)',
  '$s.TargetPath = $env:CCM_LNK_TARGET; $s.Arguments = $env:CCM_LNK_ARGS; $s.WorkingDirectory = $env:CCM_LNK_DIR',
  "$s.IconLocation = $env:CCM_LNK_ICON + ',0'; $s.Description = 'Claude Code Monitor'; $s.WindowStyle = [int]$env:CCM_LNK_STYLE; $s.Save()",
].join('\n')

function powershell(env) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SHORTCUT_PS], {
      env: { ...process.env, ...env },
      windowsHide: true,
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (b) => (out += b))
    child.stderr.on('data', (b) => (err += b))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `powershell exited with code ${code}`))))
  })
}

function createShortcut(file, { args, style }) {
  return powershell({
    CCM_LNK_ACTION: 'create',
    CCM_LNK_PATH: file,
    CCM_LNK_TARGET: path.join(ROOT, 'Claude-Code-Monitor.bat'),
    CCM_LNK_ARGS: args,
    CCM_LNK_DIR: ROOT,
    CCM_LNK_ICON: path.join(ROOT, 'scripts', 'assets', 'ccm.ico'),
    CCM_LNK_STYLE: style,
  })
}

const errText = (err) => (err instanceof Error ? err.message : String(err))

async function initShortcuts() {
  if (!IS_WIN) return
  try {
    const local = path.join(ROOT, LNK_NAME)
    if (!existsSync(local)) await createShortcut(local, SHORTCUT_KINDS.desktop)
    folders = JSON.parse(await powershell({ CCM_LNK_ACTION: 'folders' }))
    pushState()
  } catch (err) {
    log(`shortcut: ${errText(err)}`)
  }
}

async function setShortcut(kind, on) {
  const file = shortcutPath(kind)
  if (!file) return
  try {
    if (on) await createShortcut(file, SHORTCUT_KINDS[kind])
    else if (existsSync(file)) unlinkSync(file)
    log(`${on ? 'Created' : 'Removed'} ${file}`)
  } catch (err) {
    log(`shortcut: ${errText(err)}`)
  }
  pushState()
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const isLocal = (req) => LOCAL_HOSTS.has(String(req.headers.host ?? '').replace(/:\d+$/, ''))

function openBrowser(url) {
  if (NO_OPEN) return
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

const server = createServer((req, res) => {
  if (!isLocal(req)) return res.writeHead(403).end()
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(`event: init\ndata: ${JSON.stringify({ ...state(), logs })}\n\n`)
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  // The custom header forces a CORS preflight, so other sites cannot trigger a retry.
  if (url.pathname === '/retry' && req.method === 'POST' && req.headers['x-ccm-setup'] === '1') {
    void pipeline()
    return res.writeHead(204).end()
  }
  const kind = url.searchParams.get('kind')
  if (url.pathname === '/shortcut' && req.method === 'POST' && req.headers['x-ccm-setup'] === '1' && Object.hasOwn(SHORTCUT_KINDS, kind)) {
    void setShortcut(kind, url.searchParams.get('on') === '1')
    return res.writeHead(204).end()
  }
  if (url.pathname === '/' && req.method === 'GET') {
    return res
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      .end(PAGE)
  }
  res.writeHead(404).end()
})

function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && port !== 0) listen(0)
    else throw err
  })
  server.listen(port, '127.0.0.1', () => {
    const setupUrl = `http://127.0.0.1:${server.address().port}`
    console.log(`Claude Code Monitor setup: ${setupUrl}`)
    openBrowser(setupUrl)
    void pipeline()
    void initShortcuts()
  })
}

function shutdown() {
  if (collector) collector.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Claude Code Monitor · Setup</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
:root {
  --canvas: #f4f4f2; --surface: #ffffff; --raised: #fafaf8; --line: #e3e2dd;
  --ink: #1b1b19; --muted: #5f5e58; --faint: #75736b;
  --accent: #b4532f; --accent-soft: #f6e6de; --on-accent: #ffffff;
  --done: #3f7a3b; --error: #c0322a; --error-soft: #f8dfdc;
  color-scheme: light;
}
:root.dark {
  --canvas: #121211; --surface: #1a1a19; --raised: #222220; --line: #2e2d2a;
  --ink: #ecebe6; --muted: #a7a59d; --faint: #8a887f;
  --accent: #e08a68; --accent-soft: #3a261d; --on-accent: #121211;
  --done: #8fbf89; --error: #f0716a; --error-soft: #3d1d1b;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; overflow-x: hidden; }
body {
  min-height: 100dvh; background: var(--canvas); color: var(--ink);
  font: 15px/1.5 "Google Sans", "Google Sans Text", system-ui, sans-serif;
  display: grid; place-items: center; padding: 24px 16px;
}
main { width: 100%; max-width: 560px; }
header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
header svg { width: 40px; height: 40px; flex: none; }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
.sub { margin: 0; color: var(--muted); font-size: 14px; }
.theme {
  margin-left: auto; width: 40px; height: 40px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--muted); cursor: pointer; display: grid; place-items: center;
}
.theme:hover { color: var(--ink); }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 8px; }
ol { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 28px 1fr auto; gap: 12px; align-items: center; padding: 12px; border-radius: 10px; }
li[data-status="running"] { background: var(--raised); }
.icon { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--line); color: var(--faint); font-size: 12px; font-weight: 600; }
li[data-status="running"] .icon { border-color: var(--accent); color: var(--accent); }
li[data-status="done"] .icon, li[data-status="skipped"] .icon { border-color: var(--done); background: var(--done); color: var(--surface); }
li[data-status="error"] .icon { border-color: var(--error); background: var(--error); color: var(--surface); }
.label { font-weight: 500; }
.hint { color: var(--faint); font-size: 13px; overflow-wrap: anywhere; }
.status { font-size: 13px; color: var(--faint); white-space: nowrap; }
li[data-status="running"] .status { color: var(--accent); }
li[data-status="done"] .status, li[data-status="skipped"] .status { color: var(--done); }
li[data-status="error"] .status { color: var(--error); }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--accent-soft); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.banner { margin-top: 16px; padding: 14px 16px; border-radius: 12px; display: none; gap: 12px; align-items: center; flex-wrap: wrap; }
.banner.show { display: flex; }
.banner.ok { background: var(--accent-soft); }
.banner.err { background: var(--error-soft); color: var(--ink); }
.banner p { margin: 0; flex: 1 1 240px; }
.banner strong { display: block; }
button.primary {
  height: 40px; padding: 0 16px; border-radius: 10px; border: 0; cursor: pointer;
  background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600;
}
button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
details { margin-top: 16px; }
summary { cursor: pointer; color: var(--muted); font-size: 14px; padding: 6px 0; }
pre {
  margin: 8px 0 0; max-height: 280px; overflow: auto; padding: 12px; border-radius: 10px;
  background: var(--surface); border: 1px solid var(--line); color: var(--muted);
  font: 12px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere;
}
.links { margin-top: 16px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface); display: none; }
.links.show { display: block; }
.links h2 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.links p { margin: 0 0 10px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.links label { display: flex; align-items: center; gap: 10px; min-height: 36px; cursor: pointer; }
.links input { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; flex: none; }
.links input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.foot { margin-top: 16px; color: var(--faint); font-size: 13px; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
</head>
<body>
<main>
  <header>
    <svg viewBox="0 0 128 128" fill="none" aria-hidden="true"><path d="M64 14a50 50 0 1 0 50 50" stroke="var(--accent)" stroke-width="8" stroke-linecap="round"/><path d="M64 17a47 47 0 0 1 43 28" stroke="var(--ink)" stroke-width="8" stroke-linecap="round"/><path d="m48 53 15 11-15 11M67 76h14" stroke="var(--ink)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M64 35v7m0 44v7m-22-29h7m30 0h7m-38-15 5 5m22 22 5 5m0-32-5 5m-22 22-5 5" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/></svg>
    <div>
      <h1>Claude Code Monitor</h1>
      <p class="sub" id="sub"></p>
    </div>
    <button class="theme" id="theme" type="button"></button>
  </header>
  <div class="card"><ol id="steps" aria-live="polite"></ol></div>
  <div class="banner ok" id="ok" role="status">
    <p><strong id="okTitle"></strong><span id="okBody"></span></p>
    <button class="primary" id="open" type="button"></button>
  </div>
  <div class="banner err" id="err" role="alert">
    <p><strong id="errTitle"></strong><span id="errBody"></span></p>
    <button class="primary" id="retry" type="button"></button>
  </div>
  <section class="links" id="links" aria-labelledby="linksTitle">
    <h2 id="linksTitle"></h2>
    <p id="linksBody"></p>
    <label><input type="checkbox" id="lnk-desktop" data-kind="desktop" /><span id="lnkDesktop"></span></label>
    <label><input type="checkbox" id="lnk-startup" data-kind="startup" /><span id="lnkStartup"></span></label>
  </section>
  <details id="logBox"><summary id="logLabel"></summary><pre id="log"></pre></details>
  <p class="foot" id="foot"></p>
</main>
<script>
const I18N = {
  en: {
    sub: 'Getting everything ready…', subReady: 'Ready', subError: 'Setup stopped',
    steps: {
      node: ['Check Node.js', 'Node 20.19+ or 22.12+'],
      deps: ['Install dependencies', 'npm install — first run takes a minute'],
      build: ['Build the dashboard', 'Only when the code changed'],
      start: ['Start the monitor', 'Local server on 127.0.0.1'],
    },
    status: { pending: 'Waiting', running: 'Running', done: 'Done', skipped: 'Up to date', error: 'Failed' },
    okTitle: 'Monitor is running', okBody: ' Opening the dashboard…', open: 'Open dashboard',
    errTitle: 'Something went wrong', retry: 'Try again', log: 'Show log',
    foot: 'Keep the launcher window open while you use the dashboard. Closing it stops the monitor.',
    dark: 'Switch to dark theme', light: 'Switch to light theme',
    linksTitle: 'Shortcuts', linksBody: 'Claude-Code-Monitor.lnk in the project folder opens the monitor with its own icon. Also add one to:',
    lnkDesktop: 'Desktop', lnkStartup: 'Start with Windows (minimized, no browser tab)',
  },
  vi: {
    sub: 'Đang chuẩn bị mọi thứ…', subReady: 'Sẵn sàng', subError: 'Cài đặt bị dừng',
    steps: {
      node: ['Kiểm tra Node.js', 'Cần Node 20.19+ hoặc 22.12+'],
      deps: ['Cài thư viện', 'npm install — lần đầu mất khoảng một phút'],
      build: ['Build dashboard', 'Chỉ chạy khi code thay đổi'],
      start: ['Khởi động monitor', 'Server nội bộ trên 127.0.0.1'],
    },
    status: { pending: 'Đang chờ', running: 'Đang chạy', done: 'Xong', skipped: 'Đã mới nhất', error: 'Lỗi' },
    okTitle: 'Monitor đang chạy', okBody: ' Đang mở dashboard…', open: 'Mở dashboard',
    errTitle: 'Có lỗi xảy ra', retry: 'Thử lại', log: 'Xem log',
    foot: 'Giữ cửa sổ launcher mở trong lúc dùng dashboard. Đóng cửa sổ đó sẽ tắt monitor.',
    dark: 'Chuyển sang giao diện tối', light: 'Chuyển sang giao diện sáng',
    linksTitle: 'Lối tắt', linksBody: 'Claude-Code-Monitor.lnk trong thư mục project mở monitor với icon riêng. Thêm lối tắt vào:',
    lnkDesktop: 'Màn hình Desktop', lnkStartup: 'Chạy cùng Windows (thu nhỏ, không mở tab trình duyệt)',
  },
}
const t = I18N[navigator.language.toLowerCase().startsWith('vi') ? 'vi' : 'en']
document.documentElement.lang = t === I18N.vi ? 'vi' : 'en'
const $ = (id) => document.getElementById(id)

const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
let dark
try { dark = localStorage.getItem('ccm.setupTheme') } catch {}
dark = dark ? dark === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
function applyTheme() {
  document.documentElement.classList.toggle('dark', dark)
  $('theme').innerHTML = dark ? SUN : MOON
  $('theme').setAttribute('aria-label', dark ? t.light : t.dark)
  $('theme').title = dark ? t.light : t.dark
}
$('theme').onclick = () => {
  dark = !dark
  try { localStorage.setItem('ccm.setupTheme', dark ? 'dark' : 'light') } catch {}
  applyTheme()
}
applyTheme()

$('open').textContent = t.open
$('retry').textContent = t.retry
$('okTitle').textContent = t.okTitle
$('okBody').textContent = t.okBody
$('errTitle').textContent = t.errTitle
$('logLabel').textContent = t.log
$('foot').textContent = t.foot
$('linksTitle').textContent = t.linksTitle
$('linksBody').textContent = t.linksBody
$('lnkDesktop').textContent = t.lnkDesktop
$('lnkStartup').textContent = t.lnkStartup
let lingering = false
for (const box of document.querySelectorAll('.links input')) {
  box.onchange = async () => {
    lingering = true
    box.disabled = true
    try { await fetch('/shortcut?kind=' + box.dataset.kind + '&on=' + (box.checked ? 1 : 0), { method: 'POST', headers: { 'x-ccm-setup': '1' } }) } catch {}
  }
}
$('links').addEventListener('pointerenter', () => { lingering = true })
$('links').addEventListener('focusin', () => { lingering = true })

const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
const CROSS = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
let appUrl = ''
let redirected = false

function render(s) {
  appUrl = s.appUrl
  const list = $('steps')
  list.replaceChildren(...s.steps.map((step, i) => {
    const li = document.createElement('li')
    li.dataset.status = step.status
    const icon = document.createElement('span')
    icon.className = 'icon'
    if (step.status === 'running') icon.innerHTML = '<span class="spin"></span>'
    else if (step.status === 'done' || step.status === 'skipped') icon.innerHTML = CHECK
    else if (step.status === 'error') icon.innerHTML = CROSS
    else icon.textContent = String(i + 1)
    const text = document.createElement('div')
    const label = document.createElement('div')
    label.className = 'label'
    label.textContent = t.steps[step.id][0]
    const hint = document.createElement('div')
    hint.className = 'hint'
    hint.textContent = step.detail || t.steps[step.id][1]
    text.append(label, hint)
    const status = document.createElement('span')
    status.className = 'status'
    status.textContent = t.status[step.status]
    li.append(icon, text, status)
    if (step.status === 'running') li.setAttribute('aria-current', 'step')
    return li
  }))
  $('sub').textContent = s.phase === 'ready' ? t.subReady : s.phase === 'error' ? t.subError : t.sub
  $('ok').classList.toggle('show', s.phase === 'ready')
  $('err').classList.toggle('show', s.phase === 'error')
  $('errBody').textContent = s.error ? ' ' + s.error : ''
  if (s.phase === 'error') $('logBox').open = true
  $('links').classList.toggle('show', !!s.shortcuts)
  for (const [kind, on] of Object.entries(s.shortcuts || {})) {
    const box = $('lnk-' + kind)
    if (box) { box.checked = on; box.disabled = false }
  }
  if (s.phase === 'ready' && !redirected) {
    redirected = true
    // Someone ticking a shortcut box must not be navigated away mid-click; the button stays as the way out.
    setTimeout(() => { if (!lingering) location.assign(appUrl) }, s.shortcuts ? 2500 : 900)
  }
}

function appendLog(line) {
  const pre = $('log')
  const stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8
  pre.textContent += line + '\n'
  if (pre.textContent.length > 60000) pre.textContent = pre.textContent.slice(-50000)
  if (stick) pre.scrollTop = pre.scrollHeight
}

$('open').onclick = () => location.assign(appUrl)
$('retry').onclick = async () => {
  $('retry').disabled = true
  try { await fetch('/retry', { method: 'POST', headers: { 'x-ccm-setup': '1' } }) } finally { $('retry').disabled = false }
}

const es = new EventSource('/events')
es.addEventListener('init', (e) => {
  const s = JSON.parse(e.data)
  $('log').textContent = ''
  s.logs.forEach(appendLog)
  render(s)
})
es.addEventListener('state', (e) => render(JSON.parse(e.data)))
es.addEventListener('log', (e) => appendLog(JSON.parse(e.data)))
es.onerror = () => { if (redirected) es.close() }
</script>
</body>
</html>`

listen(SETUP_PORT)
