// v70 tools batch: bookmarks, recent, JSON / YAML tree, TODO view, notes, Local History, plan board, image compare,
// log viewer, .http client, drop-down terminal, Markdown split, colour swatches, compare two files, dev tools, .env
// check, i18n scan, replace preview, terminal scan, prompt queue. Replace all and non-LAN hosts sit behind a native
// confirm (would block CDP): covered by unit tests, only the preview is driven here. No prompt is ever sent.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const UI = `${S}.get('ui')`
const NAV = `${S}.get('navigation')`
const MAC = process.platform === 'darwin'
const MOD = MAC ? 4 : 2
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v70-')))
const NOTES_DIR = path.join(OUT, 'run', 'data', 'notes')
const gitIn = (cwd) => (...args) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' })

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgb.forEach((v, i) => (raw[y * (size * 3 + 1) + 1 + x * 3 + i] = v))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const JWT = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'e2e', name: 'OrreryE2E', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2ln`

function fixture(port) {
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); fs.writeFileSync(path.join(DIR, rel), text) }
  w('data.json', JSON.stringify({ app: { name: 'orrery', tags: ['a', 'b'] }, count: 3 }, null, 2) + '\n')
  w('config.yaml', 'server:\n  host: localhost\n  port: 8080\n')
  w('.planning/PLAN-e2e.md', '# Plan\n\n- [ ] first task\n- [x] done task\n')
  w('app.log', ['2026-10-29 10:00:00 INFO server started', '2026-10-29 10:00:01 DEBUG cache warm', '2026-10-29 10:00:02 WARN slow query', '2026-10-29 10:00:03 ERROR boom happened', '2026-10-29 10:00:04 INFO request ok'].join('\n') + '\n')
  w('api.http', `### ping\nGET http://127.0.0.1:${port}/ping\nAccept: application/json\n`)
  w('.env.example', 'API_URL=\nSECRET_TOKEN=\nDB_HOST=\n')
  w('.env', 'API_URL=http://localhost\nSECRET_TOKEN=s3cret-value-e2e\nEXTRA_FLAG=1\n')
  w('app/src/main/res/values/strings.xml', '<resources>\n    <string name="hello">Hello there</string>\n    <string name="bye_text">Goodbye friend</string>\n</resources>\n')
  w('app/src/main/res/values-vi/strings.xml', '<resources>\n    <string name="hello">Xin chào</string>\n</resources>\n')
  fs.writeFileSync(path.join(DIR, 'logo.png'), png(8, [255, 0, 0]))
  w('todo.ts', 'export const a = 1\n// TODO: wire up the e2e thing\nexport const b = 2 // FIXME broken bit\n')
  w('color.ts', "export const brand = '#ff8800'\nexport const ink = 'rgb(10, 20, 30)'\n")
  w('notes.txt', 'first\n')
  w('README.md', '# Readme title\n\nSome text.\n\n## Second\n\nMore.\n')
  w('left.txt', 'one\ntwo\nthree\n')
  w('right.txt', 'one\nTWO\nthree\n')
  w('replace.txt', 'foo alpha\nbeta foo\n')
  const g = gitIn(DIR)
  g('init', '-q', '-b', 'main')
  g('add', '-A')
  g('commit', '-q', '-m', 'init')
  fs.writeFileSync(path.join(DIR, 'logo.png'), png(8, [0, 0, 255]))
}

