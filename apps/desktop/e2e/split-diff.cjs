// v33 JetBrains side-by-side diff: real lines per side, thin lines for empty sides, word marks, scroll sync, F7, zoom,
// plus a light-well screenshot (xcode-light) to check deleted grey / word marks on a light well. Gaps 2026-10-15:
// Highlight chars / split / none, Align changes, Sync scrolling off, Ignore imports, Ctrl+Shift+D, split view in the Log.
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
  fs.writeFileSync(path.join(DIR, 'src', 'imp.ts'), "import { a } from './a'\n\nexport const x = a\nexport const y = 1\n")
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
  // imp.ts: one import-only change and one real change.
  fs.writeFileSync(path.join(DIR, 'src', 'imp.ts'), "import { a } from './b'\n\nexport const x = a\nexport const y = 2\n")
}

const C = '[data-kind=changes]'
const position = `document.querySelector('${C} [data-diff-position]')?.textContent ?? ''`

/** Opens the viewer settings menu if needed and clicks `sel` in it. */
async function pick(app, sel) {
  const { evaluate, waitFor, sleep } = app
  if (!(await evaluate(`!!document.querySelector('[data-diff-options]')`))) await evaluate(`document.querySelector('${C} [data-diff-options-button]').click()`)
  await waitFor(`!!document.querySelector('[data-diff-options] ${sel}')`, 3000, sel).catch(() => {})
  await evaluate(`document.querySelector('[data-diff-options] ${sel}').click()`)
  await sleep(400)
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
  check('split view has syntax colours (shiki tokens resolve)', await evaluate(`(() => {
    const spans = [...document.querySelectorAll('[data-kind=changes] [data-split-diff] [data-side] span[style*="--shiki"]')]
    return new Set(spans.map((s) => getComputedStyle(s).color)).size >= 2
  })()`))
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
  await sleep(300)

  // Highlight levels: characters mark only the changed digits of line 5 (5 → 500), words the whole number.
  const marked = `[...document.querySelectorAll('${C} [data-side=right] mark')].map((m) => m.textContent).join('|')`
  check('Words marks the whole changed word', (await evaluate(marked)) === '500', await evaluate(marked))
  await pick(app, '[data-hl="chars"]')
  check('Characters marks only the changed characters', (await evaluate(marked)) === '00', await evaluate(marked))
  await pick(app, '[data-hl="split"]')
  check('Split changes: the modified block becomes deleted + inserted (4 changes)', /4\s*$/.test((await evaluate(position)).trim()) && (await evaluate(`!!document.querySelector('${C} [data-side=left] .sd-row.deleted') && !document.querySelector('${C} .sd-row.modified')`)), await evaluate(position))
  await pick(app, '[data-hl="none"]')
  check('None: no row tint, no word marks, connectors stay', await evaluate(`(() => {
    const row = document.querySelector('${C} [data-side=right] .sd-row[data-block]')
    return !!document.querySelector('${C} .is-split.hl-none') && !document.querySelector('${C} [data-side] mark') && getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)' && !!document.querySelector('${C} path.sd-conn')
  })()`))
  await pick(app, '[data-hl="words"]')

  // Align changes: filler rows under the shorter side, both sides the same height.
  await pick(app, '[data-diff-toggle="align"]')
  const rows = await evaluate(`[...document.querySelectorAll('${C} [data-side]')].map((p) => [p.querySelectorAll('.sd-row').length, p.querySelectorAll('.sd-row.pad').length])`)
  check('Align changes pads both sides to 406 rows (6 + 10 filler)', JSON.stringify(rows) === JSON.stringify([[406, 6], [406, 10]]), JSON.stringify(rows))
  check('Align changes is stored', await evaluate(`JSON.parse(localStorage.getItem('ccm.workspace.diffOpts')).align === true`))
  await shot('split-diff-04-aligned')
  await pick(app, '[data-diff-toggle="align"]')

  // Synchronize scrolling off: the right side stays put.
  await pick(app, '[data-diff-toggle="sync"]')
  const unsynced = await evaluate(`(async () => {
    const [l, r] = [...document.querySelectorAll('${C} [data-side]')]
    r.scrollTop = 0
    await new Promise((res) => setTimeout(res, 100))
    l.scrollTop = 200 * l.querySelector('.sd-row').getBoundingClientRect().height
    await new Promise((res) => setTimeout(res, 300))
    return { left: l.scrollTop, right: r.scrollTop }
  })()`)
  check('Sync scrolling off leaves the other side alone', unsynced.left > 0 && unsynced.right === 0, JSON.stringify(unsynced))
  await pick(app, '[data-diff-toggle="sync"]')
  check('Sync scrolling is stored', await evaluate(`JSON.parse(localStorage.getItem('ccm.workspace.diffOpts')).sync === true`))

  // Ctrl+Shift+D: the diff command popup (the viewer menu with its Commands group).
  await evaluate(`document.querySelector('[data-diff-options]') && document.querySelector('${C} [data-diff-options-button]').click()`)
  await sleep(200)
  await evaluate(`document.querySelector('${C} [data-side=right]').dispatchEvent(new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))`)
  await sleep(300)
  check('Ctrl+Shift+D opens the diff commands', (await evaluate(`document.querySelectorAll('[data-diff-options] [data-diff-cmd]').length`)) >= 5)
  await evaluate(`document.querySelector('[data-diff-options] [data-diff-cmd="nextChange"]').click()`)
  await sleep(300)
  check('a command runs and closes the popup', !(await evaluate(`!!document.querySelector('[data-diff-options]')`)))

  // Ignore imports: imp.ts keeps only its real change and says what it hid.
  await evaluate(`${W}.openChanges(${JSON.stringify(DIR)}, { select: ${JSON.stringify(path.join(DIR, 'src', 'imp.ts'))} })`)
  await waitFor(`(document.querySelector('${C} [data-changes-path]')?.textContent ?? '').includes('imp.ts')`, 8000, 'imp.ts').catch(() => {})
  await sleep(400)
  check('imp.ts has 2 changes when comparing all', /2\s*$/.test((await evaluate(position)).trim()), await evaluate(position))
  await pick(app, '[data-ws="imports"]')
  await waitFor(`!!document.querySelector('${C} [data-diff-imports-hidden]')`, 5000, 'imports hidden').catch(() => {})
  check('Ignore imports hides the import-only change and says so', !!(await evaluate(`document.querySelector('${C} [data-diff-imports-hidden]')`)) && /1\s*$/.test((await evaluate(position)).trim()), await evaluate(position))
  await pick(app, '[data-ws="none"]')
  await evaluate(`document.querySelector('[data-diff-options]') && document.querySelector('${C} [data-diff-options-button]').click()`)

  // Split view in the Log: <hash>^ / <hash>; the root commit has no parent side.
  git('add', '-A')
  git('commit', '-q', '-m', 'edit long')
  const hashes = execFileSync('git', ['log', '--format=%h%x09%s', '--abbrev=8'], { cwd: DIR, encoding: 'utf8' }).trim().split('\n').map((l) => l.split('\t'))
  await evaluate(`document.querySelector('${C} [data-changes-log]').click()`)
  await waitFor(`document.querySelectorAll('[data-log-table] [data-commit]').length === 2`, 10000, 'log rows').catch(() => {})
  const openLogDiff = async (subject) => {
    await evaluate(`[...document.querySelectorAll('[data-log-table] [data-commit]')].find((r) => r.textContent.includes(${JSON.stringify(subject)})).click()`)
    await waitFor(`!!document.querySelector('[data-log-file="src/long.ts"]')`, 8000, 'files').catch(() => {})
    await evaluate(`document.querySelector('[data-log-file="src/long.ts"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
    await waitFor(`!!document.querySelector('[data-log-diff] [data-split-head=left]')`, 8000, 'log split').catch(() => {})
    await sleep(300)
    return evaluate(`[...document.querySelectorAll('[data-log-diff] [data-split-head]')].map((h) => h.textContent.trim())`)
  }
  const [edit, root] = [hashes[0], hashes[1]]
  const heads = await openLogDiff('edit long')
  check('Log split view heads read <hash>^ / <hash>', heads[0] === `${edit[0]}^` && heads[1] === edit[0], JSON.stringify(heads))
  await shot('split-diff-05-log')
  await evaluate(`document.querySelector('[data-log-diff-back]').click()`)
  await waitFor(`!document.querySelector('[data-log-diff]')`, 5000, 'back').catch(() => {})
  const rootHeads = await openLogDiff(root[1])
  check('root commit: no <hash>^ side, an empty label instead', !rootHeads[0].includes('^') && /none|không/i.test(rootHeads[0]) && rootHeads[1] === root[0], JSON.stringify(rootHeads))
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
