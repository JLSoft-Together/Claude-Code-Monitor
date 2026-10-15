// Minimal CDP driver: launches the dev (or a packaged) app isolated from any installed copy and exposes eval/screenshot/keys.
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const os = require('node:os')
const REPO = path.resolve(__dirname, '../../..')
const WS = require(path.join(REPO, 'node_modules/ws'))
const OUT = process.env.CCM_E2E_OUT || path.join(os.tmpdir(), 'ccm-e2e')
const PORT = 4399
const DBG = 9333
const TMP = path.join(OUT, 'run')
fs.mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const getJson = (url) =>
  new Promise((res, rej) => http.get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)) } catch (e) { rej(e) } }) }).on('error', rej))

async function launch(opts = {}) {
  if (!opts.keep) fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(TMP, { recursive: true })
  // Decided "no" up front: the first-visit full-access confirm would otherwise sit modal over every run.
  fs.mkdirSync(path.join(TMP, 'data'), { recursive: true })
  if (!fs.existsSync(path.join(TMP, 'data', 'preview-full-access.json'))) fs.writeFileSync(path.join(TMP, 'data', 'preview-full-access.json'), '{"full":false}')
  const electron = opts.exe ?? path.join(REPO, 'node_modules/electron/dist/electron.exe')
  const child = spawn(electron, [`--user-data-dir=${path.join(TMP, 'ud')}`, `--remote-debugging-port=${DBG}`, "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", ...(opts.exe ? [] : [path.join(REPO, 'apps/desktop/stage')])], {
    env: { ...process.env, ...opts.env, CCM_PORT: String(PORT), CCM_DATA_DIR: path.join(TMP, 'data'), CCM_TOAST: '0' },
    stdio: ['ignore', fs.openSync(path.join(OUT, 'electron.log'), 'w'), fs.openSync(path.join(OUT, 'electron.err'), 'w')],
  })
  let target
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(500)
    try {
      const list = await getJson(`http://127.0.0.1:${DBG}/json`)
      target = list.find((t) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${PORT}/`))
    } catch {}
  }
  if (!target) throw new Error('no app page')
  const ws = new WS(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.once('open', r))
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400))
    return r.result?.result?.value
  }
  const shot = async (name) => {
    await cmd('Page.bringToFront')
    await sleep(150)
    const r = await cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'))
  }
  const type = async (text) => cmd('Input.insertText', { text })
  const key = async (k, code, vk, mods = 0) => {
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, text: k === 'Enter' ? '\r' : undefined })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
  }
  const waitFor = async (expr, ms = 20000, label = expr) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      try { const v = await evaluate(expr); if (v) return v } catch {}
      await sleep(250)
    }
    throw new Error('timeout: ' + label)
  }
  const stop = () => {
    try { execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' }) } catch {}
  }
  return { child, cmd, evaluate, shot, type, key, waitFor, stop, sleep }
}

module.exports = { launch, sleep, PORT, REPO, OUT }
