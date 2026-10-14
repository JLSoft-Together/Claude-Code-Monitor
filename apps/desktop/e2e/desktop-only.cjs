// Desktop only: the collector refuses anything without the app key; toast links reach the running app.
const { spawn } = require('node:child_process')
const path = require('node:path')
const { launch, REPO, OUT, PORT, sleep } = require('./cdp.cjs')
const WS = require(path.join(REPO, 'node_modules/ws'))
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const base = `http://127.0.0.1:${PORT}`

const socketOpens = () =>
  new Promise((resolve) => {
    const ws = new WS(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: base } })
    ws.once('open', () => { ws.close(); resolve(true) })
    ws.once('error', () => resolve(false))
  })

;(async () => {
  const exe = process.argv[2]
  const app = await launch(exe ? { exe } : {})
  const { evaluate, waitFor, shot } = app
  try {
    await waitFor(`!!${S}.get('ui') && ${S}.get('connection').state === 'connected'`, 30000, 'app page connected')
    check('app window loads and connects', true)
    check('/health stays open', (await fetch(`${base}/health`)).status === 200)
    check('a browser (no key) gets 403 for the page', (await fetch(`${base}/`)).status === 403)
    check('a browser (no key) cannot open the socket', (await socketOpens()) === false)
    check('terminals available in the app', !!(await evaluate(`window.ccmDesktop.ptyEndpoint().then(Boolean)`)))

    // A toast button launches the exe again with agent-monitor://…; the single-instance lock hands it to this app.
    await evaluate(`${S}.get('ui').setView('usage')`)
    const args = [`--user-data-dir=${path.join(OUT, 'run', 'ud')}`, ...(exe ? [] : [path.join(REPO, 'apps/desktop/stage')]), 'agent-monitor://focus?k=wrong&t=nope']
    spawn(exe ?? path.join(REPO, 'node_modules/electron/dist/electron.exe'), args, { stdio: 'ignore' })
    await waitFor(`${S}.get('ui').view === 'monitor'`, 15000, 'link shows the session in Monitor')
    check('toast link reaches the running app', true)
    await shot('desktop-only')
  } catch (e) {
    check('run', false, e.message)
    await shot('desktop-only-99-error').catch(() => {})
  } finally {
    app.stop()
    await sleep(300)
    process.exit(0)
  }
})()
