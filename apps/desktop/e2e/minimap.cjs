// v27 code minimap: file viewer draws a minimap beside the code, click scrolls, Settings toggle hides it.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-minimap-')))
const FILE = path.join(DIR, 'long.ts')

function fixture() {
  const body = []
  for (let i = 0; i < 600; i++) body.push(`export function fn${i}(value: number): string {`, `  // line ${i} of the fixture`, `  return \`#\${value + ${i}}\``, '}', '')
  fs.writeFileSync(FILE, body.join('\n'))
}

const scroller = `document.querySelector('[data-kind="file"] .ccm-scroll')`
const painted = `(() => { const c = document.querySelector('[data-kind="file"] .minimap canvas'); if (!c || !c.width) return 0
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n })()`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.minimap')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await evaluate(`${W}.openFile(${JSON.stringify(FILE)}, undefined, { cwd: ${JSON.stringify(DIR)} })`)
  await waitFor(`!!document.querySelector('[data-kind="file"] .code [data-line="3000"]')`, 15000, 'file rendered')

  check('minimap is on by default', await evaluate(`${S}.get('settings').minimap === true && !!document.querySelector('[data-kind="file"] .minimap')`))
  await sleep(600)
  check('minimap draws the code', (await evaluate(painted)) > 500, String(await evaluate(painted)))
  await shot('minimap-01-top')

  const box = await evaluate(`(() => { const r = document.querySelector('[data-kind="file"] .minimap').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.9] })()`)
  for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 })
  await sleep(400)
  const top = await evaluate(`${scroller}.scrollTop`)
  check('click near the bottom of the minimap scrolls the file down', top > 5000, String(top))
  const slider = await evaluate(`(() => { const s = document.querySelector('[data-kind="file"] .minimap .slider').getBoundingClientRect(); return s.height > 0 && s.height < 400 })()`)
  check('slider marks the visible range', slider)
  await shot('minimap-02-scrolled')

  await evaluate(`${S}.get('settings').minimap = false`)
  await sleep(300)
  check('Settings toggle hides the minimap', await evaluate(`!document.querySelector('[data-kind="file"] .minimap') && localStorage.getItem('ccm.minimap') === '0'`))
  await evaluate(`${S}.get('settings').minimap = true`)
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('minimap-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-minimap.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
