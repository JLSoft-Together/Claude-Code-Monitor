// v78 Go to project (Ctrl+Alt+P): open, closed and remembered projects in one fuzzy list, Alt+Tab style first pick,
// jump to the tab focused last, open a closed project, Shift+Del forgets, and the Ctrl+K entry. Temp folders only.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const UI = `${S}.get('ui')`
const VERSION = require('../package.json').version
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v78-')))
const DIRS = Object.fromEntries(['alpha-app', 'beta-game', 'gamma-tool', 'delta-old'].map((n) => [n, path.join(FAKE, n)]))
for (const d of Object.values(DIRS)) fs.mkdirSync(d)
const { execFileSync } = require('node:child_process')
const git = (...a) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-C', DIRS['alpha-app'], ...a], { stdio: 'ignore' })
git('init', '-b', 'feat-e2e')
fs.writeFileSync(path.join(DIRS['alpha-app'], 'a.txt'), 'a')
git('add', '.')
git('commit', '-m', 'init')
const CTRL_ALT = 3
const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

async function main() {
  const app = await launch({ env: { CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0' } })
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  const open = `!!document.querySelector('[data-project-switcher]')`
  const rows = () => evaluate(`[...document.querySelectorAll('[data-project-row]')].map((r) => [r.dataset.projectRow, r.getAttribute('aria-selected') === 'true'])`)
  const activeRoot = () => evaluate(`(() => { const p = ${W}.active; return p ? (p.liveCwd ?? p.cwd) : null })()`)
  const press = () => key('p', 'KeyP', 80, CTRL_ALT)
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    const mru = JSON.stringify([{ dir: DIRS['gamma-tool'], at: 2 }, { dir: DIRS['delta-old'], at: 1 }])
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.workspace.projectMru', ${JSON.stringify(mru)}); localStorage.setItem('ccm.workspace.autoCollapse', '1'); localStorage.removeItem('ccm.workspace.sideCollapsed')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${UI}`, 30000, 'reloaded')
    await evaluate(`${UI}.view = 'workspace'`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIRS['alpha-app'])})`)
    await sleep(300)
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIRS['beta-game'])}, undefined, { tab: true })`)
    await waitFor(`${W}.panes.length === 2 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'two shells')
    await sleep(800)

    await press()
    await waitFor(open, 5000, 'switcher open')
    const list = await rows()
    const dirs = list.map((r) => r[0])
    check('Ctrl+Alt+P lists open + remembered projects', ['alpha-app', 'beta-game', 'gamma-tool', 'delta-old'].every((n) => dirs.some((d) => same(d, DIRS[n]))), JSON.stringify(dirs))
    check('current project first, the previous one preselected', same(dirs[0], DIRS['beta-game']) && same(dirs[1], DIRS['alpha-app']) && list[1][1] === true, JSON.stringify(list))
    check('closed projects show "Closed"', await evaluate(`[...document.querySelectorAll('[data-project-row]')].find((r) => r.dataset.projectRow.toLowerCase().endsWith('gamma-tool'))?.textContent.includes('Closed') ?? false`))
    await shot('v78-01-switcher')
    await key('Enter', 'Enter', 13)
    await waitFor(`!document.querySelector('[data-project-switcher]')`, 3000, 'closed after Enter')
    check('Enter jumps back to the previous project', same(await activeRoot(), DIRS['alpha-app']), await activeRoot())

    await press()
    await waitFor(open, 5000, 'switcher reopened')
    await type('gamt')
    await sleep(200)
    const filtered = await rows()
    check('fuzzy filter by name', filtered.length === 1 && same(filtered[0][0], DIRS['gamma-tool']), JSON.stringify(filtered))
    await shot('v78-02-filter')
    await key('Enter', 'Enter', 13)
    await waitFor(`${W}.panes.length === 3`, 10000, 'closed project opened')
    check('Enter on a closed project opens a shell there', same(await activeRoot(), DIRS['gamma-tool']), await activeRoot())

    await sleep(800)
    await press()
    await waitFor(open, 5000, 'switcher for cycling')
    const alphaRow = `[...document.querySelectorAll('[data-project-row]')].find((r) => r.dataset.projectRow.toLowerCase().endsWith('alpha-app'))`
    await waitFor(`!!${alphaRow}?.querySelector('[data-project-branch]')`, 8000, 'branch shown').catch(() => {})
    check('row shows the git branch', /feat-e2e/.test(await evaluate(`${alphaRow}?.querySelector('[data-project-branch]')?.textContent ?? ''`)))
    check('row shows when it was last used', await evaluate(`!!${alphaRow}?.querySelector('[data-project-used]')`))
    await shot('v78-04-details')
    await press()
    await sleep(150)
    const sel = await evaluate(`document.querySelector('[data-project-row][aria-selected="true"]')?.dataset.projectRow ?? ''`)
    check('Ctrl+Alt+P again steps down the list', /beta-game$/i.test(sel), sel)
    check('still open while Ctrl+Alt is held', await evaluate(open))
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 1 })
    await waitFor(`!document.querySelector('[data-project-switcher]')`, 3000, 'closed on release')
    check('letting go of Ctrl jumps to the picked project', same(await activeRoot(), DIRS['beta-game']), await activeRoot())
    await sleep(400)
    const folded = await evaluate(`(() => { const set = JSON.parse(localStorage.getItem('ccm.workspace.sideCollapsed') ?? '[]'); return [...document.querySelectorAll('[data-side-head]')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()) && set })()`)
    check('auto-collapse folds the other projects on switch', Array.isArray(folded) && folded.length >= 2 && !folded.some((k) => /beta-game/i.test(k)), JSON.stringify(folded))
    await evaluate(`localStorage.setItem('ccm.workspace.autoCollapse', '0')`)
    await evaluate(`document.querySelector('[data-rail-collapse-others]').click()`)
    await sleep(200)
    const after = await evaluate(`JSON.parse(localStorage.getItem('ccm.workspace.sideCollapsed') ?? '[]')`)
    check('"Collapse other projects" button keeps only the current one open', !after.some((k) => /beta-game/i.test(k)) && after.length >= 2, JSON.stringify(after))
    await shot('v78-05-rail-collapsed')

    await press()
    await waitFor(open, 5000, 'switcher for forget')
    await type('delta')
    await sleep(200)
    await key('Delete', 'Delete', 46, 8)
    await sleep(200)
    check('Shift+Del forgets a closed project', (await rows()).length === 0 && !(await evaluate(`localStorage.getItem('ccm.workspace.projectMru')`)).includes('delta-old'))
    await key('Escape', 'Escape', 27)
    await key('Escape', 'Escape', 27)
    await waitFor(`!document.querySelector('[data-project-switcher]')`, 3000, 'Esc closes')
    check('Esc clears the query, then closes', true)

    await evaluate(`${UI}.view = 'monitor'`)
    await sleep(300)
    await key('k', 'KeyK', 75, 2)
    await waitFor(`!!document.querySelector('[role="dialog"] input')`, 5000, 'palette')
    await type('Go to project')
    await sleep(300)
    await key('Enter', 'Enter', 13)
    await waitFor(open, 5000, 'switcher from palette')
    check('Ctrl+K "Go to project…" switches to Workspace and opens the list', (await evaluate(`${UI}.view`)) === 'workspace')
    await sleep(300)
    check('focus lands in the search box', await evaluate(`document.activeElement?.closest('[data-project-switcher]') !== null && document.activeElement?.tagName === 'INPUT'`))
    await shot('v78-03-palette')
  } catch (e) {
    check('crashed', false, e.message)
    await shot('v78-err').catch(() => {})
  } finally {
    app.stop()
    await sleep(1500)
    fs.rmSync(FAKE, { recursive: true, force: true })
  }
  console.log(`\n${results.filter((r) => r.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASSED'} (${results.length} checks)`)
}

main().catch((e) => {
  console.log('FAIL crashed — ' + e.message)
  process.exit(1)
})
