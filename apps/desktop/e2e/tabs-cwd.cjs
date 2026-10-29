// v2.1.0 fixes: "+ New" button, stable split-tab label, live shell cwd (links / branch), persisted folder grants.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-cwd-')))
const OTHER = path.join(DIR, 'other')
const OUTSIDE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-outside-')))
const GRANTS = path.join(OUT, 'run', 'data', 'preview-grants.json')

function repo(dir, branch) {
  const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', branch)
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
}

function fixture() {
  fs.writeFileSync(path.join(DIR, 'README.md'), '# top\n')
  fs.mkdirSync(path.join(OTHER, 'src'), { recursive: true })
  fs.writeFileSync(path.join(OTHER, 'src', 'y.ts'), 'export const a = 1\nexport const b = 2\nexport const c = 3\n')
  repo(OTHER, 'side')
  // `other` is its own repo; the top repo ignores it so both stay clean.
  fs.writeFileSync(path.join(DIR, '.gitignore'), 'other/\n')
  repo(DIR, 'trunk')
  fs.writeFileSync(path.join(OUTSIDE, 'page.html'), '<!doctype html><title>Outside</title><h1>Outside page</h1>\n')
}

const activeTab = `document.querySelector('[role=tablist][aria-label=Terminals] [role=tab][aria-selected=true]')`

