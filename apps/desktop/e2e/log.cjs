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

  // Regex with an incomplete pattern: git exits 128; the filter bar must stay and recover.
  await evaluate(`document.querySelector('[data-log-pane] [aria-label="Regex"]').click()`)
  await evaluate(`(() => { const i = document.querySelector('[data-log-text]'); i.value = 'fix('; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await waitFor(`!!document.querySelector('[data-log-error]')`, 8000, 'regex error').catch(() => {})
  check('a bad regex shows the error in the table area and keeps the filter bar', await evaluate(`!!document.querySelector('[data-log-error]') && !!document.querySelector('[data-log-text]') && !!document.querySelector('[data-log-refs]') && !!document.querySelector('[data-log-error-retry]')`))
  await evaluate(`document.querySelector('[data-log-error-clear]').click()`)
  await waitFor(`document.querySelectorAll('[data-log-table] [data-commit]').length === 4`, 8000, 'rows back').catch(() => {})
  check('Clear filters on the error brings the rows back', (await evaluate(`document.querySelectorAll('[data-log-table] [data-commit]').length`)) === 4)
  await evaluate(`document.querySelector('[data-log-pane] [aria-label="Regex"]').click()`)

  // Select the merge: files vs first parent + details.
  await evaluate(`[...document.querySelectorAll('[data-log-table] [data-commit]')].find((r) => r.textContent.includes('Merge feature/x')).click()`)
  await waitFor(`!!document.querySelector('[data-log-file="b.txt"]')`, 8000, 'merge files').catch(() => {})
  check('merge lists files against the first parent', await evaluate(`!!document.querySelector('[data-log-file="b.txt"]')`))
  check('details show the message and hash', await evaluate(`document.querySelector('[data-log-details]').textContent.includes('Merge feature/x') && !!document.querySelector('[data-log-hash]')`))
  await evaluate(`document.querySelector('[data-log-contains]').click()`)
  await waitFor(`document.querySelector('[data-log-details]').textContent.includes('main')`, 8000, 'contains').catch(() => {})
  check('"In N branches" lists main', await evaluate(`document.querySelector('[data-log-details]').textContent.includes('main')`))
  await shot('log-02-details')
  // Fixed table widths: columns must fit or hide, never clip.
  const atWidth = (w) => evaluate(`(async () => {
    const wrap = document.querySelector('[data-log-table]').parentElement
    wrap.style.flex = 'none'; wrap.style.width = '${w}px'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const row = document.querySelector('[data-log-table] [data-commit][aria-selected=true]')
    const rr = row.getBoundingClientRect()
    const subject = row.querySelector('[data-log-subject]').getBoundingClientRect()
    const cells = [...row.children].filter((c) => c.getBoundingClientRect().width > 0)
    const vis = (i) => cells.length > i
    const spans = [...row.children].filter((c) => c.tagName === 'SPAN' && c.getBoundingClientRect().width > 0 && !c.contains(row.querySelector('[data-log-subject]')))
    return {
      subject: subject.width,
      cols: spans.length,
      fits: row.scrollWidth <= row.clientWidth + 1 && cells.every((c) => c.getBoundingClientRect().right <= rr.right + 1) && spans.every((c) => c.getBoundingClientRect().left >= subject.right - 1),
      title: row.title,
      pills: Math.max(0, ...[...row.querySelectorAll('[data-ref-pill]')].map((p) => p.getBoundingClientRect().width)),
    }
  })()`)
  const w300 = await atWidth(300)
  check('300px: author and date hidden, subject readable', w300.cols === 0 && w300.subject > 40 && w300.fits, JSON.stringify(w300))
  await shot('log-02b-300')
  const w460 = await atWidth(460)
  check('460px: author shown, date hidden, nothing clipped', w460.cols === 1 && w460.subject > 40 && w460.fits, JSON.stringify(w460))
  await shot('log-02c-460')
  const w640 = await atWidth(640)
  check('640px: author and date shown, nothing clipped', w640.cols === 2 && w640.subject > 40 && w640.fits, JSON.stringify(w640))
  await shot('log-02d-640')
  check('row title carries author email and date; pills <= 96px', w640.title.includes('e2e@local') && w640.pills > 0 && w640.pills <= 96, w640.title)
  await evaluate(`(() => { const wrap = document.querySelector('[data-log-table]').parentElement; wrap.style.flex = ''; wrap.style.width = '' })()`)

  // Diff of one file, Esc back.
  await evaluate(`document.querySelector('[data-log-file="b.txt"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-log-diff]') && document.querySelector('[data-log-diff]').textContent.includes('b')`, 8000, 'diff').catch(() => {})
  check('double-click opens the file diff', await evaluate(`!!document.querySelector('[data-log-diff]')`))
  await shot('log-03-diff')
  await evaluate(`document.activeElement?.blur?.(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await waitFor(`!document.querySelector('[data-log-diff]')`, 5000, 'back').catch(() => {})
  check('Esc returns to the log', await evaluate(`!document.querySelector('[data-log-diff]') && !!document.querySelector('[data-log-table]')`))

  // v36 Branches toolbar (delete is not driven here: the native confirm cannot be clicked through CDP; test/branches.test.ts covers it).
  check('vertical branches toolbar is shown', await evaluate(`!!document.querySelector('[data-refs-toolbar] [data-refs-action=newBranch]')`))
  await evaluate(`document.querySelector('[data-log-refs] [data-ref="refs/heads/feature/x"]').focus()`)
  await evaluate(`document.querySelector('[data-refs-action=favorite]').click()`)
  await sleep(200)
  check('star marks the branch favorite (icon + stored per repo)', await evaluate(`(() => { const row = document.querySelector('[data-log-refs] [data-ref="refs/heads/feature/x"]'); return !!row?.querySelector('svg[aria-label]') && JSON.stringify(Object.values(JSON.parse(localStorage.getItem('ccm.workspace.logFavorites') ?? '{}'))).includes('feature/x') })()`))
  await evaluate(`document.querySelector('[data-refs-action=compare]').click()`)
  await waitFor(`!!document.querySelector('[data-log-compare]')`, 4000, 'compare').catch(() => {})
  check('Compare with Current shows the compare strip', await evaluate(`!!document.querySelector('[data-log-compare]')`))
  await evaluate(`document.querySelector('[data-log-compare-clear]').click()`)
  await evaluate(`document.querySelector('[data-refs-action=newBranch]').click()`)
  await waitFor(`!!document.querySelector('[data-new-branch-name]')`, 3000, 'new branch').catch(() => {})
  // Submit is :disabled until Vue re-renders after the input: click it on a later tick, not in the same script.
  await evaluate(`(() => { const i = document.querySelector('[data-new-branch-name]'); i.value = 'toolbar-e2e'; i.dispatchEvent(new Event('input')); document.querySelector('[data-new-branch-checkout]').click() })()`)
  await sleep(150)
  await evaluate(`document.querySelector('[data-new-branch-submit]').click()`)
  await waitFor(`!!document.querySelector('[data-log-refs] [data-ref="refs/heads/toolbar-e2e"]')`, 6000, 'branch listed').catch(() => {})
  check('New Branch creates a branch without switching', (await evaluate(`!!document.querySelector('[data-log-refs] [data-ref="refs/heads/toolbar-e2e"]')`)) && git('branch', '--show-current') !== 'toolbar-e2e')
  await shot('log-05-branches-toolbar')
  await evaluate(`document.querySelector('[data-refs-action=collapseAll]').click()`)
  await sleep(150)
  check('Collapse All leaves only section rows', await evaluate(`[...document.querySelectorAll('[data-log-refs] [role=treeitem]')].every((r) => r.getAttribute('aria-level') === '1')`))
  await evaluate(`document.querySelector('[data-refs-action=expandAll]').click()`)
  await evaluate(`document.querySelector('[data-refs-action=more]').click()`)
  await waitFor(`!!document.querySelector('[data-refs-more]')`, 2000, 'more').catch(() => {})
  await evaluate(`document.querySelector('[data-refs-view=group]').click()`)
  await sleep(150)
  check('More › Group by Folder off lists feature/x by its full name', await evaluate(`[...document.querySelectorAll('[data-log-refs] [role=treeitem]')].some((r) => r.dataset.ref === 'refs/heads/feature/x' && r.textContent.includes('feature/x'))`))
  await evaluate(`document.querySelector('[data-refs-view=group]').click()`)
  await evaluate(`document.querySelector('[data-refs-action=more]').click()`)

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
