// Resizable Workspace sidebar: drag across a shell pane, ← nudge, double-click reset, persisted width.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-sidebar-')))

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.workspace.sideWidth'); localStorage.setItem('ccm.workspace.sidebar','1')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)

  const aside = `document.querySelector('[data-tour="ws-sidebar"]')`
  const width = () => evaluate(`Math.round(${aside}.getBoundingClientRect().width)`)
  check('sidebar starts at the default 240px', (await width()) === 240, String(await width()))
  const r = await evaluate(`(() => { const b = document.querySelector('[data-side-resizer]').getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)] })()`)
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r[0], y: r[1], button: 'left', clickCount: 1 })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0] + 100, y: r[1], button: 'left' })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r[0] + 100, y: r[1], button: 'left', clickCount: 1 })
  await sleep(200)
  const w1 = await width()
  check('dragging the handle across the shell pane widens the sidebar', Math.abs(w1 - 340) <= 2, String(w1))
  check('width is persisted', (await evaluate(`localStorage.getItem('ccm.workspace.sideWidth')`)) === String(w1))
  await evaluate(`document.querySelector('[data-side-resizer]').focus()`)
  await evaluate(`document.querySelector('[data-side-resizer]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`)
  await sleep(100)
  check('← narrows by 16px', (await width()) === w1 - 16)
  await evaluate(`document.querySelector('[data-side-resizer]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(100)
  check('double-click resets to 240px', (await width()) === 240)
  await shot('sidebar-01')
}

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('sidebar-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-sidebar.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
