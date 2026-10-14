// v26 Explorer: sidebar Projects | Explorer, lazy tree, preview vs kept viewer, create file/folder, live refresh, Changes view.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const X = `${S}.get('explorer')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-explorer-')))

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src', 'lib'), { recursive: true })
  fs.mkdirSync(path.join(DIR, 'node_modules', 'x'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'README.md'), '# explorer\n')
  fs.writeFileSync(path.join(DIR, '.env'), 'A=1\n')
  fs.writeFileSync(path.join(DIR, 'src', 'main.ts'), 'export const main = 1\n')
  fs.writeFileSync(path.join(DIR, 'src', 'lib', 'util.ts'), 'export const util = 2\n')
  const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(DIR, '.gitignore'), 'node_modules/\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
}

const names = `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].map((r) => r.textContent.trim())`
const row = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.textContent.trim() === ${JSON.stringify(name)})`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.workspace.sideView')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(1000)

  // Ctrl+Shift+E switches the sidebar to the Explorer.
  await key('E', 'KeyE', 69, 2 | 8)
  await waitFor(`!!document.querySelector('[data-explorer-tree]')`, 8000, 'explorer shown').catch(() => {})
  check('Ctrl+Shift+E shows the Explorer', await evaluate(`!!document.querySelector('[data-explorer-tree]')`))
  await waitFor(`${names}.length >= 3`, 10000, 'root listing').catch(() => {})
  check('shortcut focuses the tree', await evaluate(`!!document.activeElement?.closest('[data-explorer-tree]')`))
  const top = await evaluate(names)
  check('root listing: folders first, node_modules and dot-files hidden', JSON.stringify(top.slice(1)) === JSON.stringify(['src', 'README.md']), JSON.stringify(top))
  check('root row is the project folder', (top[0] ?? '').toLowerCase() === path.basename(DIR).toLowerCase(), top[0])

  // Expand src, single click = preview viewer replaced in place; double click keeps it.
  await evaluate(`${row('src')}.click()`)
  await waitFor(`${names}.includes('main.ts')`, 8000, 'src expanded')
  check('click a folder expands it lazily', await evaluate(`${names}.includes('lib') && ${names}.includes('main.ts')`))
  await evaluate(`${row('main.ts')}.click()`)
  await waitFor(`${W}.panes.some((p) => p.kind === 'file' && p.preview)`, 8000, 'preview viewer')
  await evaluate(`${row('README.md')}.click()`)
  await sleep(400)
  const files = await evaluate(`${W}.panes.filter((p) => p.kind === 'file').map((p) => [p.path, !!p.preview])`)
  check('second single click replaces the preview viewer', files.length === 1 && /README\.md$/.test(files[0][0]) && files[0][1], JSON.stringify(files))
  check('active file row is marked', await evaluate(`${row('README.md')}.getAttribute('aria-selected') === 'true'`))
  await evaluate(`${row('README.md')}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(300)
  check('double click keeps the viewer', await evaluate(`${W}.panes.filter((p) => p.kind === 'file').every((p) => !p.preview)`))
  await shot('explorer-01-tree')

  // Keyboard: focus the tree, ArrowDown moves, ArrowRight expands lib.
  await evaluate(`${row('src')}.focus()`)
  await key('ArrowDown', 'ArrowDown', 40)
  check('ArrowDown moves focus to the next row', await evaluate(`document.activeElement?.textContent.trim() === 'lib'`), await evaluate(`document.activeElement?.textContent.trim()`))
  await key('ArrowRight', 'ArrowRight', 39)
  await waitFor(`${names}.includes('util.ts')`, 6000, 'lib expanded').catch(() => {})
  check('ArrowRight expands a folder', await evaluate(`${names}.includes('util.ts')`))

  // New file in the focused folder (lib): dialog validates, creates, focuses, opens a preview.
  await evaluate(`document.querySelector('[data-explorer-new-file]').click()`)
  await waitFor(`!!document.querySelector('[data-create-name]')`, 5000, 'create dialog')
  check('create dialog names the target folder', /src\/lib/.test(await evaluate(`document.querySelector('[data-create-entry]').textContent`)))
  await type('con')
  await sleep(200)
  check('reserved name disables Create', await evaluate(`document.querySelector('[data-create-submit]').disabled`))
  await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); i.select() })()`)
  await type('added.ts')
  await sleep(200)
  await shot('explorer-02-create')
  await evaluate(`document.querySelector('[data-create-submit]').click()`)
  await waitFor(`${names}.includes('added.ts')`, 8000, 'created row').catch(() => {})
  check('new file exists on disk', fs.existsSync(path.join(DIR, 'src', 'lib', 'added.ts')))
  check('new row appears and takes focus', await evaluate(`document.activeElement?.textContent.trim() === 'added.ts'`), await evaluate(`document.activeElement?.textContent.trim()`))
  check('new file opens in the preview viewer', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.preview && p.path.endsWith('added.ts'))`))

  // A file created from outside the app shows up via the watcher.
  fs.writeFileSync(path.join(DIR, 'src', 'outside.ts'), 'export {}\n')
  await waitFor(`${names}.includes('outside.ts')`, 6000, 'watcher refresh').catch(() => {})
  check('tree follows files created outside the app', await evaluate(`${names}.includes('outside.ts')`))

  // Show hidden reveals .env; collapse all closes everything.
  await evaluate(`document.querySelector('[data-explorer-tree] [aria-pressed]').click()`)
  await waitFor(`${names}.includes('.env')`, 4000, '.env').catch(() => {})
  check('show hidden files reveals dot-files, never node_modules', await evaluate(`${names}.includes('.env') && !${names}.includes('node_modules')`))

  // Changes view lists the new files with git status.
  fs.writeFileSync(path.join(DIR, 'README.md'), '# explorer\nchanged\n')
  await evaluate(`document.querySelector('[data-explorer] [data-view=changes]').click()`)
  await waitFor(`!!document.querySelector('[data-change="README.md"]')`, 8000, 'changes list').catch(() => {})
  const changed = await evaluate(`[...document.querySelectorAll('[data-change]')].map((e) => e.dataset.change)`)
  check('Changes view lists modified + untracked files', changed.includes('README.md') && changed.includes('src/outside.ts'), JSON.stringify(changed))
  await shot('explorer-03-changes')
  await evaluate(`document.querySelector('[data-change="src/outside.ts"]').click()`)
  await sleep(400)
  check('clicking a change opens it', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('outside.ts'))`))
  await evaluate(`document.querySelector('[data-explorer-open-diff]').click()`)
  await waitFor(`${W}.panes.some((p) => p.kind === 'changes')`, 5000, 'changes tab').catch(() => {})
  check('Open in Changes tab opens the diff pane', await evaluate(`${W}.panes.some((p) => p.kind === 'changes')`))

  // Back to Projects keeps the preference.
  await evaluate(`document.querySelector('[data-side-view=projects]').click()`)
  await sleep(300)
  check('Projects view comes back', await evaluate(`!document.querySelector('[data-explorer]') && localStorage.getItem('ccm.workspace.sideView') === 'projects'`))

  // Image viewer: the <img> comes from the preview server (another loopback port) and must actually decode.
  for (const name of ['ccm-256.png', 'logo.svg']) {
    fs.copyFileSync(path.join(__dirname, '../../../scripts/assets', name), path.join(DIR, name))
    await evaluate(`${W}.openFile(${JSON.stringify(path.join(DIR, name))})`)
    const w = await waitFor(`(() => { const i = [...document.querySelectorAll('[data-kind=file] img')].find((x) => x.offsetParent && x.src.endsWith(${JSON.stringify(name)})); return i?.complete && i.naturalWidth })()`, 8000, name).catch(() => 0)
    check(`image viewer renders ${name}`, w > 0, `naturalWidth ${w}`)
  }
  await shot('explorer-04-image')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('explorer-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-explorer.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
