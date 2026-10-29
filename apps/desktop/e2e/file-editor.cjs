// v42 file editor: Edit → type → ● → Ctrl/⌘+S writes the file (CRLF kept); a change on disk while dirty raises the
// conflict bar (Compare, Reload); closing a dirty pane asks Save / Don't save / Cancel; a loose layout XML previews
// unsaved edits (render checks only when the layout renderer is set up).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const MAC = process.platform === 'darwin'
const MOD = MAC ? 4 : 2
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-editor-')))
const NOTES = path.join(DIR, 'notes.txt')
const LAYOUT = path.join(DIR, 'bg_native_ad_cta.xml')
const BIG = path.join(DIR, 'big.ts')
const BIG_LINES = Array.from({ length: 5000 }, (_, i) => `export const v${i} = '${'x'.repeat(i % 37)}'\t// ${i}`)
const LAYOUT_XML = '<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"\n    android:orientation="vertical">\n    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Hello" />\n</LinearLayout>\n'

function fixture() {
  fs.writeFileSync(NOTES, 'line one\r\nline two\r\n')
  fs.writeFileSync(LAYOUT, LAYOUT_XML)
  fs.writeFileSync(BIG, BIG_LINES.join('\n') + '\n')
}

/** Clipboard text with LF line ends (the OS clipboard may hold CRLF). */
async function clipboardText(evaluate) {
  let text = await evaluate(`navigator.clipboard.readText().catch(() => null)`)
  if (typeof text !== 'string') {
    const { execFileSync } = require('node:child_process')
    text = process.platform === 'darwin' ? execFileSync('pbpaste', { encoding: 'utf8' }) : execFileSync('powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Clipboard -Raw'], { encoding: 'utf8' }).replace(/\r?\n$/, '')
  }
  return text.replace(/\r\n/g, '\n')
}