async function phaseOne(app) {
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(1500)

  // Browser-style: the "+" sits right after the tab list, not pinned to the far right.
  const plus = await evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-haspopup=dialog]')].find((b) => b.getAttribute('aria-label') === 'New terminal or tab'); if (!b) return null; const strip = document.querySelector('[role=tablist][aria-label=Terminals]').getBoundingClientRect(); return Math.round(b.getBoundingClientRect().left - strip.right) })()`)
  check('+ button (aria-label "New terminal or tab") follows the last tab', plus !== null && plus >= 0 && plus <= 12, plus)

  // The first prompt already reports the start folder; the branch chip shows the top repo.
  await waitFor(`${W}.panes[0].liveCwd && ${W}.panes[0].branch === 'trunk'`, 15000, 'first cwd report').catch(() => {})
  check('first prompt reports cwd + branch', await evaluate(`${W}.panes[0].branch === 'trunk' && !!${W}.panes[0].liveCwd`), await evaluate(`JSON.stringify([${W}.panes[0].liveCwd, ${W}.panes[0].branch])`))

  // Split a browser next to the shell: the tab keeps naming the shell, the badge counts 2.
  const shellKey = await evaluate(`${W}.panes[0].key`)
  await evaluate(`document.querySelector('[data-pane="${shellKey}"] [data-pane-split]').click()`)
  await waitFor(`!!document.querySelector('[role=menu] [role=menuitem]')`, 5000, 'split menu')
  await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => /Browser/.test(b.textContent)).click()`)
  await waitFor(`${W}.panes.some((p) => p.kind === 'browser') && ${W}.activeKey !== '${shellKey}'`, 5000, 'browser split')
  await sleep(700)
  const label = await evaluate(`${activeTab}.querySelector('[data-tab-label]').textContent.trim()`)
  const badge = await evaluate(`${activeTab}.querySelector('[data-pane-count]')?.textContent.trim()`)
  const named = path.basename(DIR).toLowerCase()
  check('split tab label stays the shell folder while the browser has focus', label.toLowerCase() === named, label)
  check('pane-count badge = 2', /^2/.test(badge ?? ''), badge)
  const tip = await evaluate(`${activeTab}.title`)
  const tipLines = tip.split('\n')
  check('tab tooltip: tab name, project, both panes, rename hint', tipLines[0].toLowerCase() === named && tipLines.some((l) => /^Shell/.test(l)) && tipLines.some((l) => /^Browser/.test(l)) && /F2/.test(tipLines.at(-1)), JSON.stringify(tip))
  await shot('fix-01-tab-label-browser-split')
  await evaluate(`${W}.activate('${shellKey}')`)
  await sleep(300)
  check('label unchanged after focusing the shell again', (await evaluate(`${activeTab}.querySelector('[data-tab-label]').textContent.trim()`)).toLowerCase() === named)

  // cd into the nested repo: live cwd, header path and branch follow it.
  await evaluate(`document.querySelector('[data-pane="${shellKey}"] .xterm-helper-textarea').focus()`)
  await type('cd other')
  await key('Enter', 'Enter', 13)
  await waitFor(`${W}.panes[0].liveCwd?.endsWith('other')`, 10000, 'live cwd').catch(() => {})
  const live = await evaluate(`${W}.panes[0].liveCwd ?? ''`)
  check('cd updates pane.liveCwd', live.toLowerCase() === OTHER.toLowerCase(), live)
  check('start folder unchanged (pane.cwd)', (await evaluate(`${W}.panes[0].cwd`)).toLowerCase() === DIR.toLowerCase())
  await waitFor(`${W}.panes[0].branch === 'side'`, 10000, 'branch side').catch(() => {})
  check('branch chip follows cd', (await evaluate(`${W}.panes[0].branch`)) === 'side', await evaluate(`${W}.panes[0].branch`))
  check('header path shows the new folder', /other/.test(await evaluate(`document.querySelector('[data-pane="${shellKey}"] [data-cwd]')?.textContent ?? ''`)))

  // Relative path printed after cd → Ctrl+click resolves against `other`, not the start folder.
  await type(`cls; 1..60 | % { 'src/y.ts:2' }`)
  await key('Enter', 'Enter', 13)
  await sleep(2500)
  const at = await evaluate(`(() => { const r = document.querySelector('[data-pane="${shellKey}"] .xterm-screen').getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 } })()`)
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, modifiers: CTRL })
  await sleep(500)
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: CTRL })
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: CTRL })
  const opened = await waitFor(`${W}.panes.find((p) => p.kind === 'file')?.path`, 6000, 'file tab').catch(() => '')
  check('Ctrl+click relative path resolves against the cd folder', !!opened && opened.toLowerCase() === path.join(OTHER, 'src', 'y.ts').toLowerCase(), opened)
  const shown = await waitFor(`document.querySelector('[data-kind="file"] [data-line="2"]')?.textContent ?? ''`, 6000, 'file content').catch(() => '')
  check('file tab shows y.ts content', /b = 2/.test(shown), shown)

  // A folder outside every terminal: denied state offers every folder first, this folder as the secondary action; no prompt on its own.
  await evaluate(`${W}.openBrowser(${JSON.stringify(path.join(OUTSIDE, 'page.html'))})`)
  const card = `document.querySelector('[data-kind="browser"]:not([style*="display: none"]) [data-access-denied]')`
  const denied = await waitFor(`${card}?.querySelector('[data-allow-access]')?.textContent.trim()`, 8000, 'denied card').catch(() => '')
  const all = await evaluate(`${card}?.querySelector('[data-allow-all]')?.textContent.trim() ?? ''`)
  check('outside folder → "Allow access to every folder" + "Only <folder>"', all === 'Allow access to every folder' && denied === `Only ${path.basename(OUTSIDE)}`, `${all} | ${denied}`)
  await sleep(400)
  await shot('fix-02-browser-denied-allow')
  // Chromium rate-limits localStorage commits; a hard kill can lose the latest ccm.workspace.last, so hand it over.
  return evaluate(`localStorage.getItem('ccm.workspace.last')`)
}

async function phaseTwo(app, last) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready (2)')
  await evaluate(`localStorage.setItem('ccm.workspace.last', ${JSON.stringify(last)})`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded (2)')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!${W}.last`, 10000, 'restore card').catch(() => {})
  check('previous workspace offered for restore', await evaluate(`!!${W}.last`), await evaluate(`JSON.stringify(${W}.last?.panes.map((p) => [p.kind, p.url ?? p.path ?? '']))`))
  await evaluate(`${W}.restoreLast()`)
  const key = await waitFor(`${W}.panes.find((p) => p.kind === 'browser' && p.url?.endsWith('page.html'))?.key`, 8000, 'restored browser')
  await evaluate(`${W}.activate('${key}')`)
  const title = await waitFor(`(async () => { const w = document.querySelector('[data-pane="${key}"] webview'); return w ? await w.executeJavaScript('document.title').catch(() => '') : '' })()`, 15000, 'outside page').catch(() => '')
  check('restored browser tab opens a folder allowed in an earlier run', title === 'Outside', title)
  await sleep(500)
  await shot('fix-03-restored-allowed')

  // Settings → Forget allowed folders empties the file.
  await evaluate(`${S}.get('ui').settingsOpen = true`)
  await waitFor(`!!document.querySelector('[data-forget-grants]')`, 5000, 'forget row')
  await shot('fix-04-settings-forget')
  await evaluate(`document.querySelector('[data-forget-grants]').click()`)
  await waitFor(`document.querySelector('[data-forget-grants]').disabled`, 5000, 'forgotten').catch(() => {})
  let list = null
  try {
    list = JSON.parse(fs.readFileSync(GRANTS, 'utf8'))
  } catch {}
  check('Forget allowed folders clears preview-grants.json', Array.isArray(list) && list.length === 0, JSON.stringify(list))
}

;(async () => {
  fixture()
  const exe = process.argv[2] ? { exe: process.argv[2] } : {}
  let app = await launch(exe)
  try {
    const last = await phaseOne(app)
    check('no grant written without the user allowing', !fs.existsSync(GRANTS) || JSON.parse(fs.readFileSync(GRANTS, 'utf8')).every((d) => !d.toLowerCase().startsWith(OUTSIDE.toLowerCase())))
    app.stop()
    await app.sleep(1500)
    // Stands in for "Allow" in the native dialog of the previous run (no test hook answers that dialog).
    fs.mkdirSync(path.dirname(GRANTS), { recursive: true })
    fs.writeFileSync(GRANTS, JSON.stringify([OUTSIDE, path.join(OUTSIDE, 'gone')]))
    app = await launch({ ...exe, keep: true })
    await phaseTwo(app, last)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('fix-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-tabs-cwd.txt'), results.join('\n'))
    for (const d of [DIR, OUTSIDE]) try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
