// Links in a terminal pane, every way a CLI prints them: OSC 8 (Claude Code sign-in URLs) or plain text, wrapped by the CLI itself
// (indent, box borders) or by xterm, and inside a full-screen app that tracks the mouse and copies through OSC 52.
// Copy joins the rows, right-click copies the whole link, Ctrl+click opens it. Remote links are only copied (a click would open the real browser).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-links-'))
// `node printer.js <scenario> <layout.json>`: clears the screen, prints the scenario from row 0, writes where things are, stays in the foreground.
const PRINTER = String.raw`const fs = require('node:fs')
const [, , scenario, out] = process.argv
const E = '\x1b'
const ST = E + '\\'
const open = (u) => E + ']8;;' + u + ST
const close = E + ']8;;' + ST
const cols = process.stdout.columns
const remote = 'https://www.figma.com/oauth?client_id=e2e&redirect_uri=http%3A%2F%2Flocalhost%3A5555%2Fcallback&state=' + 'x'.repeat(cols * 2)
const local = 'http://127.0.0.1:9/cb?code=' + 'z'.repeat(cols)
const chunk = (s, n) => { const a = []; for (let i = 0; i < s.length; i += n) a.push(s.slice(i, i + n)); return a }
const box = (inner) => ['╭' + '─'.repeat(cols - 2) + '╮', ...inner.map(([text, len]) => '│ ' + text + ' '.repeat(cols - 4 - len) + ' │'), '╰' + '─'.repeat(cols - 2) + '╯']
let lines = []
let layout = {}
let mouse = false
const osc = (c) => c.map((x) => '  ' + open(remote) + x + close)
switch (scenario) {
  case 'osc': {
    const c = chunk(remote, 40)
    lines = ['copy this URL manually', ...osc(c), 'Press Enter', open('http://127.0.0.1:9/oauth-callback') + 'http://127.0.0.1:9/oauth-callback' + close]
    layout = { first: 1, last: c.length, col: 2, tail: c.at(-1).length, expect: remote, click: { row: c.length + 2, col: 4, url: 'http://127.0.0.1:9/oauth-callback' } }
    break
  }
  case 'oscbox': {
    const c = chunk(remote, cols - 4)
    lines = box(c.map((x) => [open(remote) + x + close, x.length]))
    layout = { first: 1, last: c.length, col: 2, tail: c.at(-1).length, expect: remote }
    break
  }
  case 'plain': {
    const c = chunk(remote, cols - 2)
    const l = chunk(local, cols - 2)
    lines = ['Browser didn\'t open? Visit:', ...c.map((x) => '  ' + x), '', ...l.map((x) => '  ' + x)]
    layout = { first: 1, last: c.length, col: 2, tail: c.at(-1).length, expect: remote, click: { row: c.length + 3, col: 6, url: local } }
    break
  }
  case 'plainbox': {
    const c = chunk(remote, cols - 4)
    lines = box(c.map((x) => [x, x.length]))
    layout = { first: 1, last: c.length, col: 2, tail: c.at(-1).length, expect: remote }
    break
  }
  case 'soft': {
    lines = [remote]
    layout = { first: 0, last: Math.ceil(remote.length / cols) - 1, col: 0, tail: remote.length % cols || cols, expect: remote }
    break
  }
  case 'two': {
    lines = ['https://a.dev/one', 'https://a.dev/two']
    layout = { first: 0, last: 1, col: 0, tail: 17, expect: 'https://a.dev/one\nhttps://a.dev/two' }
    break
  }
  case 'mouse': {
    const c = chunk(remote, 40)
    mouse = true
    lines = ['full-screen app', ...osc(c), open('http://127.0.0.1:9/oauth-callback') + 'http://127.0.0.1:9/oauth-callback' + close]
    layout = { first: 1, last: c.length, col: 2, tail: c.at(-1).length, expect: remote, click: { row: c.length + 1, col: 4, url: 'http://127.0.0.1:9/oauth-callback' }, osc52: c.join('\n  ') }
    break
  }
}
const quit = () => { if (mouse) process.stdout.write(E + '[?1006l' + E + '[?1002l' + E + '[?1000l' + E + '[?1049l'); process.exit(0) }
// Raw (VT input) first: ConPTY passes mouse-mode requests on to the terminal only then.
process.stdin.setRawMode(true)
if (mouse) process.stdout.write(E + '[?1049h' + E + '[?1000h' + E + '[?1002h' + E + '[?1006h')
fs.writeFileSync(out, JSON.stringify({ cols, rows: process.stdout.rows, ...layout }))
process.stdout.write(E + '[2J' + E + '[H' + lines.join('\r\n'))
process.stdin.on('data', (d) => {
  const s = d.toString()
  if (s.includes('\x03')) quit()
  // 'y': copy like Claude Code's full-screen selection does, through the terminal.
  if (s.includes('y') && layout.osc52) process.stdout.write(E + ']52;c;' + Buffer.from(layout.osc52).toString('base64') + '\x07')
})
`

