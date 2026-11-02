// v77 R10 prompt samples + import / export and R11 workspace restore after a restart, on temp folders only.
// CCM_E2E_PROMPTS_FILE stands in for both native file dialogs. Phase A builds two shells that `cd` into sub folders,
// then the app is killed (an unclean exit); phase B gets the "closed unexpectedly" picker with every project ticked,
// one saved folder deleted meanwhile; phase C runs with "Reopen" and restores without any click.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const P = `${S}.get('prompts')`
const UI = `${S}.get('ui')`
const VERSION = require('../package.json').version
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v77b-')))
const ONE = path.join(FAKE, 'one')
const SUB = path.join(ONE, 'sub')
const TWO = path.join(FAKE, 'two')
const GONE = path.join(TWO, 'gone')
const FILE = path.join(FAKE, 'orrery-prompts.json')
const RUN_STATE = path.join(OUT, 'run', 'data', 'run-state.json')
const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

const env = { CCM_E2E_PROMPTS_FILE: FILE, CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0' }
const ctx = (app) => {
  const click = (sel) => app.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.scrollIntoView({ block: 'center' }); b.click() })()`)
  const text = (sel) => app.evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  return { ...app, click, text }
}
const step = async (app, name, fn) => {
  try {
    await fn()
  } catch (e) {
    check(name, false, e.message)
    await app.shot(`v77b-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
  }
}

async function cdInto(app, key, dir, name) {
  await app.evaluate(`${W}.activate('${key}')`)
  await app.waitFor(`!!${W}.panes.find((p) => p.key === '${key}')?.liveCwd`, 15000, 'first cwd report').catch(() => {})
  await app.sleep(500)
  await app.evaluate(`document.querySelector('[data-pane="${key}"] .xterm-helper-textarea').focus()`)
  await app.type(`cd ${name}`)
  await app.key('Enter', 'Enter', 13)
  await app.waitFor(`${W}.panes.find((p) => p.key === '${key}')?.liveCwd?.toLowerCase() === ${JSON.stringify(dir.toLowerCase())}`, 15000, `cd ${name}`)
}

