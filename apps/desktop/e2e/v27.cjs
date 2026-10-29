// v27: first-run quick setup, code / interface fonts, Ctrl+wheel code size and app zoom.
// Nothing is enabled for real: the setup sheet is only skipped, so Claude's settings.json is never touched.
const fs = require('node:fs')
const path = require('node:path')
const { launch, OUT, REPO } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const SET = `${S}.get('settings')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2

async function main() {
  const app = await launch({ exe: process.argv[2] })
  const { evaluate, waitFor, shot, sleep, cmd } = app
  const center = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2] })()`)
  const wheel = async (sel, deltaY) => {
    const p = await center(sel)
    if (!p) throw new Error('no element ' + sel)
    await cmd('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p[0], y: p[1], deltaX: 0, deltaY, modifiers: CTRL })
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.removeItem('ccm.setupDone'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.font.code'); localStorage.removeItem('ccm.font.ui'); localStorage.removeItem('ccm.font.codeSize')`)
    await zoomReset()
    await cmd('Page.reload')
    await sleep(1500)

    // Quick setup: opens by itself once, lists what is off, "Skip for now" marks it done.
    const rows = await waitFor(`document.querySelector('[data-quick-setup]') && [...document.querySelectorAll('[data-setup-row]')].map(r => r.dataset.setupRow).join(',')`, 15000, 'quick setup').catch(() => null)
    check('quick setup opens on first run', !!rows, rows)
    check('it offers the projects folder', !!rows && rows.includes('folder'))
    await sleep(400); await shot('v27-01-quick-setup')
    await evaluate(`[...document.querySelectorAll('[data-quick-setup] button')].find(b => /skip|để sau/i.test(b.textContent)).click()`)
    await sleep(500)
    check('skip marks it done and closes', await evaluate(`localStorage.getItem('ccm.setupDone') === '1' && !document.querySelector('[data-quick-setup]') && !${S}.get('ui').setupOpen`))

    // Fonts: CSS variables follow the store; bundled faces load from the app.
    await evaluate(`${SET}.setCodeFont('jetbrains-mono'); ${SET}.setUiFont('inter')`)
    await sleep(200)
    const vars = await evaluate(`[getComputedStyle(document.documentElement).getPropertyValue('--font-mono'), getComputedStyle(document.body).fontFamily]`)
    check('code font sets --font-mono', /JetBrains Mono Variable/.test(vars[0]), vars[0])
    check('interface font reaches body text', /Inter Variable/.test(vars[1]), vars[1])
    const loaded = await evaluate(`Promise.all(["13px 'JetBrains Mono Variable'", "13px 'Inter Variable'"].map((f) => document.fonts.load(f))).then((sets) => sets.every((s) => s.some((f) => f.status === 'loaded')))`).catch(() => false)
    check('bundled fonts load locally', !!loaded)
    check('picks persist', await evaluate(`localStorage.getItem('ccm.font.code') === 'jetbrains-mono' && localStorage.getItem('ccm.font.ui') === 'inter'`))

    await evaluate(`${S}.get('ui').settingsOpen = true`)
    await sleep(500)
    await evaluate(`document.querySelector('[data-font-picker=code]').click()`)
    await sleep(300)
    const options = await evaluate(`[...document.querySelectorAll('[data-font-option]')].map(o => o.dataset.fontOption)`)
    check('code font list has Consolas, JetBrains Mono, Google Sans Code', ['consolas', 'jetbrains-mono', 'google-sans-code'].every((id) => options.includes(id)), options.join(','))
    await evaluate(`document.querySelector('[data-font-picker=code]').closest('.ccm-scroll, aside')?.querySelector('#set-text')?.scrollIntoView()`)
    await sleep(300); await shot('v27-02-settings-fonts')
    await evaluate(`document.querySelector('[data-font-option="google-sans-code"]').click()`)
    check('choosing from the list sets the font', await evaluate(`${SET}.codeFont === 'google-sans-code'`))
    await evaluate(`${S}.get('ui').settingsOpen = false`)
    await sleep(400)

    // Ctrl+wheel over a terminal: code size, with the HUD.
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(REPO)})`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
    await sleep(600)
    const before = await evaluate(`${SET}.codeFontSize`)
    await wheel('[data-code-zoom]', -100)
    await wheel('[data-code-zoom]', -100)
    await sleep(300)
    const after = await evaluate(`${SET}.codeFontSize`)
    check('ctrl+wheel up over the terminal enlarges code text', after === before + 2, `${before} → ${after}`)
    const hud = await evaluate(`document.querySelector('[data-zoom-hud]')?.textContent?.trim()`)
    check('HUD shows the new size', !!hud && hud.includes(String(after)), hud)
    check('--ccm-code-size follows', (await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--ccm-code-size').trim()`)) === `${after}px`)
    await shot('v27-03-code-size')
    const zoomBefore = await evaluate(`window.ccmDesktop.zoomApp('get')`)
    check('code size leaves the app zoom alone', zoomBefore === 100, zoomBefore)

    // Ctrl+wheel elsewhere: app zoom (kept by the main process).
    await wheel('header', -100)
    await sleep(400)
    const zoomed = await evaluate(`window.ccmDesktop.zoomApp('get')`)
    check('ctrl+wheel over the header zooms the app', zoomed > 100, zoomed)
    const hud2 = await evaluate(`document.querySelector('[data-zoom-hud]')?.textContent?.trim()`)
    check('HUD shows the zoom', !!hud2 && hud2.includes(`${zoomed}%`), hud2)
    await shot('v27-04-app-zoom')
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    check('app zoom survives a reload', (await evaluate(`window.ccmDesktop.zoomApp('get')`)) === zoomed)
    await zoomReset()
    check('reset brings 100% back', (await evaluate(`window.ccmDesktop.zoomApp('get')`)) === 100)

  } catch (err) {
    check('script error', false, String(err?.message ?? err))
    await app.shot('v27-error').catch(() => {})
  } finally {
    await app.evaluate(`window.ccmDesktop?.zoomApp('reset'); ${SET}.setCodeFont('system'); ${SET}.setUiFont('system'); ${SET}.stepCodeSize(0)`).catch(() => {})
    app.stop()
  }
  fs.writeFileSync(path.join(OUT, 'v27.txt'), results.join('\n') + '\n')

  async function zoomReset() {
    await app.evaluate(`window.ccmDesktop.zoomApp('reset')`)
  }
}
main()