function clipboardText() {
  const text = MAC ? execFileSync('pbpaste', { encoding: 'utf8' }) : execFileSync('powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' })
  return text.replace(/\r?\n$/, '')
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ pong: true, path: req.url }))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  fixture(server.address().port)
  const app = await launch({ exe: process.argv[2] })
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  const filePane = (name) => `document.querySelector('[data-pane="' + ${W}.panes.findLast((p) => p.kind === 'file' && p.path.endsWith(${JSON.stringify(name)}))?.key + '"]')`
  const openFile = async (name, line) => {
    await evaluate(`${W}.openFile(${JSON.stringify(path.join(DIR, name))}${line ? `, ${line}` : ''})`)
    await waitFor(`!!${filePane(name)}`, 15000, `${name} pane`)
  }
  const startEdit = async (name) => {
    await evaluate(`${filePane(name)}.querySelector('[data-file-edit]')?.click()`)
    await waitFor(`!!${filePane(name)}.querySelector('.cm-editor .cm-content')`, 15000, `${name} editor`)
  }
  const pickMore = async (name, id) => {
    await evaluate(`${filePane(name)}.querySelector('[data-pane-more]').click()`)
    await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id="${id}"]')`, 5000, `menu ${id}`)
    await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="${id}"]').click()`)
  }
  const esc = () => key('Escape', 'Escape', 27)
  const setInput = (sel, value) => evaluate(`(() => { const el = ${sel}; if (!el) return false; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v70-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
      await esc().catch(() => {})
    }
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.workspace.explorerOpen','1')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await evaluate(`${UI}.view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes.some((p) => p.state === 'running')`, 20000, 'shell running')
    await cmd('Page.bringToFront')

    await step('bookmarks', async () => {
      await openFile('todo.ts', 2)
      await waitFor(`!!${filePane('todo.ts')}.querySelector('[data-line="2"]')`, 10000, 'todo rows')
      await evaluate(`(() => { const p = ${filePane('todo.ts')}; p.querySelector('[data-line="1"]').closest('section').focus(); getSelection().collapse(p.querySelector('[data-line="2"] .c'), 0) })()`)
      await key('F11', 'F11', 122)
      await waitFor(`!!${filePane('todo.ts')}.querySelector('[data-line="2"].bm')`, 5000, 'bookmark mark').catch(() => {})
      check('F11 bookmarks the line and marks the gutter', await evaluate(`!!${filePane('todo.ts')}.querySelector('[data-line="2"].bm') && ${NAV}.bookmarks.length === 1`))
      await key('F11', 'F11', 122, 8)
      await waitFor(`!!document.querySelector('[data-nav-picker]')`, 5000, 'nav picker').catch(() => {})
      const rows = await evaluate(`[...document.querySelectorAll('[data-nav-picker] [data-nav-row]')].map((r) => r.textContent.trim()).join(' | ')`)
      check('Shift+F11 lists the bookmark', /todo\.ts:2/.test(rows ?? '') && (await evaluate(`document.querySelector('[data-nav-tab="bookmarks"]')?.getAttribute('aria-selected') === 'true'`)), rows)
      await shot('v70-01-bookmarks')
      await esc()
      await sleep(200)
    })

    await step('json tree', async () => {
      await openFile('data.json')
      await waitFor(`!!${filePane('data.json')}.querySelector('[data-file-tree-toggle]')`, 10000, 'tree toggle')
      await evaluate(`${filePane('data.json')}.querySelector('[data-file-tree-toggle]').click()`)
      await waitFor(`!!${filePane('data.json')}.querySelector('[data-json-tree] [data-tree-path="app"]')`, 10000, 'tree rows')
      if (!(await evaluate(`!!${filePane('data.json')}.querySelector('[data-tree-path="app.name"]')`))) await evaluate(`${filePane('data.json')}.querySelector('[data-tree-path="app"]').click()`)
      await waitFor(`!!${filePane('data.json')}.querySelector('[data-tree-path="app.name"]')`, 5000, 'app.name').catch(() => {})
      check('JSON tree shows nested keys', await evaluate(`!!${filePane('data.json')}.querySelector('[data-tree-path="app.name"]') && !!${filePane('data.json')}.querySelector('[data-tree-path="count"]')`))
      await evaluate(`navigator.clipboard.writeText('sentinel').catch(() => {})`)
      await evaluate(`${filePane('data.json')}.querySelector('[data-tree-path="app.name"] [data-tree-copy]').click()`)
      await sleep(400)
      const clip = clipboardText()
      check('Copy path puts app.name on the clipboard', clip === 'app.name', clip)
      await shot('v70-02-json-tree')
      await openFile('config.yaml')
      await evaluate(`${filePane('config.yaml')}.querySelector('[data-file-tree-toggle]')?.click()`)
      await waitFor(`!!${filePane('config.yaml')}.querySelector('[data-tree-path="server"]')`, 10000, 'yaml tree').catch(() => {})
      check('YAML opens as a tree too', await evaluate(`!!${filePane('config.yaml')}.querySelector('[data-tree-path="server"]')`))
    })

    await step('recent', async () => {
      await evaluate(`document.activeElement?.blur()`)
      await key('E', 'KeyE', 69, 1 | 8)
      await waitFor(`!!document.querySelector('[data-nav-picker]')`, 5000, 'recent picker').catch(() => {})
      const rows = await evaluate(`[...document.querySelectorAll('[data-nav-picker] [data-nav-row]')].map((r) => r.textContent.trim()).join(' | ')`)
      check('Alt+Shift+E lists recent files', /data\.json/.test(rows ?? '') && /todo\.ts/.test(rows ?? '') && (await evaluate(`document.querySelector('[data-nav-tab="recent"]')?.getAttribute('aria-selected') === 'true'`)), rows)
      await esc()
      await sleep(200)
    })

    await step('log viewer', async () => {
      await openFile('app.log')
      await waitFor(`${filePane('app.log')}.querySelectorAll('[data-log-line]').length >= 5`, 10000, 'log lines')
      check('.log opens in the log viewer', await evaluate(`!!${filePane('app.log')}.querySelector('[data-log-view]')`))
      await evaluate(`(() => { const s = ${filePane('app.log')}.querySelector('[data-log-level]'); s.value = '4'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
      await waitFor(`${filePane('app.log')}.querySelectorAll('[data-log-line]').length === 1`, 5000, 'filtered').catch(() => {})
      const lines = await evaluate(`[...${filePane('app.log')}.querySelectorAll('[data-log-line]')].map((r) => r.textContent).join(' | ')`)
      check('level filter E keeps only the error line', /boom happened/.test(lines) && !/INFO/.test(lines), lines)
      await setInput(`${filePane('app.log')}.querySelector('[data-log-level]')`, '-1')
      await setInput(`${filePane('app.log')}.querySelector('[data-log-filter]')`, 'slow')
      await waitFor(`${filePane('app.log')}.querySelectorAll('[data-log-line]').length === 1`, 5000, 'text filter').catch(() => {})
      check('text filter narrows the lines', /slow query/.test(await evaluate(`${filePane('app.log')}.querySelector('[data-log-line]')?.textContent ?? ''`)))
      await shot('v70-03-log')
    })

    await step('http', async () => {
      await openFile('api.http')
      await waitFor(`!!${filePane('api.http')}.querySelector('[data-http-panel] [data-http-send]')`, 10000, 'http panel')
      await evaluate(`${filePane('api.http')}.querySelector('[data-http-send]').click()`)
      const status = await waitFor(`${filePane('api.http')}.querySelector('[data-http-status]')?.textContent.trim() || ${filePane('api.http')}.querySelector('[data-http-error]')?.textContent.trim()`, 15000, 'http result').catch(() => '')
      check('.http Send to a loopback server shows 200', /^200\b/.test(status ?? ''), status)
      check('response body is shown', /pong/.test(await evaluate(`${filePane('api.http')}.querySelector('[data-http-result]')?.textContent ?? ''`)))
      await shot('v70-04-http')
    })

    await step('markdown split', async () => {
      await openFile('README.md')
      await startEdit('README.md')
      if (!(await evaluate(`!!${filePane('README.md')}.querySelector('[data-md-split]')`))) await evaluate(`${filePane('README.md')}.querySelector('[data-md-split-toggle]').click()`)
      await waitFor(`/Readme title/.test(${filePane('README.md')}.querySelector('[data-md-split] h1')?.textContent ?? '')`, 8000, 'split preview').catch(() => {})
      check('Markdown edit shows the split preview', await evaluate(`/Readme title/.test(${filePane('README.md')}.querySelector('[data-md-split] h1')?.textContent ?? '') && !!${filePane('README.md')}.querySelector('.cm-editor')`))
      check('preview blocks carry source lines', await evaluate(`${filePane('README.md')}.querySelectorAll('[data-md-split] [data-src-line]').length >= 2`))
      await shot('v70-05-md-split')
    })

    await step('colour swatch', async () => {
      await openFile('color.ts')
      await startEdit('color.ts')
      await waitFor(`${filePane('color.ts')}.querySelectorAll('.cm-color-swatch').length >= 2`, 8000, 'swatches').catch(() => {})
      const n = await evaluate(`${filePane('color.ts')}.querySelectorAll('.cm-color-swatch').length`)
      check('editor shows colour swatches for #hex and rgb()', n === 2, String(n))
      await shot('v70-06-swatch')
    })

    await step('local history', async () => {
      await openFile('notes.txt')
      await startEdit('notes.txt')
      const focusEnd = async () => {
        await evaluate(`${filePane('notes.txt')}.querySelector('.cm-content').focus()`)
        await sleep(100)
        await key('End', 'End', 35, MOD)
      }
      await focusEnd()
      await type('second\n')
      await key('s', 'KeyS', 83, MOD)
      await waitFor(`!${filePane('notes.txt')}.querySelector('[data-file-dirty]')`, 5000, 'saved 1')
      await focusEnd()
      await type('third\n')
      await key('s', 'KeyS', 83, MOD)
      await waitFor(`!${filePane('notes.txt')}.querySelector('[data-file-dirty]')`, 5000, 'saved 2')
      check('two saves wrote the file', fs.readFileSync(path.join(DIR, 'notes.txt'), 'utf8') === 'first\nsecond\nthird\n', JSON.stringify(fs.readFileSync(path.join(DIR, 'notes.txt'), 'utf8')))
      await pickMore('notes.txt', 'history')
      await waitFor(`document.querySelectorAll('[data-lh-list] [data-lh-id]').length >= 1`, 8000, 'history list').catch(() => {})
      const n = await evaluate(`document.querySelectorAll('[data-lh-list] [data-lh-id]').length`)
      check('Local History lists the versions before each save', n >= 2, String(n))
      check('history shows a side-by-side diff', await evaluate(`!!document.querySelector('[data-text-compare] .cm-mergeView, [data-text-compare]')`))
      await shot('v70-07-local-history')
      await esc()
      await sleep(300)
    })

    await step('notes', async () => {
      const shellKey = await evaluate(`${W}.panes.find((p) => (p.kind ?? 'term') === 'term').key`)
      await evaluate(`${W}.activate('${shellKey}')`)
      await sleep(300)
      await evaluate(`document.activeElement?.blur()`)
      await key('n', 'KeyN', 78, 1 | 2)
      await waitFor(`!!document.querySelector('[data-notes]')`, 5000, 'notes').catch(() => {})
      check('Ctrl+Alt+N opens the project notes', await evaluate(`!!document.querySelector('[data-notes]')`))
      await waitFor(`!!document.querySelector('[data-notes] .cm-content')`, 8000, 'notes editor')
      await evaluate(`document.querySelector('[data-notes] .cm-content').focus()`)
      await type('E2E note line @todo.ts:2')
      const start = Date.now()
      let saved = ''
      while (Date.now() - start < 6000 && !saved) {
        await sleep(300)
        try { saved = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(NOTES_DIR, f), 'utf8')).find((t) => t.includes('E2E note line')) ?? '' } catch {}
      }
      check('note auto-saves into the data dir, not the repo', !!saved && !fs.readdirSync(DIR).some((f) => /note/i.test(f) && f !== 'notes.txt'))
      await shot('v70-08-notes')
      await esc()
      await sleep(300)
      check('Esc closes the notes', await evaluate(`!document.querySelector('[data-notes]')`))
    })

    await step('plan board', async () => {
      await evaluate(`${UI}.planBoard = { dir: ${JSON.stringify(DIR)} }`)
      await waitFor(`!!document.querySelector('[data-plan-board] [data-plan-item]')`, 10000, 'plan items')
      check('plan board lists the .planning checklist', await evaluate(`!!document.querySelector('[data-plan-file="PLAN-e2e.md"]')`))
      await evaluate(`[...document.querySelectorAll('[data-plan-item]')].find((li) => li.dataset.planState !== 'done').querySelector('[data-plan-toggle]').click()`)
      const file = path.join(DIR, '.planning', 'PLAN-e2e.md')
      const start = Date.now()
      while (Date.now() - start < 5000 && !fs.readFileSync(file, 'utf8').includes('- [x] first task')) await sleep(200)
      check('ticking an item writes [x] into the file', fs.readFileSync(file, 'utf8') === '# Plan\n\n- [x] first task\n- [x] done task\n', JSON.stringify(fs.readFileSync(file, 'utf8')))
      await shot('v70-09-plan')
      await evaluate(`${UI}.planBoard = null`)
    })

    await step('env check', async () => {
      await evaluate(`${UI}.envCheck = { dir: ${JSON.stringify(DIR)} }`)
      await waitFor(`!!document.querySelector('[data-env-check] [data-env-row]')`, 10000, 'env rows')
      const st = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-env-row]')].map((r) => [r.dataset.envRow, r.dataset.envStatus]))`)
      check('.env check reports DB_HOST missing and EXTRA_FLAG extra', st.DB_HOST === 'missing' && st.EXTRA_FLAG === 'extra', JSON.stringify(st))
      check('values stay hidden until revealed', !(await evaluate(`document.querySelector('[data-env-check]').textContent.includes('s3cret-value-e2e')`)))
      await shot('v70-10-env')
      await evaluate(`${UI}.envCheck = null`)
    })

    await step('i18n scan', async () => {
      await evaluate(`${UI}.i18nScan = { dir: ${JSON.stringify(DIR)} }`)
      await waitFor(`!!document.querySelector('[data-i18n-scan] [data-i18n-key]')`, 15000, 'i18n keys')
      const keys = await evaluate(`[...document.querySelectorAll('[data-i18n-scan] [data-i18n-key]')].map((k) => k.textContent.trim()).join(' | ')`)
      check('i18n scan shows bye_text missing in values-vi', /bye_text/.test(keys) && (await evaluate(`!!document.querySelector('[data-i18n-locale*="vi"]') || /vi/.test(document.querySelector('[data-i18n-scan]').textContent)`)), keys)
      await shot('v70-11-i18n')
      await evaluate(`${UI}.i18nScan = null`)
    })

    await step('dev tools', async () => {
      await evaluate(`${UI}.devTools = 'jwt'`)
      await waitFor(`!!document.querySelector('[data-devtools] [data-devtools-input]')`, 8000, 'dev tools')
      await setInput(`document.querySelector('[data-devtools] [data-devtools-input]')`, JWT)
      await waitFor(`/OrreryE2E/.test(document.querySelector('[data-devtools]').textContent)`, 5000, 'jwt decoded').catch(() => {})
      check('Dev tools decode a JWT payload', await evaluate(`/OrreryE2E/.test(document.querySelector('[data-devtools]').textContent) && !!document.querySelector('[data-devtools-jwt-status]')`))
      await shot('v70-12-devtools')
      await evaluate(`${UI}.devTools = null`)
    })

    await step('explorer', async () => {
      if (!(await evaluate(`!!document.querySelector('[data-explorer]')`))) await evaluate(`document.querySelector('[data-explorer-toggle]')?.click()`)
      await waitFor(`!!document.querySelector('[data-explorer] [data-view=todo]')`, 8000, 'explorer views')
      await evaluate(`document.querySelector('[data-explorer] [data-view=todo]').click()`)
      await waitFor(`document.querySelectorAll('[data-explorer-todo] [data-todo-row]').length >= 2`, 15000, 'todo rows').catch(() => {})
      const todo = await evaluate(`[...document.querySelectorAll('[data-explorer-todo] [data-todo-row]')].map((r) => r.textContent.trim()).join(' | ')`)
      check('TODO view lists TODO and FIXME', /wire up/.test(todo) && /broken bit/.test(todo), todo)
      await shot('v70-13-todo')

      await evaluate(`document.querySelector('[data-explorer] [data-view=files]').click()`)
      const rowSel = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === ${JSON.stringify(name)})`
      const openMenu = (sel) => evaluate(`(() => { const el = ${sel}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
      await waitFor(`!!${rowSel('left.txt')} && !!${rowSel('right.txt')}`, 10000, 'tree rows')
      await openMenu(rowSel('left.txt'))
      await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id="compare-select"]')`, 3000, 'compare-select')
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="compare-select"]').click()`)
      await sleep(300)
      await openMenu(rowSel('right.txt'))
      await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id="compare-with"]')`, 3000, 'compare-with')
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="compare-with"]').click()`)
      await waitFor(`!!document.querySelector('[data-text-compare] .cm-mergeView')`, 8000, 'compare dialog').catch(() => {})
      check('Compare with … opens a merge view of the two files', await evaluate(`!!document.querySelector('[data-text-compare] .cm-mergeView') && /TWO/.test(document.querySelector('[data-text-compare]').textContent)`))
      await shot('v70-14-compare')
      await esc()
      await sleep(300)
      if (await evaluate(`!!document.querySelector('[data-text-compare]')`)) await esc()

      await evaluate(`document.querySelector('[data-explorer] [data-view=search]').click()`)
      await waitFor(`!!document.querySelector('[data-search-replace-toggle]')`, 5000, 'search view')
      const searchInput = `document.querySelector('[data-search-replace-toggle]').parentElement.querySelector('input[type=search]')`
      await setInput(searchInput, 'foo')
      await evaluate(`document.querySelector('[data-search-replace-toggle]').click()`)
      await waitFor(`!!document.querySelector('[data-search-replace]')`, 3000, 'replace field')
      await setInput(`document.querySelector('[data-search-replace]')`, 'bar')
      await waitFor(`document.querySelectorAll('[data-search-tick]').length >= 2`, 10000, 'replace rows').catch(() => {})
      const prev = await evaluate(`(() => { const ins = [...document.querySelectorAll('[data-explorer] ins')].map((e) => e.textContent); const del = [...document.querySelectorAll('[data-explorer] del')].map((e) => e.textContent); return { ins, del, ticks: document.querySelectorAll('[data-search-tick]').length } })()`)
      check('replace preview shows foo → bar per line with ticks', prev.ticks >= 2 && prev.del.includes('foo') && prev.ins.includes('bar'), JSON.stringify(prev))
      check('preview does not touch the file', fs.readFileSync(path.join(DIR, 'replace.txt'), 'utf8') === 'foo alpha\nbeta foo\n')
      await evaluate(`document.querySelector('[data-search-tick]').click()`)
      await sleep(200)
      check('unticking a line drops it from Replace all', /\b1\b/.test(await evaluate(`document.querySelector('[data-search-replace-all]').getAttribute('aria-label')`)), await evaluate(`document.querySelector('[data-search-replace-all]').getAttribute('aria-label')`))
      await shot('v70-15-replace')
      await setInput(searchInput, '')
    })

    await step('image compare', async () => {
      await evaluate(`${W}.openChanges(${JSON.stringify(DIR)})`)
      const changeRow = `[...document.querySelectorAll('[data-row], [role=option]')].find((r) => /logo\\.png$/.test(r.title))`
      await waitFor(`!!${changeRow}`, 15000, 'changes row')
      await evaluate(`${changeRow}.click()`)
      await waitFor(`!!document.querySelector('[data-image-compare]')`, 10000, 'image compare').catch(() => {})
      check('changed PNG opens the image compare', await evaluate(`!!document.querySelector('[data-image-compare]')`))
      await waitFor(`[...document.querySelectorAll('[data-image-compare] img')].filter((i) => i.complete && i.naturalWidth === 8).length >= 2`, 10000, 'both images').catch(() => {})
      check('HEAD and working images both decode', (await evaluate(`[...document.querySelectorAll('[data-image-compare] img')].filter((i) => i.complete && i.naturalWidth === 8).length`)) >= 2)
      const modes = await evaluate(`[...document.querySelectorAll('[data-image-mode-btn]')].map((b) => b.dataset.imageModeBtn)`)
      if (modes.length > 1) {
        await evaluate(`document.querySelectorAll('[data-image-mode-btn]')[1].click()`)
        await sleep(200)
        check('mode switch changes the compare mode', (await evaluate(`document.querySelector('[data-image-compare]').dataset.imageMode`)) === modes[1], JSON.stringify(modes))
      } else check('image compare offers modes', false, JSON.stringify(modes))
      await shot('v70-16-image')
    })

    await step('drop terminal', async () => {
      const shellKey = await evaluate(`${W}.panes.find((p) => (p.kind ?? 'term') === 'term').key`)
      await evaluate(`${W}.activate('${shellKey}')`)
      await evaluate(`document.activeElement?.blur()`)
      await key('`', 'Backquote', 192, 2)
      await waitFor(`(() => { const d = document.querySelector('[data-drop-term]'); return !!d && getComputedStyle(d).display !== 'none' })()`, 8000, 'drop term').catch(() => {})
      check('Ctrl+` drops the shell terminal down', await evaluate(`(() => { const d = document.querySelector('[data-drop-term]'); return !!d && getComputedStyle(d).display !== 'none' })()`))
      await waitFor(`!!document.querySelector('[data-drop-term] .xterm')`, 10000, 'drop xterm').catch(() => {})
      check('drop terminal hosts its own xterm, not a pane', await evaluate(`!!document.querySelector('[data-drop-term] .xterm') && ${W}.panes.filter((p) => (p.kind ?? 'term') === 'term').length === 1`))
      await shot('v70-17-drop')
      await evaluate(`document.querySelector('[data-drop-term] .xterm-helper-textarea')?.focus()`)
      await key('`', 'Backquote', 192, 2)
      await waitFor(`getComputedStyle(document.querySelector('[data-drop-term]')).display === 'none'`, 5000, 'hidden').catch(() => {})
      check('Ctrl+` again hides it', await evaluate(`getComputedStyle(document.querySelector('[data-drop-term]')).display === 'none'`))
    })

    await step('terminal scan', async () => {
      const shellKey = await evaluate(`${W}.panes.find((p) => (p.kind ?? 'term') === 'term').key`)
      await evaluate(`${W}.activate('${shellKey}')`)
      check('shell pane has the scan button', await evaluate(`!!document.querySelector('[data-pane="${shellKey}"] [data-term-scan]')`))
      await evaluate(`document.querySelector('[data-pane="${shellKey}"] .xterm-helper-textarea').focus()`)
      // Built at run time so the echoed command line itself does not look like a tsc error.
      await type(`node -e "console.log('todo.ts(2,4)' + ': error TS2322: e2e scan')"`)
      await key('Enter', 'Enter', 13)
      await sleep(1500)
      await evaluate(`document.querySelector('[data-pane="${shellKey}"] [data-term-scan]').click()`)
      const notice = await waitFor(`document.querySelector('[data-pane="${shellKey}"] [data-term-scan-notice]')?.textContent.trim()`, 5000, 'scan notice').catch(() => '')
      check('scan reports the tsc error from the scrollback', /\b1\b/.test(notice ?? '') && !/no |không/i.test(notice ?? ''), notice)
      await shot('v70-18-scan')
    })

    await step('prompt queue', async () => {
      await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
      await waitFor(`${W}.panes.filter((p) => (p.kind ?? 'term') === 'term' && p.state === 'running').length >= 2`, 20000, 'second shell')
      const agentKey = await evaluate(`(() => { const p = ${W}.panes.filter((p) => (p.kind ?? 'term') === 'term').at(-1); p.agent = 'claude'; return p.key })()`)
      await waitFor(`!!document.querySelector('[data-pane="${agentKey}"] [data-prompt-queue]')`, 5000, 'queue button').catch(() => {})
      check('agent pane header has the prompt queue button', await evaluate(`!!document.querySelector('[data-pane="${agentKey}"] [data-prompt-queue]')`))
      await evaluate(`document.querySelector('[data-pane="${agentKey}"] [data-prompt-queue]').click()`)
      await waitFor(`!!document.querySelector('[data-prompt-queue-pop] [data-prompt-queue-draft]')`, 5000, 'queue popover')
      await setInput(`document.querySelector('[data-prompt-queue-draft]')`, 'E2E queued task (never sent)')
      await evaluate(`document.querySelector('[data-prompt-queue-add]').click()`)
      await sleep(200)
      check('adding queues one item with a badge', (await evaluate(`document.querySelectorAll('[data-prompt-queue-item]').length`)) === 1 && /1/.test(await evaluate(`document.querySelector('[data-pane="${agentKey}"] [data-prompt-queue-count]')?.textContent ?? ''`)))
      await shot('v70-19-queue')
      await evaluate(`document.querySelector('[data-prompt-queue-remove]').click()`)
      await sleep(200)
      check('remove empties the queue', (await evaluate(`document.querySelectorAll('[data-prompt-queue-item]').length`)) === 0)
      await esc()
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await shot('v70-99-error').catch(() => {})
  } finally {
    app.stop()
    server.close()
    fs.writeFileSync(path.join(OUT, 'results-v70-tools.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
