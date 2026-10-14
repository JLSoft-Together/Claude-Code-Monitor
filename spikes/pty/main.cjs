const crypto = require('node:crypto')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, session, utilityProcess } = require('electron')

const TOKEN = crypto.randomBytes(32).toString('hex')
const SELFTEST = process.argv.includes('--selftest')

let host = null
let port = 0

function startHost() {
  return new Promise((resolve, reject) => {
    host = utilityProcess.fork(path.join(__dirname, 'pty-host.cjs'), [], {
      env: { ...process.env, CCM_SPIKE_TOKEN: TOKEN },
      stdio: 'inherit',
      serviceName: 'ccm-pty-spike',
    })
    host.once('exit', (code) => reject(new Error(`pty host exited ${code}`)))
    host.on('message', (msg) => {
      if (msg && msg.t === 'listening') resolve(msg.port)
    })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    backgroundColor: '#14161a',
    title: 'CCM PTY spike',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-read' || perm === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'clipboard-read' || perm === 'clipboard-sanitized-write')
  port = await startHost()
  ipcMain.handle('spike:config', () => ({ port, token: TOKEN, platform: process.platform, electron: process.versions.electron }))
  if (SELFTEST) return runSelftest()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => host?.postMessage('shutdown'))

async function runSelftest() {
  const WebSocket = require('ws')
  const url = `ws://127.0.0.1:${port}/pty`
  const results = []
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)

  const rejected = (opts) =>
    new Promise((resolve) => {
      const ws = new WebSocket(url, opts.protocols, { origin: opts.origin })
      ws.on('open', () => { ws.close(); resolve(false) })
      ws.on('error', () => resolve(true))
    })
  check('no token rejected', await rejected({ protocols: [], origin: 'file://' }))
  check('wrong token rejected', await rejected({ protocols: ['ccm.pty.' + 'ab'.repeat(32)], origin: 'file://' }))
  check('foreign origin rejected', await rejected({ protocols: ['ccm.pty.' + TOKEN], origin: 'http://evil.example' }))

  const ws = new WebSocket(url, ['ccm.pty.' + TOKEN], { origin: 'file://' })
  let out = ''
  let sid = null
  const t0 = Date.now()
  const done = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('timeout'), 20000)
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        out += data.toString('utf8')
        if (out.includes('ccm-spike-ok-42')) { clearTimeout(timeout); resolve('ok') }
        return
      }
      const msg = JSON.parse(data.toString())
      if (msg.t === 'pid') check('pid resolved', msg.pid > 0, `pid ${msg.pid} after ${msg.afterMs} ms`)
      if (msg.t === 'ready') {
        sid = msg.id
        check('spawn shell in utilityProcess', true, `${Date.now() - t0} ms`)
        // Computed suffix so the echoed input line alone cannot satisfy the check.
        const expr = process.platform === 'win32' ? '$(6*7)' : '$((6*7))'
        ws.send(Buffer.from(`echo ccm-spike-ok-${expr}\r`), { binary: true })
      }
    })
  })
  ws.on('open', () => ws.send(JSON.stringify({ t: 'spawn', preset: 'shell', cols: 100, rows: 30 })))
  const r = await done
  check('round trip input → output', r === 'ok', `${Date.now() - t0} ms total`)
  ws.close()

  const ws2 = new WebSocket(url, ['ccm.pty.' + TOKEN], { origin: 'file://' })
  const replay = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(''), 5000)
    ws2.on('open', () => ws2.send(JSON.stringify({ t: 'attach', id: sid })))
    ws2.on('message', (data, isBinary) => { if (isBinary) { clearTimeout(timeout); resolve(data.toString('utf8')) } })
  })
  check('reattach replays scrollback', replay.includes('ccm-spike-ok-42'), `${replay.length} chars`)
  ws2.send(JSON.stringify({ t: 'kill' }))
  ws2.close()

  console.log(`\nElectron ${process.versions.electron} / ${process.platform}-${process.arch}\n` + results.join('\n'))
  const failed = results.some((l) => l.startsWith('FAIL'))
  host.postMessage('shutdown')
  setTimeout(() => app.exit(failed ? 1 : 0), 500)
}
