// v41 drawable preview: a loose <shape> file and a res/color selector get the Code | Split | Design control and render.
// Needs the layout renderer set up (daemon jar + layoutlib + JDK); without it only the detection checks run.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-drawable-')))
const SHAPE = path.join(DIR, 'bg_native_ad_cta.xml')
const COLOR = path.join(DIR, 'app', 'src', 'main', 'res', 'color', 'text.xml')
const OTHER = path.join(DIR, 'pom.xml')

function fixture() {
  fs.mkdirSync(path.dirname(COLOR), { recursive: true })
  fs.writeFileSync(SHAPE, '<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><gradient android:startColor="#FF6F00" android:endColor="#D500F9" android:angle="45"/><corners android:radius="12dp"/></shape>\n')
  fs.writeFileSync(COLOR, '<selector xmlns:android="http://schemas.android.com/apk/res/android"><item android:state_pressed="true" android:color="#FF0D47A1"/><item android:color="#FF2196F3"/></selector>\n')
  fs.writeFileSync(OTHER, '<project/>\n')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.layout.mode','split'); localStorage.removeItem('ccm.drawable.options')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')

  check('preload exposes drawableRender', await evaluate(`typeof window.ccmDesktop.drawableRender === 'function'`))

  await evaluate(`${W}.openFile(${JSON.stringify(OTHER)})`)
  await sleep(800)
  check('a non-drawable xml has no design mode', await evaluate(`!document.querySelector('[data-layout-mode]') && !document.querySelector('[data-drawable-preview]')`))

  await evaluate(`${W}.openFile(${JSON.stringify(SHAPE)})`)
  await waitFor(`!!document.querySelector('[data-drawable-preview]')`, 8000, 'drawable panel').catch(() => {})
  check('loose <shape> gets the drawable preview', await evaluate(`!!document.querySelector('[data-layout-mode]') && !!document.querySelector('[data-drawable-preview]')`))
  const status = await evaluate(`window.ccmDesktop.layoutStatus()`)
  if (status?.jar && status.jdk?.ok && status.bundle?.state === 'ready') {
    await waitFor(`!!document.querySelector('[data-drawable-stage] img')`, 60000, 'drawable image').catch(() => {})
    check('shape renders a PNG', await evaluate(`!!document.querySelector('[data-drawable-stage] img')`))
    await shot('drawable-1-shape')
    await evaluate(`[...document.querySelectorAll('[data-drawable-states] button')][0].click()`)
    await sleep(300)
    check('state chip toggles aria-pressed', await evaluate(`document.querySelector('[data-drawable-states] button').getAttribute('aria-pressed') === 'true'`))

    await evaluate(`${W}.openFile(${JSON.stringify(COLOR)})`)
    await waitFor(`!!document.querySelector('[data-drawable-swatches] [role=listitem]')`, 30000, 'swatches').catch(() => {})
    check('color state list shows swatches', await evaluate(`document.querySelectorAll('[data-drawable-swatches] [role=listitem]').length >= 2`))
    await shot('drawable-2-colors')
  } else {
    check('render checks skipped (renderer not set up)', true)
  }
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('drawable-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-drawable-preview.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
