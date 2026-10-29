// v44 loose kit: a layout XML outside any Android project with a ConstraintLayout root and Material widgets renders
// through the bundled kit (no "Class not found"). Needs the layout renderer set up; otherwise only detection runs.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-loosekit-')))
const LAYOUT = path.join(DIR, 'native_ad_cta.xml')
const XML = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <TextView android:id="@+id/headline" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Headline"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.button.MaterialButton android:id="@+id/cta" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Install"
        app:layout_constraintEnd_toEndOf="parent" app:layout_constraintBottom_toBottomOf="parent" />
    <CheckBox android:id="@+id/agree" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Agree" android:checked="true"
        app:layout_constraintTop_toBottomOf="@id/headline" app:layout_constraintStart_toStartOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>
`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.layout.mode','split')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')

  await evaluate(`${W}.openFile(${JSON.stringify(LAYOUT)})`)
  await waitFor(`!!document.querySelector('[data-layout-mode]')`, 8000, 'layout mode').catch(() => {})
  check('loose ConstraintLayout XML gets the layout preview', await evaluate(`!!document.querySelector('[data-layout-mode]')`))
  const status = await evaluate(`window.ccmDesktop.layoutStatus()`)
  if (!(status?.jar && status.jdk?.ok && status.bundle?.state === 'ready')) {
    check('render checks skipped (renderer not set up)', true)
    return
  }
  const imgSel = '[data-layout-stage] img, [data-layout-preview] img'
  await waitFor(`!!document.querySelector(${JSON.stringify(imgSel)})?.src`, 90000, 'layout image').catch(() => {})
  const chipText = await waitFor(`document.querySelector('[data-layout-model]')?.textContent.trim() === 'Built-in libraries' && 'ok'`, 8000, 'chip').catch(() => '')
  check('model chip says Built-in libraries', chipText === 'ok', await evaluate(`document.querySelector('[data-layout-model]')?.textContent.trim() ?? ''`))
  check('renders a PNG', !!(await evaluate(`document.querySelector(${JSON.stringify(imgSel)})?.src`)))
  const shown = await evaluate(`[...document.querySelectorAll('[data-layout-diagnostics] li')].map((li) => li.textContent.trim())`)
  check('no class-not-found / theme diagnostic in the panel', !shown.some((m) => /class not found|theme/i.test(m)), JSON.stringify(shown))
  await shot('loosekit-1-render')

  const res = await evaluate(`window.ccmDesktop.layoutRender({ file: ${JSON.stringify(LAYOUT)}, device: { width: 1080, height: 2340, density: 440 }, night: false, slot: 3 })`)
  const kids = res?.viewTree?.children ?? []
  const cta = kids.find((n) => n.xmlId === '@+id/cta')
  check('MaterialButton constrained to bottom end', res?.ok && cta?.class === 'com.google.android.material.button.MaterialButton' && cta.bounds[2] === 1080 && cta.bounds[3] === 2340, JSON.stringify(cta?.bounds))
  const msgs = (res?.diagnostics ?? []).map((d) => d.message)
  check('render result has no class-not-found', !msgs.some((m) => /class not found/i.test(m)), JSON.stringify(msgs))
  const agree = kids.find((n) => n.xmlId === '@+id/agree')
  check('CheckBox inflates as MaterialCheckBox (animated-vector aapt:attr drawable)', agree?.class === 'com.google.android.material.checkbox.MaterialCheckBox' && agree.bounds[2] > agree.bounds[0], JSON.stringify(agree))
  check('no drawable parse / failed-to-render diagnostic', !msgs.some((m) => /failed to (parse|render)/i.test(m)), JSON.stringify(msgs))
}

;(async () => {
  fs.writeFileSync(LAYOUT, XML)
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('loosekit-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-loose-kit.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
