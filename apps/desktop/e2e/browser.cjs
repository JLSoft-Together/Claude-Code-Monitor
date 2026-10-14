// Browser / file / Changes tabs, quick open and terminal links (v21 + v23) against a temp git project.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-site-'))
const html = (v) => `<!doctype html><html><head><title>Fixture</title><link rel="stylesheet" href="/style.css"></head><body data-v="${v}"><h1>Fixture page</h1><button id="b">Go</button></body></html>\n`
const lines = (n, edit = {}) => Array.from({ length: n }, (_, i) => edit[i + 1] ?? `export const line${i + 1} = ${i + 1}`).join('\n') + '\n'

function fixture() {
  fs.mkdirSync(path.join(DIR, 'src'), { recursive: true })
  fs.writeFileSync(path.join(DIR, 'index.html'), html(1))
  fs.writeFileSync(path.join(DIR, 'style.css'), 'body { color: rgb(1, 2, 3); }\n')
  fs.writeFileSync(path.join(DIR, 'src', 'a.ts'), lines(30))
  fs.writeFileSync(path.join(DIR, 'src', 'b.ts'), lines(8))
  fs.writeFileSync(path.join(DIR, 'README.md'), '# Fixture\n\nHello.\n')
  const git = (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', ...args], { cwd: DIR, stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(DIR, 'src', 'a.ts'), lines(30, { 3: 'export const line3 = "changed"' }))
  fs.writeFileSync(path.join(DIR, 'new.txt'), 'untracked\n')
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  const chord = async (k, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  const pane = (kind) => `${W}.panes.find((p) => p.kind === '${kind}')`
  const box = (kind) => `document.querySelector('[data-kind="${kind}"]')`
  const guest = (js) => `(async () => { const w = ${box('browser')}?.querySelector('webview'); return w ? await w.executeJavaScript(${JSON.stringify(js)}) : null })()`
  const openPlus = async () => {
    await evaluate(`[...document.querySelectorAll('button[aria-haspopup=dialog]')].find((b) => /^(New tab|Tab mới)$/.test(b.getAttribute('aria-label') ?? '')).click()`)
    await waitFor(`!!document.querySelector('[role=dialog] [data-launch="browser"]')`, 5000, '+ menu')
  }
  const focusShell = async () => {
    await evaluate(`${W}.activate(${W}.panes.find((p) => !p.kind).key)`)
    await sleep(400)
    await evaluate(`document.querySelector('[data-pane="' + ${W}.activeKey + '"] .xterm-helper-textarea').focus()`)
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
    await sleep(1500)

    // + menu → Browser: empty browser tab next to the terminal tab.
    await openPlus()
    const rows = await evaluate(`[...document.querySelectorAll('[role=dialog] [data-launch]')].map((b) => b.textContent.trim())`)
    check('+ menu offers Browser, Open file…, Changes', rows.length === 3 && /Browser/.test(rows[0]) && /Open file/.test(rows[1]) && /Changes/.test(rows[2]), JSON.stringify(rows))
    await shot('browser-01-plus-menu')
    await evaluate(`document.querySelector('[role=dialog] [data-launch="browser"]').click()`)
    await waitFor(`!!${pane('browser')} && ${W}.tabs.length === 2`, 5000, 'browser tab')
    check('Browser opens as its own tab', true)

    // Address field → the fixture page served over the preview server.
    await evaluate(`${box('browser')}.querySelector('input[aria-label="Address"]').focus()`)
    await type(path.join(DIR, 'index.html'))
    await key('Enter', 'Enter', 13)
    await waitFor(`${guest('document.title')}.then((t) => t === 'Fixture')`, 15000, 'page loaded')
    const url = await evaluate(`${box('browser')}.querySelector('webview').getURL()`)
    check('page served from 127.0.0.1 preview server', /^http:\/\/127\.0\.0\.1:\d+\/[^/]+\/index\.html$/.test(url), url)
    check('root-relative /style.css resolves', (await evaluate(guest('getComputedStyle(document.body).color'))) === 'rgb(1, 2, 3)')
    const label = await evaluate(`document.querySelector('[role=tablist][aria-label=Terminals] [role=tab][aria-selected=true]').textContent.trim()`)
    check('tab label = file name', /index\.html/.test(label), label)
    check('pane keeps the file path, not the preview URL', (await evaluate(`${pane('browser')}.url`)) === path.join(DIR, 'index.html'))
    await sleep(500)
    await shot('browser-02-tab-dark')

    // Live reload on file change.
    fs.writeFileSync(path.join(DIR, 'index.html'), html(2))
    await waitFor(`${guest('document.body.dataset.v')}.then((v) => v === '2')`, 8000, 'live reload')
    check('edit on disk reloads the page', true)

    // Device menu → iPhone frame.
    await evaluate(`${box('browser')}.querySelector('button[aria-label="Device and zoom"]').click()`)
    await waitFor(`!!document.querySelector('[role=menu] [role=menuitemradio]')`, 5000, 'device menu')
    await shot('browser-03-device-menu')
    await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitemradio]')].find((b) => /iPhone/.test(b.textContent)).click()`)
    await sleep(600)
    const frame = await evaluate(`(() => { const f = ${box('browser')}.querySelector('.browser-frame'); return f.style.width + ' ' + f.style.transform })()`)
    check('iPhone frame 390 px wide, scaled to fit', /^390px translate\(-50%, -50%\) scale\(/.test(frame), frame)
    await shot('browser-04-iphone')
    await evaluate(`${box('browser')}.querySelector('button[aria-label="Device and zoom"]').click()`)
    await waitFor(`!!document.querySelector('[role=menu] [role=menuitemradio]')`, 5000, 'device menu again')
    await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitemradio]')].find((b) => /Responsive/.test(b.textContent)).click()`)
    await key('Escape', 'Escape', 27)

    // Ctrl+click a path printed in the terminal → file tab at that line.
    await focusShell()
    await type(`cls; 1..80 | % { '${path.join(DIR, 'src', 'b.ts')}:4' }`)
    await key('Enter', 'Enter', 13)
    await sleep(2500)
    const at = await evaluate(`(() => { const r = document.querySelector('[data-pane="' + ${W}.activeKey + '"] .xterm-screen').getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 } })()`)
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, modifiers: CTRL })
    await sleep(500)
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: CTRL })
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers: CTRL })
    const linked = await waitFor(`${pane('file')}?.path?.endsWith('b.ts')`, 6000, 'file tab from link').catch(() => false)
    check('Ctrl+click path:line opens a file tab', !!linked)
    if (linked) {
      await waitFor(`!!${box('file')}?.querySelector('[data-line="4"].is-target')`, 8000, 'line 4 target')
      check('file tab scrolled to line 4', true)
      check('file tab label = file name', /b\.ts/.test(await evaluate(`document.querySelector('[role=tablist][aria-label=Terminals] [role=tab][aria-selected=true]').textContent`)))
      await sleep(600)
      await shot('browser-05-file-tab')
    }

    // Quick open: Ctrl+Shift+P, "a.ts:3", Enter.
    await focusShell()
    await chord('P', 'KeyP', 80, CTRL | SHIFT)
    await waitFor(`!!document.querySelector('[role=combobox]')`, 5000, 'quick open')
    await waitFor(`document.querySelectorAll('[role=listbox] [role=option]').length > 0`, 10000, 'file list')
    await type('a.ts:3')
    await waitFor(`/a\\.ts/.test(document.querySelector('[role=listbox] [role=option]')?.textContent ?? '')`, 5000, 'a.ts match')
    await sleep(300)
    await shot('browser-06-quick-open')
    const listed = await evaluate(`[...document.querySelectorAll('[role=listbox] [role=option]')].map((o) => o.textContent.trim()).join(' | ')`)
    check('quick open lists project files', /a\.ts/.test(listed) && !/\.git/.test(listed), listed.slice(0, 160))
    await key('Enter', 'Enter', 13)
    await waitFor(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('a.ts') && p.line === 3)`, 5000, 'a.ts tab')
    await waitFor(`[...document.querySelectorAll('[data-kind="file"]')].some((b) => b.offsetParent && b.querySelector('[data-line="3"].is-target'))`, 8000, 'a.ts line 3')
    check('quick open Enter opens a file tab at line 3', true)

    // Changes tab: index.html (live-reload edit) + a.ts modified, new.txt untracked.
    await openPlus()
    await evaluate(`document.querySelector('[role=dialog] [data-launch="changes"]').click()`)
    await waitFor(`${pane('changes')}?.count === 3`, 15000, 'changes count')
    const tabText = await evaluate(`document.querySelector('[role=tablist][aria-label=Terminals] [role=tab][aria-selected=true]').textContent.trim()`)
    check('Changes tab shows "Changes (3)"', /Changes \(3\)/.test(tabText), tabText)
    const opts = await evaluate(`[...${box('changes')}.querySelectorAll('[role=option]')].map((o) => o.textContent.replace(/\\s+/g, ' ').trim())`)
    check('lists modified and untracked files', opts.some((o) => /a\.ts/.test(o)) && opts.some((o) => /new\.txt/.test(o)), JSON.stringify(opts))
    await evaluate(`[...${box('changes')}.querySelectorAll('[role=option]')].find((o) => /a\\.ts/.test(o.textContent)).click()`)
    const hasDiff = await waitFor(`${box('changes')}.querySelector('.diff')?.textContent.includes('changed')`, 8000, 'diff').catch(() => false)
    check('diff renders the changed line', !!hasDiff)
    await sleep(600)
    await shot('browser-07-changes-tab')

    // Split menu on the terminal: Browser opens next to it.
    await focusShell()
    await evaluate(`document.querySelector('[data-pane="' + ${W}.activeKey + '"] button[aria-haspopup=menu]').click()`)
    await waitFor(`!!document.querySelector('[role=menu] [role=menuitem]')`, 5000, 'split menu')
    const items = await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((b) => b.textContent.trim())`)
    check('split menu: Claude / Codex / Shell / Browser', items.length === 4 && /Browser/.test(items[3]), JSON.stringify(items))
    await shot('browser-08-split-menu')
    await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => /Browser/.test(b.textContent)).click()`)
    await waitFor(`${W}.activeTab && ${W}.panes.filter((p) => p.kind === 'browser').length === 2`, 5000, 'split browser')
    const leaves = await evaluate(`JSON.stringify(${W}.activeTab.root)`)
    check('browser split sits in the terminal tab', /"dir":"row"/.test(leaves), leaves)
    await sleep(800)
    await shot('browser-09-split-browser')

    // Light theme, browser tab.
    await evaluate(`${W}.activate(${W}.panes.find((p) => p.kind === 'browser' && p.url).key)`)
    await evaluate(`${S}.get('settings').theme = 'light'`)
    await sleep(800)
    await shot('browser-10-tab-light')
    await evaluate(`${W}.activate(${pane('changes')}.key)`)
    await sleep(600)
    await shot('browser-11-changes-light')
    await evaluate(`${S}.get('settings').theme = 'dark'`)

    // Reload: viewer tabs come back (browser re-resolves the file path to a fresh preview URL).
    await sleep(500)
    await cmd('Page.reload')
    await sleep(2000)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded again')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    const kinds = await evaluate(`${W}.panes.map((p) => p.kind ?? 'term').sort().join()`)
    check('viewer panes survive a reload', /browser,browser,changes,file,file,term/.test(kinds), kinds)
    await evaluate(`${W}.activate(${W}.panes.find((p) => p.kind === 'browser' && p.url).key)`)
    await waitFor(`${guest('document.title')}.then((t) => t === 'Fixture')`, 15000, 'page after reload')
    check('browser tab reloads its file after restore', true)
  } catch (e) {
    check('run', false, e.message)
    await shot('browser-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-browser.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