async function phaseA(app) {
  const { evaluate, waitFor, shot, sleep, cmd, click, text } = ctx(app)
  await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${UI}`, 30000, 'reloaded')
  await evaluate(`${UI}.view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'launch picker')

  await step(app, 'shells', async () => {
    await evaluate(`${W}.open('shell', ${JSON.stringify(ONE)})`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(TWO)})`)
    await waitFor(`${W}.panes.length === 2 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'two shells')
    await sleep(1500)
    const [a, b] = await evaluate(`${W}.panes.map((p) => p.key)`)
    await cdInto(app, a, SUB, 'sub')
    await cdInto(app, b, GONE, 'gone')
    await sleep(500)
    const snap = JSON.parse(await evaluate(`localStorage.getItem('ccm.workspace.last')`))
    const byHome = (home) => snap.panes.find((p) => same(p.home, home))
    check('snapshot keeps the folder each shell cd-ed to, with its start folder', same(byHome(ONE)?.cwd, SUB) && same(byHome(TWO)?.cwd, GONE), JSON.stringify(snap.panes.map((p) => [p.cwd, p.home])))
  })

  await step(app, 'samples', async () => {
    await evaluate(`${P}.open = true`)
    await waitFor(`!!document.querySelector('[data-prompt-picker] [data-prompt-samples-head]')`, 10000, 'samples group')
    const rows = await evaluate(`document.querySelectorAll('[data-prompt-row^="s:"]').length`)
    check('picker lists 12 built-in samples under "Samples"', rows === 12 && /Samples/.test(await text('[data-prompt-samples-head]')), rows)
    await click('[data-prompt-row="s:explain-file"]')
    check('sample preview keeps {file} visible when no file is open', /Explain \{file\}/.test(await text('[data-prompt-preview]')), await text('[data-prompt-preview]'))
    await shot('v77b-01-samples')
    await click('[data-prompt-row="s:find-bugs"] [data-prompt-hide]')
    await waitFor(`!document.querySelector('[data-prompt-row="s:find-bugs"]')`, 3000, 'hidden')
    check('hiding a sample removes it and offers "Show hidden samples (1)"', /\(1\)/.test(await text('[data-prompt-samples-head] [data-prompt-samples-show]')))
    check('hidden sample remembered', (await evaluate(`localStorage.getItem('ccm.prompts.hiddenSamples')`)) === '["find-bugs"]')
    await click('[data-prompt-samples-off]')
    await waitFor(`!document.querySelector('[data-prompt-row^="s:"]')`, 3000, 'group off')
    check('"Hide samples" hides the whole group, a "Show samples" link stays', await evaluate(`!!document.querySelector('[data-prompt-samples-show]')`))
    await click('[data-prompt-samples-show]')
    await waitFor(`document.querySelectorAll('[data-prompt-row^="s:"]').length === 12`, 3000, 'all back')
    check('"Show samples" brings all 12 back', true)

    await click('[data-prompt-row="s:review-diff"] [data-prompt-duplicate]')
    await waitFor(`!!document.querySelector('[data-prompt-name]')`, 3000, 'edit form')
    check('"Duplicate to edit" opens the editor with the sample', (await evaluate(`document.querySelector('[data-prompt-name]').value`)) === 'Review my changes' && /\{diffstat\}/.test(await evaluate(`document.querySelector('[data-prompt-text]').value`)))
    await click('[data-prompt-save]')
    await waitFor(`${P}.list.length === 1`, 3000, 'saved copy')
    check('duplicate saved as an own prompt; the sample stays', (await evaluate(`${P}.list[0].name`)) === 'Review my changes' && (await evaluate(`!!document.querySelector('[data-prompt-row="s:review-diff"]')`)))
  })

  await step(app, 'export import', async () => {
    await click('[data-prompt-export]')
    await waitFor(`/Exported/.test(document.querySelector('[data-prompt-notice]')?.textContent ?? '')`, 8000, 'exported')
    const file = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    check('export writes the library (no samples, no ids)', file.format === 'orrery-prompts' && file.prompts.length === 1 && !('id' in file.prompts[0]) && file.prompts[0].name === 'Review my changes', JSON.stringify(file).slice(0, 160))
    fs.writeFileSync(FILE, JSON.stringify({ prompts: [{ name: 'Review my changes', text: 'Changed text', scope: 'global' }, { name: 'From a friend', text: 'Look at {file}' }, { name: 'Broken' }] }))
    await click('[data-prompt-import]')
    await waitFor(`!!document.querySelector('[data-prompt-clash]')`, 8000, 'clash bar')
    check('same name asks Overwrite / Keep both / Skip', /same name/.test(await text('[data-prompt-clash]')) && (await evaluate(`document.querySelectorAll('[data-clash]').length`)) === 3)
    await shot('v77b-02-import-clash')
    await click('[data-clash="both"]')
    await waitFor(`${P}.list.length === 3`, 3000, 'imported')
    const names = await evaluate(`${P}.list.map((p) => p.name).join('|')`)
    check('"Keep both" adds "(2)" copy and the new prompt; invalid entry dropped', names === 'Review my changes|Review my changes (2)|From a friend', names)
    check('import result shown', /Imported 2, replaced 0, skipped 0/.test(await text('[data-prompt-notice]')), await text('[data-prompt-notice]'))
    fs.writeFileSync(FILE, '{"not":"prompts"}')
    await click('[data-prompt-import]')
    await waitFor(`/not a prompt list/.test(document.querySelector('[data-prompt-notice]')?.textContent ?? '')`, 8000, 'invalid file')
    check('a file that is not a prompt list is refused', true)
    await evaluate(`${P}.open = false`)
  })

  await step(app, 'settings', async () => {
    await evaluate(`${UI}.settingsPage = 'general'; ${UI}.settingsOpen = true`)
    await waitFor(`!!document.querySelector('[data-setting="restore-mode"]')`, 8000, 'restore mode row')
    const opts = await evaluate(`[...document.querySelectorAll('[data-setting="restore-mode"] [role=radio]')].map((b) => b.textContent.trim() + (b.getAttribute('aria-checked') === 'true' ? '*' : '')).join('|')`)
    check('Settings › Startup: "When the app opens" Ask* / Reopen / Do nothing', opts === 'Ask*|Reopen|Do nothing', opts)
    await shot('v77b-03-settings')
    await evaluate(`${UI}.settingsOpen = false`)
  })
  check('run-state marks the app as running', JSON.parse(fs.readFileSync(RUN_STATE, 'utf8')).running === true)
  // Chromium commits localStorage on a delay; give it time before the hard kill.
  await sleep(9000)
}

