// v30 Git Log pane: open from Changes, graph lanes, branch / user / text filters, details + files, per-file diff, auto refresh.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-log-')))
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, encoding: 'utf8' }).trim()
const commitFile = (msg, file, text, author) => {
  fs.writeFileSync(path.join(DIR, file), text)
  git('add', '-A')
  git('commit', '-q', '-m', msg, ...(author ? [`--author=${author}`] : []))
}

function fixture() {
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  commitFile('init', 'a.txt', 'one\n')
  git('checkout', '-q', '-b', 'feature/x')
  commitFile('feat: add b', 'b.txt', 'b\n', 'Bo <bo@local>')
  git('checkout', '-q', 'main')
  commitFile('main: edit a', 'a.txt', 'one\ntwo\n')
  git('merge', '-q', '--no-ff', '-m', 'Merge feature/x', 'feature/x')
  git('tag', 'v1')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.removeItem('ccm.workspace.logCols')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')

  // Open from the Changes pane toolbar.
  await evaluate(`${W}.openChanges(${JSON.stringify(DIR)})`)
  await waitFor(`!!document.querySelector('[data-changes-log]')`, 10000, 'log button')
  await evaluate(`document.querySelector('[data-changes-log]').click()`)
  await waitFor(`document.querySelectorAll('[data-log-table] [data-commit]').length === 4`, 10000, 'log rows').catch(() => {})
  check('Log pane lists every commit', (await evaluate(`document.querySelectorAll('[data-log-table] [data-commit]').length`)) === 4)
  check('graph draws a second lane for the merge', await evaluate(`[...document.querySelectorAll('[data-log-table] svg')].some((s) => s.querySelectorAll('path').length >= 2)`))
  check('ref pills show HEAD branch and tag', await evaluate(`(() => { const t = [...document.querySelectorAll('[data-ref-pill]')].map((p) => p.textContent.trim()); return t.includes('main') && t.includes('v1') })()`))
  await shot('log-01-graph')

  // Branch filter from the tree.
  await evaluate(`document.querySelector('[data-log-refs] [data-ref="refs/heads/feature/x"]').click()`)
  await waitFor(`document.querySelectorAll('[data-log-table] [data-commit]').length === 2`, 8000, 'branch filter').catch(() => {})
  check('branch filter keeps that branch only', (await evaluate(`document.querySelectorAll('[data-log-table] [data-commit]').length`)) === 2)
  await evaluate(`document.querySelector('[data-log-refs] [data-ref="refs/heads/feature/x"]').click()`)

  // Text filter → flat list.
  await evaluate(`(() => { const i = document.querySelector('[data-log-text]'); i.value = 'add b'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await waitFor(`document.querySelectorAll('[data-log-table] [data-commit]').length === 1`, 8000, 'text filter').catch(() => {})
  check('text filter matches the message', (await evaluate(`document.querySelectorAll('[data-log-table] [data-commit]').length`)) === 1)
  check('flat list while filtering by text (one dot, no lane paths)', await evaluate(`document.querySelector('[data-log-table] svg').querySelectorAll('path').length === 0`))
  await evaluate(`document.querySelector('[data-log-clear]').click()`)
  await waitFor(`document.querySelectorAll('[data-log-table] [data-commit]').length === 4`, 8000, 'cleared').catch(() => {})

  // Select the merge: files vs first parent + details.
  await evaluate(`[...document.querySelectorAll('[data-log-table] [data-commit]')].find((r) => r.textContent.includes('Merge feature/x')).click()`)
  await waitFor(`!!document.querySelector('[data-log-file="b.txt"]')`, 8000, 'merge files').catch(() => {})
  check('merge lists files against the first parent', await evaluate(`!!document.querySelector('[data-log-file="b.txt"]')`))
  check('details show the message and hash', await evaluate(`document.querySelector('[data-log-details]').textContent.includes('Merge feature/x') && !!document.querySelector('[data-log-hash]')`))
  await evaluate(`document.querySelector('[data-log-contains]').click()`)
  await waitFor(`document.querySelector('[data-log-details]').textContent.includes('main')`, 8000, 'contains').catch(() => {})
  check('"In N branches" lists main', await evaluate(`document.querySelector('[data-log-details]').textContent.includes('main')`))
  await shot('log-02-details')

  // Diff of one file, Esc back.
  await evaluate(`document.querySelector('[data-log-file="b.txt"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-log-diff]') && document.querySelector('[data-log-diff]').textContent.includes('b')`, 8000, 'diff').catch(() => {})
  check('double-click opens the file diff', await evaluate(`!!document.querySelector('[data-log-diff]')`))
  await shot('log-03-diff')
  await evaluate(`document.activeElement?.blur?.(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(`!document.querySelector('[data-log-diff]')`, 5000, 'back').catch(() => {})
  check('Esc returns to the log', await evaluate(`!document.querySelector('[data-log-diff]') && !!document.querySelector('[data-log-table]')`))

  // Auto refresh after a commit from outside.
  commitFile('outside commit', 'c.txt', 'c\n')
  await waitFor(`[...document.querySelectorAll('[data-log-table] [data-commit]')].some((r) => r.textContent.includes('outside commit'))`, 10000, 'refresh').catch(() => {})
  check('a new commit appears without Refresh', await evaluate(`[...document.querySelectorAll('[data-log-table] [data-commit]')].some((r) => r.textContent.includes('outside commit'))`))
  check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`))
  await shot('log-04-refresh')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('log-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-log.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