;(async () => {
  fs.writeFileSync(path.join(DIR, 'printer.js'), PRINTER)
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  const mouse = (type, x, y, extra = {}) => cmd('Input.dispatchMouseEvent', { type, x, y, ...extra })
  const clip = async () => (await evaluate(`navigator.clipboard.readText()`))?.replace(/\r\n/g, '\n')
  const clearClip = () => evaluate(`navigator.clipboard.writeText('')`)
  const ctrlKey = async (k, vk) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: vk, modifiers: CTRL })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: vk, modifiers: CTRL })
    await sleep(400)
  }
  const focusPane = () => evaluate(`document.querySelector('[data-pane="' + ${W}.activeKey + '"] .xterm-helper-textarea').focus()`)
  const browserUrl = () => evaluate(`${W}.panes.find((p) => p.kind === 'browser')?.url ?? null`)

  const diff = (got, want) => {
    let i = 0
    while (i < want.length && got?.[i] === want[i]) i++
    return `len ${got?.length} want ${want.length}, first diff at ${i}: ${JSON.stringify(got?.slice(Math.max(0, i - 5), i + 15))}`
  }

  /** Runs one printer scenario; `fn` gets the layout and a cell → screen point mapper. */
  async function scenario(name, fn) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) return
    const file = path.join(DIR, `${name}.json`)
    await focusPane()
    await type(`node printer.js ${name} "${file}"`)
    await key('Enter', 'Enter', 13)
    for (let i = 0; i < 40 && !fs.existsSync(file); i++) await sleep(250)
    await sleep(1200)
    const L = JSON.parse(fs.readFileSync(file, 'utf8'))
    const rect = await evaluate(`(() => { const r = document.querySelector('[data-pane="' + ${W}.activeKey + '"] .xterm-screen').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`)
    if (process.env.DEBUG) await shot(`links-${name}-0`)
    if (process.env.DEBUG) console.log(name, JSON.stringify({ cols: L.cols, rows: L.rows, rect, first: L.first, last: L.last, tail: L.tail }))
    // Column may be L.cols (the right edge): xterm selects up to the nearest cell boundary.
    const cell = (col, row) => ({ x: Math.min(rect.x + (col + 0.5) * (rect.w / L.cols), rect.x + rect.w - 1), y: rect.y + (row + 0.5) * (rect.h / L.rows) })
    try {
      await fn(L, cell)
    } catch (e) {
      check(`${name}: run`, false, e.message)
    }
    await shot(`links-${name}`)
    // A plain click on an empty row drops any selection, so Ctrl+C below interrupts the printer.
    const blank = cell(1, L.rows - 2)
    await mouse('mousePressed', blank.x, blank.y, { button: 'left', buttons: 1, clickCount: 1 })
    await mouse('mouseReleased', blank.x, blank.y, { button: 'left', buttons: 0, clickCount: 1 })
    await mouse('mouseMoved', 1, 1)
    await focusPane()
    await ctrlKey('c', 67)
    await sleep(800)
  }

  async function select(L, cell, mods = 0) {
    const a = cell(L.col, L.first)
    const b = cell(L.col + L.tail, L.last)
    await mouse('mouseMoved', a.x, a.y, { modifiers: mods })
    await mouse('mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1, modifiers: mods })
    await mouse('mouseMoved', (a.x + b.x) / 2, (a.y + b.y) / 2, { button: 'left', buttons: 1, modifiers: mods })
    await mouse('mouseMoved', b.x, b.y, { button: 'left', buttons: 1, modifiers: mods })
    await mouse('mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1, modifiers: mods })
    await sleep(300)
  }

  async function copyCheck(name, L, cell, mods = 0) {
    await clearClip()
    await select(L, cell, mods)
    if (process.env.DEBUG) {
      await shot(`links-${name.replace(/\W+/g, '-')}-sel`)
      console.log('xterm classes', await evaluate(`document.querySelector('[data-pane="' + ${W}.activeKey + '"] .xterm').className`))
    }
    await ctrlKey('c', 67)
    const got = await clip()
    check(`${name}: copy`, got === L.expect, got === L.expect ? '' : diff(got, L.expect))
  }

  async function rightClickCheck(name, L, cell) {
    await clearClip()
    const at = cell(L.col + 3, L.last === L.first ? L.first : L.first + 1)
    await mouse('mouseMoved', at.x, at.y)
    await sleep(500)
    const hint = await evaluate(`document.querySelector('[data-pane="' + ${W}.activeKey + '"] [data-code-zoom]').title`)
    check(`${name}: hover hint`, /right-click to copy/.test(hint ?? ''), hint)
    await mouse('mousePressed', at.x, at.y, { button: 'right', buttons: 2, clickCount: 1 })
    await mouse('mouseReleased', at.x, at.y, { button: 'right', buttons: 0, clickCount: 1 })
    await sleep(400)
    const got = await clip()
    check(`${name}: right-click copies the whole link`, got === L.expect, JSON.stringify(got))
  }

  async function clickCheck(name, L, cell) {
    await evaluate(`${W}.panes.filter((p) => p.kind === 'browser').forEach((p) => ${W}.remove(p.key))`)
    await sleep(300)
    const at = cell(L.click.col, L.click.row)
    await mouse('mouseMoved', at.x, at.y, { modifiers: CTRL })
    await sleep(500)
    await mouse('mousePressed', at.x, at.y, { button: 'left', buttons: 1, clickCount: 1, modifiers: CTRL })
    await mouse('mouseReleased', at.x, at.y, { button: 'left', buttons: 0, clickCount: 1, modifiers: CTRL })
    const ok = await waitFor(`${W}.panes.find((p) => p.kind === 'browser')?.url === ${JSON.stringify(L.click.url)}`, 6000, 'browser tab').catch(() => false)
    check(`${name}: Ctrl+click opens the full link`, !!ok, ok ? '' : JSON.stringify(await browserUrl()))
    const term = await evaluate(`${W}.panes.find((p) => !p.kind)?.key`)
    await evaluate(`${W}.panes.filter((p) => p.kind === 'browser').forEach((p) => ${W}.remove(p.key)); ${W}.activate(${JSON.stringify(term)})`)
    await sleep(600)
  }

  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.workspace.explorerOpen','0'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
    await sleep(1500)

    await scenario('osc', async (L, cell) => {
      await copyCheck('OSC 8, indented', L, cell)
      check('OSC 8: Ctrl+C was a copy, not an interrupt', (await evaluate(`${W}.panes[0].state`)) === 'running')
      await rightClickCheck('OSC 8, indented', L, cell)
      await clickCheck('OSC 8', L, cell)
    })
    await scenario('oscbox', async (L, cell) => {
      await copyCheck('OSC 8 in a box', L, cell)
      await rightClickCheck('OSC 8 in a box', L, cell)
    })
    await scenario('plain', async (L, cell) => {
      await copyCheck('plain URL cut at the edge', L, cell)
      await rightClickCheck('plain URL cut at the edge', L, cell)
      await clickCheck('plain URL cut at the edge', L, cell)
    })
    await scenario('plainbox', async (L, cell) => {
      await copyCheck('plain URL in a box', L, cell)
      await rightClickCheck('plain URL in a box', L, cell)
    })
    await scenario('soft', async (L, cell) => {
      await copyCheck('plain URL wrapped by xterm', L, cell)
      await rightClickCheck('plain URL wrapped by xterm', L, cell)
    })
    await scenario('two', async (L, cell) => {
      await copyCheck('two URLs on two rows stay apart', L, cell)
    })
    await scenario('mouse', async (L, cell) => {
      await copyCheck('mouse-tracking app, Shift-drag', L, cell, SHIFT)
      await clickCheck('mouse-tracking app', L, cell)
      await clearClip()
      await focusPane()
      await type('y')
      await sleep(600)
      const got = await clip()
      check('mouse-tracking app: OSC 52 copy joins the link', got === L.expect, JSON.stringify(got))
    })
  } catch (e) {
    check('run', false, e.message)
    await shot('links-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-links.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