async function phaseB(app) {
  const { evaluate, waitFor, shot, sleep, click, text } = ctx(app)
  await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready (B)')
  await evaluate(`${UI}.view = 'workspace'`)
  await step(app, 'unclean picker', async () => {
    await waitFor(`!!document.querySelector('[data-restore-unclean]')`, 15000, 'unclean line')
    check('after a kill the picker says Orrery closed unexpectedly', /closed unexpectedly/.test(await text('[data-restore-unclean]')), await text('[data-restore-unclean]'))
    const ticks = await evaluate(`[...document.querySelectorAll('[data-restore-project]')].map((b) => b.checked)`)
    check('every project ticked by default', ticks.length === 2 && ticks.every(Boolean), JSON.stringify(ticks))
    check('no login hint in a dev build (no login item)', !(await evaluate(`!!document.querySelector('[data-restore-login]')`)))
    await shot('v77b-04-unclean-picker')
    await click('[data-restore-run]')
    await waitFor(`${W}.panes.length === 2 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'restored shells')
    const cwds = await evaluate(`${W}.panes.map((p) => p.cwd)`)
    check('shell reopens in the folder it had cd-ed to', cwds.some((c) => same(c, SUB)), JSON.stringify(cwds))
    check('deleted folder falls back to the start folder', cwds.some((c) => same(c, TWO)) && !cwds.some((c) => same(c, GONE)), JSON.stringify(cwds))
  })
  await step(app, 'set reopen', async () => {
    await evaluate(`${UI}.settingsPage = 'general'; ${UI}.settingsOpen = true`)
    await waitFor(`!!document.querySelector('[data-setting="restore-mode"]')`, 8000, 'restore mode row')
    await evaluate(`[...document.querySelectorAll('[data-setting="restore-mode"] [role=radio]')].find((b) => b.textContent.trim() === 'Reopen').click()`)
    await waitFor(`localStorage.getItem('ccm.workspace.restoreMode') === 'auto'`, 3000, 'mode stored')
    check('"Reopen" stored', true)
    await evaluate(`${UI}.settingsOpen = false`)
  })
  await sleep(9000)
}

async function phaseC(app) {
  const { evaluate, waitFor, shot, sleep } = ctx(app)
  await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready (C)')
  await step(app, 'auto reopen', async () => {
    await waitFor(`${W}.panes.length === 2`, 20000, 'auto restored')
    check('"Reopen" restores the last workspace without a click', true)
    await waitFor(`${W}.panes.every((p) => p.state === 'running')`, 25000, 'shells running in the background')
    check('restored shells are running', true)
    await evaluate(`${UI}.view = 'workspace'`)
    await sleep(800)
    check('no restore picker after an automatic reopen', !(await evaluate(`!!document.querySelector('[data-restore-picker]')`)))
    await shot('v77b-05-auto-reopened')
  })
}

async function main() {
  fs.mkdirSync(SUB, { recursive: true })
  fs.mkdirSync(GONE, { recursive: true })
  let app = await launch({ env })
  try {
    await phaseA(app)
  } catch (e) {
    check('phase A', false, e.message)
  } finally {
    app.stop()
  }
  await new Promise((r) => setTimeout(r, 2500))
  fs.rmSync(GONE, { recursive: true, force: true })
  app = await launch({ env, keep: true })
  try {
    await phaseB(app)
  } catch (e) {
    check('phase B', false, e.message)
  } finally {
    app.stop()
  }
  await new Promise((r) => setTimeout(r, 2500))
  app = await launch({ env, keep: true })
  try {
    await phaseC(app)
  } catch (e) {
    check('phase C', false, e.message)
  } finally {
    app.stop()
  }
  fs.rmSync(FAKE, { recursive: true, force: true })
  console.log(`\n${results.filter((r) => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASSED'} (${results.length} checks)`)
}

main().catch((e) => {
  console.log('FAIL crashed — ' + e.message)
  process.exit(1)
})
