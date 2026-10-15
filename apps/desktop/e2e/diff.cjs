// v29 Android Studio style diff: Explorer git colours, file viewer gutter markers + popup + rollback, Changes viewer
// (full file, folds, word marks, F7 across files, [ ], F4, whitespace, split revert), markers gone after a commit.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-diff-')))
const A = path.join(DIR, 'src', 'a.ts')
const CRLF = path.join(DIR, 'crlf.txt')
const base = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`)
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(A, base.join('\n') + '\n')
  fs.writeFileSync(CRLF, ['one', 'two', 'three', 'four'].join('\r\n') + '\r\n')
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  // a.ts: line 3 modified, a line added after 10, line 20 deleted.
  const now = [...base]
  now[2] = 'line three'
  now.splice(19, 1)
  now.splice(10, 0, 'added A')
  fs.writeFileSync(A, now.join('\n') + '\n')
  fs.writeFileSync(CRLF, ['one', 'TWO', 'three', 'four'].join('\r\n') + '\r\n')
  fs.writeFileSync(path.join(DIR, 'new.md'), '# new\n')
}

const filePane = (name) => `[...document.querySelectorAll('[data-kind=file]')].find((p) => p.offsetParent && p.textContent.includes(${JSON.stringify(name)}))`
const confirmDanger = `[...document.querySelectorAll('.ccm-btn-danger')].at(-1).click()`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, key, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.workspace.diffOpts'); localStorage.removeItem('ccm.workspace.changesTree')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(1000)

  // Explorer: names coloured by git status, a letter beside them, folders above changes marked.
  await key('E', 'KeyE', 69, 2 | 8)
  await waitFor(`!!document.querySelector('[data-explorer-tree] [data-git="modified"]')`, 10000, 'git colours').catch(() => {})
  const marks = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-explorer-tree] [data-row-name]')].map((n) => [n.textContent.trim(), n.dataset.git ?? '']))`)
  check('Explorer marks modified / untracked files and the folder above a change', marks['crlf.txt'] === 'modified' && marks['new.md'] === 'untracked' && marks.src === 'dir', JSON.stringify(marks))
  check('status is also text (letter), not colour alone', await evaluate(`[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.textContent.includes('new.md'))?.textContent.includes('U')`))

  // File viewer gutter: modified bar on line 3, added on 11, deletion triangle on 21.
  await evaluate(`${W}.openFile(${JSON.stringify(A)})`)
  await waitFor(`!!${filePane('a.ts')}?.querySelector('.r.g-mod')`, 10000, 'markers').catch(() => {})
  const gutter = await evaluate(`[...${filePane('a.ts')}.querySelectorAll('.r[data-block]')].map((r) => r.dataset.line + ':' + [...r.classList].find((c) => c.startsWith('g-')))`)
  check('gutter markers sit on the changed lines', JSON.stringify(gutter) === JSON.stringify(['3:g-mod', '11:g-add', '21:g-del']), JSON.stringify(gutter))
  check('toolbar shows +/− vs HEAD', /\+2/.test(await evaluate(`${filePane('a.ts')}.querySelector('[data-file-show-diff]')?.textContent ?? ''`)))
  await evaluate(`${filePane('a.ts')}.querySelector('.r[data-line="3"] [data-gutter]').click()`)
  await waitFor(`!!document.querySelector('[data-hunk-popup]')`, 5000, 'popup').catch(() => {})
  const popup = await evaluate(`document.querySelector('[data-hunk-popup]')?.textContent ?? ''`)
  check('marker click opens the popup with the old text', popup.includes('line 3') && popup.includes('1'), popup.slice(0, 120))
  check('popup marks the changed word', await evaluate(`!!document.querySelector('[data-hunk-popup] mark.w-del')`))
  await shot('diff-01-popup')
  await key('F7', 'F7', 118)
  await sleep(300)
  check('F7 in the popup moves to the next change', /2/.test(await evaluate(`document.querySelector('[data-hunk-popup] [role=toolbar]')?.textContent ?? ''`)))

  // Rollback the added line only.
  await evaluate(`document.querySelector('[data-hunk-rollback]').click()`)
  await waitFor(`!!document.querySelector('.ccm-btn-danger')`, 4000, 'confirm').catch(() => {})
  await evaluate(confirmDanger)
  await waitFor(`${filePane('a.ts')}.querySelectorAll('.r[data-block]').length === 2`, 8000, 'markers after rollback').catch(() => {})
  const after = fs.readFileSync(A, 'utf8')
  check('rollback removes only that change', !after.includes('added A') && after.includes('line three') && !after.includes('line 20\n'), JSON.stringify(after.slice(0, 40)))

  // CRLF file: rollback through the gutter keeps CRLF.
  await evaluate(`${W}.openFile(${JSON.stringify(CRLF)})`)
  await waitFor(`!!${filePane('crlf.txt')}?.querySelector('.r.g-mod [data-gutter], .r.g-mod')`, 10000, 'crlf markers').catch(() => {})
  await evaluate(`${filePane('crlf.txt')}.querySelector('.r[data-block] [data-gutter]').click()`)
  await waitFor(`!!document.querySelector('[data-hunk-rollback]')`, 5000, 'crlf popup').catch(() => {})
  await evaluate(`document.querySelector('[data-hunk-rollback]').click()`)
  await waitFor(`!!document.querySelector('.ccm-btn-danger')`, 4000, 'crlf confirm').catch(() => {})
  await evaluate(confirmDanger)
  await sleep(1200)
  check('rollback on a CRLF file restores it byte for byte', fs.readFileSync(CRLF, 'utf8') === ['one', 'two', 'three', 'four'].join('\r\n') + '\r\n')

  // Show diff from the file viewer → Changes pane on that file.
  await evaluate(`${W}.openFile(${JSON.stringify(A)})`)
  await sleep(500)
  await evaluate(`${filePane('a.ts')}.querySelector('[data-file-show-diff]').click()`)
  await waitFor(`!!document.querySelector('[data-diff-position]')`, 10000, 'changes viewer').catch(() => {})
  check('Show diff opens Changes on the file', await evaluate(`[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].some((r) => r.textContent.includes('a.ts'))`))
  check('viewer folds unchanged lines', await evaluate(`!!document.querySelector('[data-kind=changes] [data-fold]')`))
  check('viewer marks changed words', await evaluate(`!!document.querySelector('[data-kind=changes] mark.w-del')`))
  check('position reads change 1 of 2', /1\D+2/.test(await evaluate(`document.querySelector('[data-diff-position]').textContent`)))
  await shot('diff-02-viewer')

  // F7 walks the changes, warns at the end, then moves to the next file.
  await evaluate(`document.querySelector('[data-kind=changes] section').focus()`)
  await key('F7', 'F7', 118)
  await sleep(200)
  check('F7 → change 2 of 2', /2\D+2/.test(await evaluate(`document.querySelector('[data-diff-position]').textContent`)))
  await key('F7', 'F7', 118)
  await sleep(200)
  check('F7 at the last change warns first', await evaluate(`!!document.querySelector('[data-kind=changes] [role=status]')`))
  await key('F7', 'F7', 118)
  await waitFor(`[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].some((r) => r.textContent.includes('new.md'))`, 5000, 'next file').catch(() => {})
  check('F7 again opens the next file', await evaluate(`[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].some((r) => r.textContent.includes('new.md'))`))
  await key('[', 'BracketLeft', 219)
  await waitFor(`[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].some((r) => r.textContent.includes('a.ts'))`, 5000, 'prev file').catch(() => {})
  check('[ goes back a file', await evaluate(`[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].some((r) => r.textContent.includes('a.ts'))`))

  // ← / → step files from the diff; focus stays in the pane (not the list) so the next arrow works too.
  const selected = `[...document.querySelectorAll('[data-kind=changes] [aria-selected=true]')].map((r) => r.textContent).join()`
  // The list selects a.ts before its diff mounts: wait for the diff itself.
  await waitFor(`!!document.querySelector('[data-kind=changes] [role=document]')`, 5000, 'a.ts diff').catch(() => {})
  await evaluate(`document.querySelector('[data-kind=changes] [role=document]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
  await sleep(500)
  check('→ in the diff opens the next file', (await evaluate(selected)).includes('new.md'), await evaluate(selected))
  check('focus stays in the Changes pane, not the file list', await evaluate(`!!document.activeElement?.closest('[data-kind=changes]') && !document.activeElement.closest('[role=listbox], [role=tree]')`))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`)
  await sleep(500)
  check('← goes back to the previous file', (await evaluate(selected)).includes('a.ts'))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }))`)
  await sleep(300)
  check('Alt+→ does not step files', (await evaluate(selected)).includes('a.ts'))
  await sleep(500)
  await key('F4', 'F4', 115)
  await sleep(500)
  check('F4 opens the file at the change', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('a.ts') && p.line === 3)`), JSON.stringify(await evaluate(`${W}.panes.filter((p) => p.kind === 'file').map((p) => [p.path, p.line])`)))

  // Whitespace "ignore all" keeps revert buttons inert; tree mode groups by folder.
  await evaluate(`${W}.openChanges(${JSON.stringify(DIR)})`)
  await sleep(300)
  await evaluate(`document.querySelector('[data-diff-options-button]').click()`)
  await waitFor(`!!document.querySelector('[data-ws="all"]')`, 3000, 'options').catch(() => {})
  await evaluate(`document.querySelector('[data-ws="all"]').click()`)
  await waitFor(`!!document.querySelector('[data-kind=changes] .rv[aria-disabled="true"]')`, 5000, 'blocked').catch(() => {})
  check('ignore whitespace disables revert', await evaluate(`!!document.querySelector('[data-kind=changes] .rv[aria-disabled="true"]')`))
  await evaluate(`document.querySelector('[data-ws="none"]').click()`)
  await evaluate(`document.querySelector('[data-diff-options-button]').click()`)
  await evaluate(`document.querySelector('[data-changes-tree]').click()`)
  await sleep(300)
  check('tree mode groups files by folder', await evaluate(`!!document.querySelector('[data-kind=changes] [role=tree] [aria-expanded]')`))

  // In the folder tree ← / → still fold folders and leave the selection alone. The tree follows its
  // cursor (the selected file), so the first ← moves to the parent folder and the second folds it.
  const shownPath = `document.querySelector('[data-kind=changes] [data-changes-path]')?.textContent ?? ''`
  const before = await evaluate(shownPath)
  await evaluate(`document.querySelector('[data-kind=changes] [role=tree] [aria-expanded=true]').focus()`)
  for (let i = 0; i < 2; i++) {
    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`)
    await sleep(200)
  }
  check('← on a folder row collapses it, selection unchanged', (await evaluate(`document.activeElement?.getAttribute('aria-expanded') === 'false'`)) && (await evaluate(shownPath)) === before, before)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))`)
  await sleep(200)

  // Split view: the » arrow reverts the block.
  await evaluate(`[...document.querySelectorAll('[data-kind=changes] [role=radio]')].find((b) => /side|cột/i.test(b.textContent)).click()`)
  await waitFor(`!!document.querySelector('[data-kind=changes] .is-split .rv:not([aria-disabled])')`, 5000, 'split').catch(() => {})
  await shot('diff-03-split')
  await evaluate(`document.querySelector('[data-kind=changes] .is-split .rv').click()`)
  await waitFor(`!!document.querySelector('.ccm-btn-danger')`, 4000, 'split confirm').catch(() => {})
  await evaluate(confirmDanger)
  await sleep(1200)
  check('split revert restores line 3', fs.readFileSync(A, 'utf8').includes('line 3\n'))

  // Commit from outside: markers and the list empty out.
  git('add', '-A')
  git('commit', '-q', '-m', 'second')
  await evaluate(`${W}.openFile(${JSON.stringify(A)})`)
  await waitFor(`!${filePane('a.ts')}?.querySelector('.r[data-block]')`, 8000, 'markers cleared').catch(() => {})
  check('markers disappear after a commit', await evaluate(`!${filePane('a.ts')}?.querySelector('.r[data-block]')`))
  await shot('diff-04-clean')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('diff-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-diff.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
