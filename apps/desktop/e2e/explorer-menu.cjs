// Explorer context menu (v35): items, submenu by keyboard, copy path, rename (viewer follows), delete to trash, right split, Run…, folder rename moves view panes.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-explorer-menu-')))
const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'README.md'), '# menu\n')
  fs.writeFileSync(path.join(DIR, 'src', 'b.ts'), 'export const b = 1\n')
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  await sleep(800)
  await cmd('Page.bringToFront') // navigator.clipboard needs a focused document
  await evaluate(`if (!document.querySelector('[data-explorer-tree]')) document.querySelector('[data-explorer-toggle]').click()`)
  await waitFor(`!!document.querySelector('[data-explorer-tree] [data-path$="README.md"]')`, 8000, 'explorer rows').catch(() => {})
  const rowSel = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === ${JSON.stringify(name)})`
  const openMenu = (sel) => evaluate(`(() => { const el = ${sel}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
  const menuIds = () => evaluate(`[...document.querySelectorAll('[data-context-menu] [role=menuitem]')].map((b) => b.dataset.menuId)`)
  const closeMenu = () => evaluate(`document.querySelector('[data-context-menu]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  // Root row: Run… only when the Run pane exists; Rename / Delete disabled.
  const hasRun = await evaluate(`typeof window.ccmDesktop.runDetect === 'function'`)
  await openMenu(`document.querySelector('[data-explorer-tree] [data-row-index="0"]')`)
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'root menu').catch(() => {})
  check('root menu offers Run… when the Run pane exists', (await menuIds()).includes('run') === hasRun)
  check('root row cannot be renamed or deleted', await evaluate(`['rename','trash'].every((id) => document.querySelector('[data-context-menu] [data-menu-id="' + id + '"]')?.getAttribute('aria-disabled') === 'true')`))
  await closeMenu()
  await sleep(200)

  await openMenu(rowSel('README.md'))
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'menu').catch(() => {})
  await shot('explorer-menu-01')
  const items = await menuIds()
  check('menu lists the minimal set', JSON.stringify(items) === JSON.stringify(['new', 'copy-ref', 'rename', 'trash', 'open-split', 'open-in', 'compare-select', 'compare-clipboard', 'git', 'reload']), JSON.stringify(items))
  // Keyboard into a submenu: ↓ to Copy Path/Reference, → opens it, Enter copies the absolute path.
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-context-submenu]')`, 2000, 'submenu').catch(() => {})
  check('→ opens the submenu and focuses its first item', await evaluate(`document.activeElement?.dataset.menuId === 'copy-abs'`))
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await sleep(300)
  check('Copy Absolute Path reports the path', (await evaluate(`document.querySelector('[data-explorer] [role=status]')?.textContent ?? ''`)).includes('README.md'))
  // Rename with Shift+F6 while README.md is open in a kept viewer: the viewer follows.
  await evaluate(`${W}.openFile(${JSON.stringify(path.join(DIR, 'README.md'))}, undefined, { cwd: ${JSON.stringify(DIR)} })`)
  await sleep(500)
  await evaluate(`if (!document.querySelector('[data-explorer-tree]')) document.querySelector('[data-explorer-toggle]').click()`)
  await waitFor(`!!(${rowSel('README.md')})`, 4000, 'row back').catch(() => {})
  await evaluate(`${rowSel('README.md')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey: true, bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-create-name]')`, 3000, 'rename dialog').catch(() => {})
  check('rename preselects the name without its extension', await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); return i.value === 'README.md' && i.selectionEnd === 6 })()`))
  await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); i.value = 'NOTES.md'; i.dispatchEvent(new Event('input')); document.querySelector('[data-create-submit]').click() })()`)
  await sleep(600)
  check('rename renames on disk', fs.existsSync(path.join(DIR, 'NOTES.md')) && !fs.existsSync(path.join(DIR, 'README.md')))
  check('the open viewer follows the rename', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('NOTES.md')) && !${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('README.md'))`))
  // Delete moves to the trash after the confirm.
  await waitFor(`!!(${rowSel('NOTES.md')})`, 4000, 'renamed row').catch(() => {})
  await evaluate(`${rowSel('NOTES.md')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(process.platform === 'darwin' ? 'Backspace' : 'Delete')}, metaKey: ${process.platform === 'darwin'}, bubbles: true }))`)
  await waitFor(`!!document.querySelector('.ccm-btn-danger')`, 3000, 'trash confirm').catch(() => {})
  await evaluate(`[...document.querySelectorAll('.ccm-btn-danger')].at(-1).click()`)
  await sleep(1200)
  check('Delete moves the file to the trash', !fs.existsSync(path.join(DIR, 'NOTES.md')))
  // Open in Right Split.
  const before = await evaluate(`${W}.panes.length`)
  await evaluate(`${rowSel('src')}?.click()`)
  await waitFor(`!!(${rowSel('b.ts')})`, 4000, 'src open').catch(() => {})
  await evaluate(`${rowSel('b.ts')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))`)
  await sleep(600)
  check('Shift+Enter opens the file beside the active pane', (await evaluate(`${W}.panes.length`)) === before + 1 && (await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('b.ts'))`)))
  await shot('explorer-menu-02')
  // Renaming a folder moves the views inside it (file path, log cwd), never the shell.
  await evaluate(`${W}.openLog(${JSON.stringify(path.join(DIR, 'src'))})`)
  await sleep(500)
  await evaluate(`if (!document.querySelector('[data-explorer-tree]')) document.querySelector('[data-explorer-toggle]').click()`)
  await waitFor(`!!(${rowSel('src')})`, 4000, 'src row').catch(() => {})
  await evaluate(`${rowSel('src')}.focus()`)
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey: true, bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-create-name]')`, 3000, 'folder rename dialog').catch(() => {})
  await evaluate(`(() => { const i = document.querySelector('[data-create-name]'); i.value = 'lib'; i.dispatchEvent(new Event('input')); document.querySelector('[data-create-submit]').click() })()`)
  await sleep(800)
  const status = await evaluate(`document.querySelector('[data-explorer] [role=status]')?.textContent ?? ''`)
  if (fs.existsSync(path.join(DIR, 'lib'))) {
    check('folder rename moves the file viewer and the log pane', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && /[\\\\/]lib[\\\\/]b\\.ts$/.test(p.path)) && ${W}.panes.some((p) => p.kind === 'log' && /[\\\\/]lib$/.test(p.cwd))`))
  } else check('a held folder reports busy instead of failing silently', status.length > 0, status)
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('explorer-menu-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-explorer-menu.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
