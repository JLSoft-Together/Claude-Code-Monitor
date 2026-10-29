// v46 layout preview speed + waiting states: cold start shows the staged wait UI on a device skeleton, re-renders
// keep the last frame (never blank), renders only the shown pixels, zoom-in re-renders sharper, reduced motion
// turns the animations off. Prints open → first frame and keystroke → new frame timings.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const MOD = process.platform === 'darwin' ? 4 : 2
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-lspeed-')))
const LAYOUT = path.join(DIR, 'speed_card.xml')
const OTHER = path.join(DIR, 'speed_other.xml')
const XML = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <TextView android:id="@+id/headline" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Headline" android:textSize="24sp"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
    <com.google.android.material.button.MaterialButton android:id="@+id/cta" android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="Install"
        app:layout_constraintEnd_toEndOf="parent" app:layout_constraintBottom_toBottomOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>
`
const OTHER_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">
    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Other" />
</LinearLayout>
`

// Watches the stage every animation frame: which wait UI showed up, and whether a shown frame ever went blank.
const RECORDER = `(() => {
  const r = window.__lspeed = { wait: false, skeleton: false, progress: false, stages: new Set(), titles: new Set(), firstFrameAt: 0, blankAfterFrame: 0, frames: new Set(), busy: false, skelAnim: null, frameAnim: [] }
  const tick = () => {
    const stage = document.querySelector('[data-layout-stage]')
    const w = document.querySelector('[data-layout-wait]')
    if (w) { r.wait = true; r.stages.add(w.dataset.stage); r.titles.add(w.textContent.trim().slice(0, 80)) }
    const sk = document.querySelector('[data-layout-skeleton] div')
    if (sk) { r.skeleton = true; r.skelAnim = getComputedStyle(sk).animationName }
    if (document.querySelector('[data-layout-progress]')) r.progress = true
    if (document.querySelector('[data-layout-busy]')) r.busy = true
    const f = document.querySelector('[data-layout-frame]')
    if (f && f.complete && f.naturalWidth > 0) {
      if (!r.firstFrameAt) r.firstFrameAt = performance.now()
      r.frames.add(f.src)
    } else if (r.firstFrameAt && stage && !document.querySelector('[data-layout-stage] img')) r.blankAfterFrame++
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return true
})()`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, type, key } = app
  const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el })()`)
  const frameSrc = () => evaluate(`document.querySelector('[data-layout-frame]')?.src ?? ''`)
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.layout.mode','split'); localStorage.removeItem('ccm.layout.options')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  const status = await evaluate(`window.ccmDesktop.layoutStatus()`)
  if (!(status?.jar && status.jdk?.ok && status.bundle?.state === 'ready')) {
    check('layout speed checks skipped (renderer not set up)', true)
    return
  }
  check('daemon is not started before a layout signal (no RAM for web-only work)', status.daemon === 'stopped', status.daemon)
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')

  // Cold start.
  await evaluate(RECORDER)
  const t0 = await evaluate(`performance.now()`)
  await evaluate(`${W}.openFile(${JSON.stringify(LAYOUT)})`)
  await waitFor(`!!document.querySelector('[data-layout-wait]')`, 8000, 'wait card').catch(() => {})
  await shot('lspeed-1-cold-wait')
  await waitFor(`window.__lspeed.firstFrameAt > 0`, 120000, 'first frame')
  const cold = await evaluate(`({ ms: Math.round(window.__lspeed.firstFrameAt - ${t0}), wait: window.__lspeed.wait, skeleton: window.__lspeed.skeleton, progress: window.__lspeed.progress, stages: [...window.__lspeed.stages], titles: [...window.__lspeed.titles] })`)
  console.log('cold open → first frame', cold.ms, 'ms', JSON.stringify(cold.stages))
  check('cold start shows the wait card on a device skeleton', cold.wait && cold.skeleton, JSON.stringify(cold.titles))
  check('cold start shows renderer start-up stages with a progress bar', cold.progress && cold.stages.some((s) => ['jvm', 'setup', 'prepare', 'warmup'].includes(s)), JSON.stringify(cold.stages))
  check('wait UI is gone once the frame is shown', await waitFor(`!document.querySelector('[data-layout-wait]') && !document.querySelector('[data-layout-skeleton]')`, 5000, 'wait gone').then(() => true, () => false))
  await shot('lspeed-2-first-frame')

  // Only the shown pixels: in fit mode the image is smaller than the device.
  const natural = await evaluate(`document.querySelector('[data-layout-frame]').naturalWidth`)
  const dpr = await evaluate(`window.devicePixelRatio`)
  check('fit mode renders at the shown size, not 1080 px', natural > 0 && natural < 1080, `natural ${natural} px, dpr ${dpr}`)

  // Warm edit loop: keystroke → new frame, last frame kept throughout.
  await click('[data-file-edit]')
  await waitFor(`!!document.querySelector('.cm-editor .cm-content')`, 10000, 'editor')
  await evaluate(`document.querySelector('.cm-content').focus()`)
  const edits = []
  for (let i = 0; i < 5; i++) {
    const before = await frameSrc()
    // Start of the closing root tag: a comment there keeps the XML valid.
    await key('End', 'End', 35, MOD)
    await key('ArrowUp', 'ArrowUp', 38)
    await key('Home', 'Home', 36)
    const s = await evaluate(`performance.now()`)
    await type(`<!-- e${i} -->`)
    const ok = await waitFor(`(document.querySelector('[data-layout-frame]')?.src ?? '') !== ${JSON.stringify(before)} && document.querySelector('[data-layout-frame]').complete`, 20000, 'edit frame').then(() => true, () => false)
    if (ok) edits.push(Math.round((await evaluate(`performance.now()`)) - s))
    await sleep(300)
  }
  console.log('keystroke → new frame ms', JSON.stringify(edits))
  check('every edit produced a new frame', edits.length === 5, JSON.stringify(edits))
  check('the last frame stays visible while re-rendering (never blank)', (await evaluate(`window.__lspeed.blankAfterFrame`)) === 0, String(await evaluate(`window.__lspeed.blankAfterFrame`)))

  // Theme switch: stale-while-revalidate.
  const beforeNight = await frameSrc()
  await click('[data-layout-preview] [role="radiogroup"] [aria-checked="false"], [data-layout-preview] [role="radio"][aria-checked="false"]')
  await waitFor(`(document.querySelector('[data-layout-frame]')?.src ?? '') !== ${JSON.stringify(beforeNight)}`, 20000, 'night frame').catch(() => {})
  check('theme switch keeps a frame on screen until the new one arrives', (await evaluate(`window.__lspeed.blankAfterFrame`)) === 0)

  // Zoom to 100 %: sharper re-render up to the device pixels.
  await evaluate(`(() => { const o = JSON.parse(localStorage.getItem('ccm.layout.options') || '{}'); return o })()`)
  const zoomSel = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-layout-preview] [role="toolbar"] button')].find((x) => /zoom|thu phóng/i.test(x.getAttribute('aria-label') || '')); b?.click(); return !!b })()`)
  if (zoomSel) {
    await sleep(300)
    await evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find((x) => x.textContent.trim() === '100%'); o?.click(); return !!o })()`)
    const sharp = await waitFor(`document.querySelector('[data-layout-frame]')?.naturalWidth >= 1080 && document.querySelector('[data-layout-frame]').naturalWidth`, 20000, 'sharp frame').catch(() => 0)
    check('zooming in re-renders at full device pixels', sharp >= 1080, String(sharp))
  } else {
    check('zoom control found', false)
  }

  // Reduced motion: no shimmer / crossfade animation.
  await cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await evaluate(`window.__lspeed.skelAnim = null`)
  await evaluate(`${W}.openFile(${JSON.stringify(OTHER)})`)
  await waitFor(`!!document.querySelector('[data-layout-frame]') && document.querySelector('[data-layout-frame]').src.length > 0 && document.querySelector('[data-layout-frame]').complete`, 30000, 'other frame').catch(() => {})
  const anim = await evaluate(`getComputedStyle(document.querySelector('[data-layout-frame]')).animationName`)
  const skel = await evaluate(`window.__lspeed.skelAnim`)
  check('reduced motion: frames appear without animation', anim === 'none', anim)
  check('reduced motion: skeleton does not shimmer', skel === null || skel === 'none', String(skel))
  await cmd('Emulation.setEmulatedMedia', { features: [] })
  await shot('lspeed-3-done')
}

;(async () => {
  fs.writeFileSync(LAYOUT, XML)
  fs.writeFileSync(OTHER, OTHER_XML)
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('lspeed-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-layout-speed.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
