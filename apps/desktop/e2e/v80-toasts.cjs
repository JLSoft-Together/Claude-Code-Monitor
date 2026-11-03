// v80 WP-8: one toast stack (cap 3, dedupe, hover pause, Esc, break toast, no stealing Esc from a dialog).
const { launch, sleep } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const T = `${S}.get('toasts')`
const UI = `${S}.get('ui')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, key, shot } = app
  const count = () => evaluate(`document.querySelectorAll('[data-toast]').length`)
  try {
    await waitFor(`!!window.ccmDesktop && !!${T} && ${S}.get('connection').state === 'connected'`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone', '1'); localStorage.setItem('ccm.tourWorkspaceDone', '1')`)
    for (let i = 0; i < 20; i++) {
      await evaluate(`${UI}.setupOpen = false; ${UI}.tourOpen = false; ${UI}.whatsNewOpen = false`)
      await sleep(400)
      if (!(await evaluate(`!!document.querySelector('[role="dialog"], [aria-modal="true"]')`))) break
    }
    await evaluate(`document.activeElement?.blur?.(); document.body.focus()`)

    await evaluate(`for (const id of ['a', 'b', 'c', 'd']) ${T}.push({ id, kind: 'info', text: 'toast ' + id, timeoutMs: 0 })`)
    await sleep(400)
    check('four pushed, three shown', (await count()) === 3 && (await evaluate(`${T}.list.length`)) === 4)
    await evaluate(`${T}.push({ id: 'd', kind: 'info', text: 'toast d again', timeoutMs: 0 })`)
    check('same id replaces in place', (await evaluate(`${T}.list.length`)) === 4 && (await evaluate(`document.body.textContent.includes('toast d again')`)))
    await shot('v80-toasts-stack')

    await key('Escape', 'Escape', 27)
    await sleep(400)
    check('Esc closes the newest, the waiting one takes its place', (await evaluate(`${T}.list.map((t) => t.id).join('')`)) === 'abc' && (await count()) === 3)

    await evaluate(`${UI}.shortcutsOpen = true`)
    await sleep(500)
    await key('Escape', 'Escape', 27)
    await sleep(400)
    check('Esc with a dialog open closes the dialog, not a toast', (await evaluate(`${T}.list.length`)) === 3 && !(await evaluate(`${UI}.shortcutsOpen`)))

    await evaluate(`${T}.list.splice(0); ${T}.push({ id: 'h', kind: 'info', text: 'held', timeoutMs: 1500 })`)
    await sleep(300)
    await evaluate(`${T}.hold('h', true)`)
    await sleep(2200)
    check('hover holds the countdown', (await evaluate(`${T}.list.length`)) === 1)
    await evaluate(`${T}.hold('h', false)`)
    await sleep(2200)
    check('release restarts it and the toast leaves', (await evaluate(`${T}.list.length`)) === 0)

    await evaluate(`${UI}.breakDue = { at: Date.now(), minutes: 95 }`)
    await waitFor(`!!document.querySelector('[data-toast="break"]')`, 4000, 'break toast')
    check('break toast shows title, body and two buttons', await evaluate(`document.querySelectorAll('[data-toast="break"] button.ccm-btn').length === 2 && !!document.querySelector('[data-toast="break"] h2')`))
    await evaluate(`document.querySelector('[data-toast="break"] .ccm-btn-primary').click()`)
    await sleep(500)
    check('"Done" clears it and breakDue', !(await evaluate(`!!document.querySelector('[data-toast="break"]')`)) && (await evaluate(`${UI}.breakDue === null`)))
  } finally {
    console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} pass, ${results.filter((r) => r.startsWith('FAIL')).length} fail`)
    app.stop()
  }
})().catch((e) => { console.error(e); process.exit(1) })
