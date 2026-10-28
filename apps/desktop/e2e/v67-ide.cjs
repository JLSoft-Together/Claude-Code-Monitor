// v66 / v67: hook bridge row in quick setup (never turned on), compacting / denied signals, Sessions bottom sheet below 768 px.
const { launch } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const FAKE = 'e2e-v67-fake'

async function main() {
  const app = await launch({ exe: process.argv[2] })
  const { evaluate, waitFor, shot, sleep, cmd } = app
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.setupDone','1')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await sleep(1000)

    const state = await evaluate(`window.ccmDesktop.hooksState()`)
    check('hooks state reads settings.json', ['ours', 'partial', 'none', 'unreadable'].includes(state), String(state))
    await evaluate(`${UI}.setupOpen = true`)
    const rows = await waitFor(`document.querySelector('[data-quick-setup]') && [...document.querySelectorAll('[data-setup-row]')].map(r => r.dataset.setupRow).join(',')`, 15000, 'quick setup').catch(() => '')
    check('quick setup lists the hook bridge', rows.includes('hooks'), rows)
    await sleep(300); await shot('v67-01-setup-hooks')
    await evaluate(`${UI}.setupOpen = false`)
    await sleep(400)

    const now = new Date().toISOString()
    const since = new Date(Date.now() - 65_000).toISOString()
    await evaluate(`${UI}.view = 'monitor'; ${S}.get('terminals').upsert({ id: '${FAKE}', title: 'E2E compacting', status: 'working', statusSince: '${since}', lastActivityAt: '${now}', compactingSince: '${since}', compactTrigger: 'auto', deniedCount: 3, deniedTools: ['Bash', 'WebFetch'] })`)
    await evaluate(`${UI}.panels.sessions.open = true`)
    await sleep(600)
    const signals = await evaluate(`(() => { const c = document.querySelector('[data-card-compacting]'); const d = document.querySelector('[data-card-denied]'); return { c: c?.textContent.trim(), d: d?.textContent.trim(), tip: d?.title } })()`)
    check('card shows compacting with its time', !!signals.c && /1m|1 ph/.test(signals.c), signals.c)
    check('card shows denials with tool names', !!signals.d && /3/.test(signals.d) && /Bash, WebFetch/.test(signals.tip ?? ''), `${signals.d} | ${signals.tip}`)
    await shot('v67-02-card-signals')

    await cmd('Emulation.setDeviceMetricsOverride', { width: 700, height: 800, deviceScaleFactor: 1, mobile: false })
    const narrow = await waitFor(`${UI}.narrow === true`, 5000, 'narrow').catch(() => false)
    check('ui.narrow follows a 700 px window', !!narrow)
    await sleep(500)
    const sheet = await evaluate(`(() => { const a = document.querySelector('aside[data-sheet]'); if (!a) return null; const r = a.getBoundingClientRect(); return { bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, scrim: !!document.querySelector('[data-sheet-scrim]') } })()`)
    check('sessions panel is a bottom sheet', !!sheet && sheet.w >= sheet.vw - 2 && sheet.h > 200 && sheet.scrim, JSON.stringify(sheet))
    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
    await shot('v67-03-bottom-sheet')
    await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(500)
    check('Esc closes the sheet', await evaluate(`${UI}.panels.sessions.open === false`))
    await evaluate(`${UI}.panels.sessions.open = true`)
    await sleep(400)
    await evaluate(`document.querySelector('[data-sheet-scrim]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
    await sleep(400)
    check('tapping the scrim closes the sheet', await evaluate(`${UI}.panels.sessions.open === false`))

    await cmd('Emulation.clearDeviceMetricsOverride')
    await waitFor(`${UI}.narrow === false`, 5000, 'wide').catch(() => null)
    await evaluate(`${UI}.panels.sessions.open = true`)
    await sleep(400)
    check('wide window keeps the side panel', await evaluate(`!document.querySelector('aside[data-sheet]') && !!document.querySelector('aside[data-tour=sessions]')`))
    await evaluate(`${S}.get('terminals').remove('${FAKE}')`)
  } catch (e) {
    check('run', false, e.message)
  } finally {
    app.stop()
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
