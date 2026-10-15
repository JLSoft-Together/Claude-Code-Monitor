// v33 JetBrains side-by-side diff: real lines per side, thin lines for empty sides, word marks, scroll sync, F7, zoom,
// plus a light-well screenshot (xcode-light) to check deleted grey / word marks on a light well.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-split-')))
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })
const base = Array.from({ length: 400 }, (_, i) => `const line${i + 1} = ${i + 1}`)

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'src', 'long.ts'), base.join('\n') + '\n')
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  // long.ts: line 5 modified, 6 lines inserted after 150, lines 300-309 deleted.
  const now = [...base]
  now[4] = 'const line5 = 500'
  now.splice(299, 10)
  now.splice(150, 0, ...Array.from({ length: 6 }, (_, i) => `const added${i} = ${i}`))
  fs.writeFileSync(path.join(DIR, 'src', 'long.ts'), now.join('\n') + '\n')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
  await evaluate(`localStorage.setItem('ccm.workspace.diffOpts', JSON.stringify({ layout: 'split', collapse: false, context: 3, whitespace: 'none', highlight: 'words' }))`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)
  await evaluate(`${W}.openChanges(${JSON.stringify(DIR)}, { select: ${JSON.stringify(path.join(DIR, 'src', 'long.ts'))} })`)
  await waitFor(`!!document.querySelector('[data-kind=changes] [data-split-diff] path.sd-conn')`, 10000, 'split view').catch(() => {})
  await shot('split-diff-01')
  const counts = await evaluate(`[...document.querySelectorAll('[data-kind=changes] [data-side]')].map((p) => p.querySelectorAll('.sd-row').length)`)
  check('no filler rows: left 400 lines, right 396', JSON.stringify(counts) === JSON.stringify([400, 396]), JSON.stringify(counts))
  check('modified rows are tinted on both sides', await evaluate(`document.querySelectorAll('[data-kind=changes] .sd-row.modified').length === 2`))
  check('inserted block: thin line on the left, deleted block: thin line on the right', await evaluate(`!!document.querySelector('[data-kind=changes] [data-side=left] .sd-mark.added') && !!document.querySelector('[data-kind=changes] [data-side=right] .sd-mark.deleted')`))
  check('changed word marked inside the modified line', await evaluate(`!!document.querySelector('[data-kind=changes] [data-side=right] mark.w-mod')`))
  check('change kind is also text (line number tooltip)', await evaluate(`!!document.querySelector('[data-kind=changes] .sd-row.modified .n[title]')`))
  // Scroll sync: scroll the left pane to row 320 (after the inserted 6 and deleted 10 lines the right pane is 4 rows behind).
  const sync = await evaluate(`(async () => {
    const [l, r] = [...document.querySelectorAll('[data-kind=changes] [data-side]')]
    const lh = l.querySelector('.sd-row').getBoundingClientRect().height
    l.scrollTop = 320 * lh - l.clientHeight / 2
    await new Promise((res) => setTimeout(res, 300))
    return { left: (l.scrollTop + l.clientHeight / 2) / lh, right: (r.scrollTop + r.clientHeight / 2) / lh }
  })()`)
  check('scroll sync maps the centre row across fragments', Math.abs(sync.right - (sync.left - 4)) < 0.6, JSON.stringify(sync))
  // F7 lands on the next change and draws its connector as current.
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').focus()`)
  await evaluate(`document.querySelector('[data-kind=changes] [data-side=right]').dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true }))`)
  await sleep(300)
  check('F7 → change 2 of 3 with a current connector', /2\D+3/.test(await evaluate(`document.querySelector('[data-diff-position]').textContent`)) && (await evaluate(`!!document.querySelector('[data-kind=changes] path.sd-conn.is-current')`)))
  // Zoom keeps connectors on the rows.
  await evaluate(`document.documentElement.style.setProperty('--ccm-code-size', '18px')`)
  await sleep(400)
  // Taller rows move the change out of the scrolled px window; connectors are drawn only for visible changes.
  const aligned = await evaluate(`(async () => {
    const row = document.querySelector('[data-kind=changes] [data-side=left] .sd-row.is-current, [data-kind=changes] [data-side=left] .sd-mark.is-current')
    const pane = row.closest('[data-side]')
    pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2
    await new Promise((res) => setTimeout(res, 300))
    const path = document.querySelector('[data-kind=changes] path.sd-conn.is-current')
    if (!path) return 'no current connector'
    const d = path.getAttribute('d')
    const y = Number(/^M0 (-?[\\d.]+)/.exec(d)[1])
    return Math.abs(y - (row.getBoundingClientRect().top - pane.getBoundingClientRect().top))
  })()`)
  check('connectors stay on their rows after zoom', aligned < 1.5, String(aligned))
  await evaluate(`document.documentElement.style.removeProperty('--ccm-code-size')`)
  await shot('split-diff-02-current')
  // The well is light in some themes: tints and the deleted grey must still read there.
  await evaluate(`${S}.get('settings').theme = 'xcode-light'`)
  await sleep(400)
  await shot('split-diff-03-light-well')
  check('light theme keeps a light well', await evaluate(`(() => { const c = getComputedStyle(document.documentElement).getPropertyValue('--ccm-well').trim(); return c === '#ffffff' || c === '#fff' })()`))
  await evaluate(`${S}.get('settings').theme = 'dark'`)
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('split-diff-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-split-diff.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