const read = (p) => fs.readFileSync(p, 'utf8')

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, type, key } = app
  const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el?.click(); return !!el })()`)
  // Focus the editor and put the cursor at the start of the document (Ctrl/⌘+Home).
  const focusEditor = async () => {
    await evaluate(`document.querySelector('.cm-content')?.focus()`)
    await sleep(100)
    await key('Home', 'Home', 36, MOD)
  }
  const save = () => key('s', 'KeyS', 83, MOD)
  const closePane = () => (MAC ? key('w', 'KeyW', 87, 4) : key('W', 'KeyW', 87, 2 | 8))

  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.layout.mode','split')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
  check('preload exposes fileWrite', await evaluate(`typeof window.ccmDesktop.fileWrite === 'function'`))

  // Edit → type → dirty → save.
  await evaluate(`${W}.openFile(${JSON.stringify(NOTES)})`)
  await waitFor(`!!document.querySelector('[data-file-edit]')`, 8000, 'edit button')
  await click('[data-file-edit]')
  await waitFor(`!!document.querySelector('.cm-editor .cm-content')`, 10000, 'editor')
  await focusEditor()
  await type('hello ')
  await waitFor(`!!document.querySelector('[data-file-dirty]')`, 3000, 'dirty mark').catch(() => {})
  check('typing marks the pane dirty (●)', await evaluate(`!!document.querySelector('[data-file-dirty]') && !!document.querySelector('[data-tab-dirty]')`))
  await shot('editor-1-dirty')
  await save()
  await waitFor(`!document.querySelector('[data-file-dirty]')`, 5000, 'saved').catch(() => {})
  check('Ctrl/⌘+S writes the file and keeps CRLF', read(NOTES) === 'hello line one\r\nline two\r\n', JSON.stringify(read(NOTES)))
  check('saved pane is clean', await evaluate(`!document.querySelector('[data-file-dirty]') && !${W}.panes.some((p) => p.dirty)`))

  // Disk change while dirty → conflict bar; Compare; Reload drops the buffer.
  await focusEditor()
  await type('x')
  await waitFor(`!!document.querySelector('[data-file-dirty]')`, 3000, 'dirty again')
  await sleep(300)
  fs.writeFileSync(NOTES, 'changed outside\r\n')
  await waitFor(`!!document.querySelector('[data-file-conflict]')`, 8000, 'conflict bar').catch(() => {})
  check('disk change while dirty shows the conflict bar', await evaluate(`!!document.querySelector('[data-file-conflict]')`))
  check('the buffer was not overwritten', await evaluate(`document.querySelector('.cm-content')?.textContent.startsWith('xhello')`))
  await click('[data-conflict-compare]')
  await waitFor(`!!document.querySelector('[data-file-compare]')`, 3000, 'compare').catch(() => {})
  check('Compare shows buffer vs disk', await evaluate(`!!document.querySelector('[data-file-compare]') && !!document.querySelector('.cm-deletedChunk, .cm-changedLine')`))
  await shot('editor-2-conflict')
  await click('[data-conflict-reload]')
  await sleep(500)
  check('Reload takes the disk text and clears dirty', await evaluate(`document.querySelector('.cm-content')?.textContent.startsWith('changed outside') && !document.querySelector('[data-file-dirty]')`))

  // Clean buffer follows the disk silently.
  fs.writeFileSync(NOTES, 'second outside change\r\n')
  await waitFor(`document.querySelector('.cm-content')?.textContent.startsWith('second outside')`, 8000, 'auto reload').catch(() => {})
  check('a clean buffer reloads on its own', await evaluate(`document.querySelector('.cm-content')?.textContent.startsWith('second outside') && !document.querySelector('[data-file-conflict]')`))

  // Closing a dirty pane asks; Cancel keeps it; Save writes then closes.
  await focusEditor()
  await type('y')
  await waitFor(`!!document.querySelector('[data-file-dirty]')`, 3000, 'dirty for close')
  await closePane()
  await waitFor(`!!document.querySelector('[data-close-unsaved]')`, 3000, 'close sheet').catch(() => {})
  check('closing a dirty pane asks Save / Don’t save / Cancel', await evaluate(`!!document.querySelector('[data-close-unsaved]') && !!document.querySelector('[data-close-save]') && !!document.querySelector('[data-close-discard]')`))
  await shot('editor-3-close')
  await key('Escape', 'Escape', 27)
  await sleep(400)
  check('Cancel keeps the pane and its edits', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.dirty)`))
  await closePane()
  await waitFor(`!!document.querySelector('[data-close-save]')`, 3000, 'close sheet again')
  await click('[data-close-save]')
  await waitFor(`!${W}.panes.some((p) => p.kind === 'file')`, 5000, 'pane closed').catch(() => {})
  check('Save writes the file, then closes the pane', !(await evaluate(`${W}.panes.some((p) => p.kind === 'file')`)) && read(NOTES).startsWith('ysecond outside'), JSON.stringify(read(NOTES)))

  // v45 windowed view: Ctrl/⌘+A, Ctrl/⌘+C copies the whole file, not just the rendered rows; a selection whose rows
  // scrolled out of the DOM still copies from the model.
  await evaluate(`${W}.openFile(${JSON.stringify(BIG)})`)
  await waitFor(`!!document.querySelector('[data-windowed] [data-i]')`, 10000, 'windowed view')
  const rendered = await evaluate(`document.querySelectorAll('[data-windowed] [data-i]').length`)
  check('big file renders a window of rows', rendered > 0 && rendered < 1000, String(rendered))
  await evaluate(`document.querySelector('[data-windowed]').closest('section[tabindex]').focus()`)
  await evaluate(`navigator.clipboard.writeText('sentinel').catch(() => {})`)
  await key('a', 'KeyA', 65, MOD)
  await sleep(150)
  check('Ctrl/⌘+A marks the windowed view all-selected', await evaluate(`!!document.querySelector('[data-windowed].is-all')`))
  await key('c', 'KeyC', 67, MOD)
  await sleep(300)
  const all = await clipboardText(evaluate)
  check('Ctrl/⌘+C after select all copies the whole file', all === BIG_LINES.join('\n') + '\n', `${all.length} chars, ${all.split('\n').length} lines`)
  await shot('editor-5-select-all')
  await evaluate(`(async () => {
    const code = document.querySelector('[data-windowed]')
    const a = code.querySelector('[data-i="10"] .c')
    const b = code.querySelector('[data-i="11"] .c')
    getSelection().setBaseAndExtent(a, 0, b, 0)
    await new Promise((r) => setTimeout(r, 100))
    const sc = code.parentElement
    sc.scrollTop = sc.scrollHeight * 0.8
    await new Promise((r) => setTimeout(r, 400))
  })()`)
  const rowsNow = await evaluate(`[...document.querySelectorAll('[data-windowed] [data-i]')].map((r) => +r.dataset.i)`)
  const end = rowsNow[Math.floor(rowsNow.length / 2)]
  check('scrolling recycled the anchor row', !rowsNow.includes(10), `${rowsNow[0]}..${rowsNow.at(-1)}`)
  await evaluate(`(async () => { getSelection().extend(document.querySelector('[data-windowed] [data-i="${end}"] .c'), 0); await new Promise((r) => setTimeout(r, 100)) })()`)
  check('select all mark cleared by a new selection', await evaluate(`!document.querySelector('[data-windowed].is-all')`))
  await key('c', 'KeyC', 67, MOD)
  await sleep(300)
  const part = await clipboardText(evaluate)
  const want = BIG_LINES.slice(10, end).join('\n') + '\n'
  check('a selection across recycled rows copies from the model', part === want, `${part.length} vs ${want.length} chars`)
  await closePane()
  await waitFor(`!${W}.panes.some((p) => p.kind === 'file')`, 5000, 'big pane closed').catch(() => {})

  // Loose layout XML: design mode, live preview of unsaved text.
  await evaluate(`${W}.openFile(${JSON.stringify(LAYOUT)})`)
  await waitFor(`!!document.querySelector('[data-layout-mode]')`, 8000, 'layout mode').catch(() => {})
  check('a loose layout XML gets Code | Split | Design', await evaluate(`!!document.querySelector('[data-layout-mode]')`))
  const status = await evaluate(`window.ccmDesktop.layoutStatus()`)
  if (status?.jar && status.jdk?.ok && status.bundle?.state === 'ready') {
    const imgSel = '[data-layout-stage] img, [data-layout-preview] img'
    await waitFor(`!!document.querySelector(${JSON.stringify(imgSel)})?.src`, 60000, 'layout image').catch(() => {})
    const before = await evaluate(`document.querySelector(${JSON.stringify(imgSel)})?.src ?? ''`)
    check('loose layout renders', !!before)
    await click('[data-file-edit]')
    await waitFor(`!!document.querySelector('.cm-editor .cm-content')`, 10000, 'layout editor')
    await evaluate(`(() => { const v = document.querySelector('.cm-content'); v.focus() })()`)
    await key('End', 'End', 35, MOD)
    await key('ArrowUp', 'ArrowUp', 38)
    await key('Enter', 'Enter', 13)
    await type('    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Live" />')
    await waitFor(`(document.querySelector(${JSON.stringify(imgSel)})?.src ?? '') !== ${JSON.stringify(before)}`, 30000, 'live render').catch(() => {})
    const after = await evaluate(`document.querySelector(${JSON.stringify(imgSel)})?.src ?? ''`)
    check('preview re-renders from the buffer without saving', !!after && after !== before && read(LAYOUT) === LAYOUT_XML)
    check('live note shown', await evaluate(`!!document.querySelector('[data-file-live]')`))
    await shot('editor-4-live-layout')
  } else {
    check('layout render checks skipped (renderer not set up)', true)
  }
}

;(async () => {
  fixture()
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('editor-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-file-editor.txt'), results.join('\n'))
    try { fs.rmSync(DIR, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
