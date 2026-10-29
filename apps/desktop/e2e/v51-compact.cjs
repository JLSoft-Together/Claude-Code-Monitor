const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const T = `${S}.get('terminals')`
const NAV = `document.querySelector('nav[aria-label=Projects]')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v51-')))

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const chord = async (k, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','light'); localStorage.setItem('ccm.workspace.sidebar','1'); localStorage.setItem('ccm.tips', JSON.stringify({ off: true, learned: [], shown: {} }))`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')

  const pane = await evaluate(`${W}.open('shell', ${JSON.stringify(BASE)}, undefined, { tab: true }).key`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(1500)
  const fake = (patch) => evaluate(`${T}.upsert({ id: 'e2e-v51', title: 'e2e-v51', status: 'idle', cwd: ${JSON.stringify(BASE)}, compactions: 0, ...${JSON.stringify(patch)} })`)
  await fake({})
  await evaluate(`${W}.update('${pane}', { preset: 'claude', terminalId: 'e2e-v51' })`)
  await sleep(600)

  const rowMenu = async () => {
    await evaluate(`document.querySelector('[data-side-pane="${pane}"]').closest('[data-rail-row]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 220 }))`)
    await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'row menu')
  }
  const item = (id) => `document.querySelector('[data-context-menu] [data-menu-id="${id}"]')`
  const closeMenu = async () => {
    await key('Escape', 'Escape', 27)
    await sleep(200)
  }
  const output = async () => {
    await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus()`)
    await chord('O', 'KeyO', 79, CTRL | SHIFT)
    await waitFor(`!!document.querySelector('[data-mission][role=dialog]')`, 5000, 'mission open')
    await sleep(600)
    const text = await evaluate(`document.querySelector('[data-mission-tile="${pane}"] [data-mission-output]')?.textContent ?? ''`)
    await key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed')
    return text
  }

  await fake({ status: 'working' })
  await sleep(300)
  await rowMenu()
  check('Compact is disabled while the session works', await evaluate(`${item('compact')}?.getAttribute('aria-disabled') === 'true' || ${item('compact')}?.disabled === true`))
  await closeMenu()
  await fake({ status: 'idle' })
  await sleep(300)

  await rowMenu()
  check('rail row menu offers Compact for an idle agent', await evaluate(`!!${item('compact')} && ${item('compact')}.getAttribute('aria-disabled') !== 'true'`))
  await shot('v51-01-menu')
  await evaluate(`${item('compact')}.click()`)
  await sleep(800)
  const flow = await evaluate(`JSON.stringify(${W}.panes.find((p) => p.key === '${pane}').compact ?? null)`).then(JSON.parse)
  const file = flow?.file ?? ''
  check('flow starts in "writing" with a .planning/HANDOFF file', flow?.step === 'writing' && /\.planning[\\/]HANDOFF-\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(file), file)
  check('handoff prompt sent (prefill consumed)', await evaluate(`!${W}.panes.find((p) => p.key === '${pane}').prefill`))
  check('pane header shows "writing" chip', await evaluate(`!!document.querySelector('[data-pane="${pane}"] [data-compact-step="writing"]')`))
  let sent = ''
  for (let i = 0; i < 15 && !/CommandNotFoundException|not recognized/i.test(sent); i++) {
    await sleep(1000)
    sent = await output()
  }
  check('prompt text reached the pane and was submitted (shell ran it)', /handoff|CommandNotFoundException|not recognized/i.test(sent), sent.slice(-200))
  await shot('v51-02-writing')

  await fake({ status: 'working' })
  await sleep(400)
  await fake({ status: 'idle' })
  await waitFor(`!!document.querySelector('[data-pane="${pane}"] [data-compact-step="missing"]')`, 5000, 'missing chip').catch(() => {})
  check('idle without the file: waits and says no handoff yet', await evaluate(`${W}.panes.find((p) => p.key === '${pane}').compact?.step === 'writing' && !!document.querySelector('[data-pane="${pane}"] [data-compact-step="missing"]')`))

  await fake({ status: 'working' })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '# Handoff\n\n- doing: e2e\n')
  await sleep(400)
  await fake({ status: 'idle' })
  await waitFor(`${W}.panes.find((p) => p.key === '${pane}').compact?.step === 'compact'`, 6000, 'compact step').catch(() => {})
  check('file written + idle: step "compact"', await evaluate(`${W}.panes.find((p) => p.key === '${pane}').compact?.step === 'compact'`))
  check('chip says the handoff is ready', await evaluate(`!!document.querySelector('[data-pane="${pane}"] [data-compact-step="compact"]')`))
  await sleep(800)
  check('/compact typed into the input, not submitted', /\/compact\s*$/.test((await output()).trimEnd()), '')
  await shot('v51-03-compact-typed')

  await fake({ status: 'idle', compactions: 1 })
  await waitFor(`!${W}.panes.find((p) => p.key === '${pane}').compact`, 5000, 'flow ends').catch(() => {})
  check('compaction seen: flow ends', await evaluate(`!${W}.panes.find((p) => p.key === '${pane}').compact`))
  await sleep(800)
  const after = await output()
  const tail = after.trimEnd().split('\n').slice(-3).join('')
  check('resume line prefilled at the prompt (after /compact), not submitted', /\/compact\s*Read\b/.test(tail.replace(/\s+/g, ' ')) && /continue\.$/.test(tail), tail.slice(-160))
  check('chip cleared', await evaluate(`!document.querySelector('[data-pane="${pane}"] [data-compact-step]')`))
  await shot('v51-04-resume')

  await rowMenu()
  await evaluate(`${item('compact')}.click()`)
  await sleep(500)
  await rowMenu()
  check('menu offers Cancel compact while a flow runs', await evaluate(`!!${item('compact-cancel')}`))
  await evaluate(`${item('compact-cancel')}.click()`)
  await sleep(400)
  check('cancel drops the flow', await evaluate(`!${W}.panes.find((p) => p.key === '${pane}').compact`))

  const tab = await evaluate(`${W}.tabOf('${pane}').key`)
  await evaluate(`document.querySelector('[data-tab-item="${tab}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 80 }))`)
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'tab menu')
  check('tab menu offers Compact for the tab agent', await evaluate(`!!${item('compact')}`))
  await closeMenu()
  await evaluate(`${W}.update('${pane}', { preset: 'shell', terminalId: undefined })`)
}

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('v51-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-v51.txt'), results.join('\n'))
    try {
      fs.rmSync(BASE, { recursive: true, force: true })
    } catch {}
    process.exit(0)
  }
})()
