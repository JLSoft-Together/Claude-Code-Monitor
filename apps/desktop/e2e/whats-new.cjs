// v71 What's new: opens once per app version after quick setup and the guide, from Settings and Ctrl+K; dark + light shots.
const { launch, sleep } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const SET = `${S}.get('settings')`
const VERSION = require('../package.json').version
const MOD = process.platform === 'darwin' ? 4 : 2
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DLG = `document.querySelector('[data-whats-new]')`
const visibleDialogs = `[...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length && getComputedStyle(d).visibility !== 'hidden').length`
const header = (v) => `document.getElementById('whats-new-h-${v}')`
const expandedOf = (v) => `${header(v)}?.getAttribute('aria-expanded')`

;(async () => {
  const exe = process.argv[2]
  const app = await launch(exe ? { exe } : {})
  const { evaluate, waitFor, shot, key, cmd } = app
  const esc = () => key('Escape', 'Escape', 27)
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI} && ${S}.get('connection').state === 'connected'`, 30000, 'app ready')

    // (d) Fresh profile: quick setup and the guide come first, never two dialogs at once, then What's new.
    let maxVisible = 0
    const order = []
    const end = Date.now() + 45000
    while (Date.now() < end) {
      const st = await evaluate(`JSON.stringify({ n: ${visibleDialogs}, setup: ${UI}.setupOpen, tour: ${UI}.tourOpen, wn: ${UI}.whatsNewOpen, wnEl: !!${DLG} })`).then(JSON.parse)
      maxVisible = Math.max(maxVisible, st.n)
      const now = st.wn ? 'whatsNew' : st.tour ? 'tour' : st.setup ? 'setup' : null
      if (now && order.at(-1) !== now) order.push(now)
      if (st.wn && st.wnEl) break
      if (st.n === 1 && (st.setup || st.tour)) {
        await sleep(400)
        await esc()
        await sleep(600)
      } else await sleep(250)
    }
    check('fresh install: What\'s new comes last', order.at(-1) === 'whatsNew' && order.indexOf('whatsNew') === order.length - 1 && order.includes('tour'), order.join(' → '))
    check('fresh install: never two dialogs at once', maxVisible <= 1, `max ${maxVisible}`)
    await esc()
    await waitFor(`!${DLG}`, 5000, 'closed after fresh install').catch(() => {})

    // (a) Tour and setup done, nothing seen yet: the dialog opens by itself.
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.removeItem('ccm.whatsNew.seen'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await waitFor(`!!${DLG}`, 15000, 'dialog opens on its own')
    await sleep(400)
    check('opens when the version was not seen', true)
    const older = await evaluate(`[...document.querySelectorAll('[data-whats-new] button[aria-expanded]')].map((b) => b.id.replace('whats-new-h-', '')).find((v) => v !== '${VERSION}')`)
    check(`current ${VERSION} expanded`, (await evaluate(expandedOf(VERSION))) === 'true')
    check('an older release collapsed', !!older && (await evaluate(expandedOf(older))) === 'false', older)
    check('current header has focus', await evaluate(`document.activeElement === ${header(VERSION)}`))
    check('no horizontal overflow', await evaluate(`(() => { const sc = ${DLG}.querySelector('.ccm-scroll'); return sc.scrollWidth <= sc.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth })()`))
    check('sheet is opaque', await evaluate(`(() => { const c = getComputedStyle(${DLG}).backgroundColor; const m = /rgba?\\(([^)]+)\\)/.exec(c); const a = m ? (m[1].split(',')[3] ?? '1') : '0'; return Number(a) === 1 })()`), await evaluate(`getComputedStyle(${DLG}).backgroundColor`))
    await shot('whats-new-dark-en')

    await evaluate(`${header(older)}.click()`)
    await sleep(300)
    check('clicking an older header expands it', (await evaluate(expandedOf(older))) === 'true' && (await evaluate(`!${header(older)}.nextElementSibling.inert`)))
    const toggleAll = `[...${DLG}.querySelectorAll('button[aria-pressed]')][0]`
    await evaluate(`${toggleAll}.click()`)
    await sleep(300)
    check('Expand all opens every release', await evaluate(`[...${DLG}.querySelectorAll('button[aria-expanded]')].every((b) => b.getAttribute('aria-expanded') === 'true')`))
    await evaluate(`${toggleAll}.click()`)
    await sleep(300)
    check('Collapse all closes every release', await evaluate(`[...${DLG}.querySelectorAll('button[aria-expanded]')].every((b) => b.getAttribute('aria-expanded') === 'false')`))

    // Monitor single-key shortcuts must not reach the page behind the modal.
    await evaluate(`${UI}.setView('monitor')`)
    await sleep(400)
    const panelBefore = await evaluate(`JSON.stringify(${UI}.panels ?? null)`)
    await evaluate(`${header(VERSION)}.focus()`)
    await key('s', 'KeyS', 83)
    await sleep(200)
    check('page shortcuts blocked while open', (await evaluate(`JSON.stringify(${UI}.panels ?? null)`)) === panelBefore && (await evaluate(`!!${DLG}`)))

    await esc()
    await waitFor(`!${DLG}`, 5000, 'Esc closes').catch(() => {})
    check('Esc closes', await evaluate(`!${DLG} && !${UI}.whatsNewOpen`))
    check(`seen === ${VERSION}`, (await evaluate(`localStorage.getItem('ccm.whatsNew.seen')`)) === VERSION)

    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await sleep(3500)
    check('reload: does not open again', await evaluate(`!${DLG} && !${UI}.whatsNewOpen`))

    // (b) Settings → What's new.
    await evaluate(`${UI}.settingsOpen = true`)
    await waitFor(`[...document.querySelectorAll('section[aria-labelledby="set-help"] button')].some((b) => /What's new/.test(b.textContent))`, 8000, 'settings help row')
    await evaluate(`[...document.querySelectorAll('section[aria-labelledby="set-help"] button')].find((b) => /What's new/.test(b.textContent)).click()`)
    await waitFor(`!!${DLG}`, 5000, 'opened from Settings').catch(() => {})
    check('Settings row opens it', await evaluate(`!!${DLG} && !${UI}.settingsOpen`))
    await sleep(300)
    check('Settings: one dialog visible', (await evaluate(visibleDialogs)) === 1, String(await evaluate(visibleDialogs)))

    // Light + Vietnamese screenshot while it is open.
    await evaluate(`${SET}.setTheme ? ${SET}.setTheme('light') : (${SET}.theme = 'light'); ${SET}.locale = 'vi'`)
    await sleep(500)
    check('Vietnamese title renders', (await evaluate(`${DLG}.querySelector('#whats-new-title').textContent.trim()`)) === 'Có gì mới')
    await shot('whats-new-light-vi')
    await esc()
    await waitFor(`!${DLG}`, 5000, 'closed').catch(() => {})
    await evaluate(`${SET}.locale = 'en'`)

    // (c) Ctrl+K → What's new.
    await cmd('Page.bringToFront')
    await evaluate(`document.activeElement?.blur?.(); document.body.focus()`)
    await key('k', 'KeyK', 75, MOD)
    await waitFor(`${UI}.paletteOpen`, 5000, 'palette open').catch(() => evaluate(`${UI}.paletteOpen = true`))
    await sleep(300)
    await app.type("What's new")
    await sleep(400)
    const chosen = await evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find((r) => /What's new/.test(r.textContent)); o?.click(); return !!o })()`)
    await waitFor(`!!${DLG}`, 5000, 'opened from palette').catch(() => {})
    check('Ctrl+K entry opens it', chosen && (await evaluate(`!!${DLG} && !${UI}.paletteOpen`)))
    await esc()
  } catch (e) {
    check('run', false, e.message)
    await shot('whats-new-99-error').catch(() => {})
  } finally {
    app.stop()
    await sleep(300)
    process.exit(0)
  }
})()
