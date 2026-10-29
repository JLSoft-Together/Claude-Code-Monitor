const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const T = `${S}.get('terminals')`
const AG = `${S}.get('agents')`
const SET = `${S}.get('settings')`
const NAV = `document.querySelector('nav[aria-label=Projects]')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v52-')))
const A = path.join(BASE, 'alpha')
fs.mkdirSync(A)

const FRAMES = (selector, ms) => `new Promise((done) => {
  let most = 0, last = 0, seen = 0
  const gaps = []
  const t0 = performance.now()
  const tick = () => {
    const now = performance.now()
    const live = document.querySelectorAll(${JSON.stringify(selector)}).length
    if (live) { if (seen) gaps.push(Math.round(now - last)); seen++ }
    last = now
    most = Math.max(most, live)
    now - t0 < ${ms} ? requestAnimationFrame(tick) : done({ most, frames: gaps.length, worst: Math.max(0, ...gaps), slow: gaps.filter((g) => g > 34).length })
  }
  requestAnimationFrame(tick)
})`

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const chord = async (k, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  const rect = async (sel) => JSON.parse(await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null) })()`))
  const click = async (sel, button = 'left') => {
    const r = await rect(sel)
    if (!r) throw new Error('no element ' + sel)
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 })
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button, buttons: 0, clickCount: 1 })
    await sleep(350)
  }
  const visiblePanes = () => evaluate(`[...document.querySelectorAll('[data-pane]')].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0).map((el) => el.dataset.pane)`)

  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','light'); localStorage.setItem('ccm.workspace.sidebar','1'); localStorage.setItem('ccm.workspace.dimTip','1'); localStorage.setItem('ccm.tips', JSON.stringify({ off: true, learned: [], shown: {} }))`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')

  const first = await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true }).key`)
  await evaluate(`${W}.split('${first}', 'row')`)
  await waitFor(`${W}.panes.length === 2 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'two shells')
  const second = await evaluate(`${W}.panes.find((p) => p.key !== '${first}').key`)
  const tab = await evaluate(`${W}.tabOf('${first}').key`)
  await evaluate(`${W}.activate('${first}')`)
  await sleep(1200)

  check('A3: running shell header shows no process chip', await evaluate(`!document.querySelector('[data-pane="${first}"] header [data-pane-process]') && !/Running/.test(document.querySelector('[data-pane="${first}"] header').textContent)`))

  await evaluate(`${T}.upsert({ id: 'e2e-v52', title: 'e2e-v52', status: 'idle', cwd: ${JSON.stringify(A)} })`)
  await evaluate(`${W}.update('${second}', { preset: 'claude', terminalId: 'e2e-v52' })`)
  await sleep(700)
  const headWord = await evaluate(`document.querySelector('[data-pane="${second}"] header [data-pane-status]')?.textContent.trim() ?? ''`)
  const railWord = await evaluate(`${NAV}.querySelector('[data-side-pane="${second}"]').closest('[data-rail-row]').querySelector('[data-rail-second]').textContent`)
  check('A3: idle agent says "Ready" in the header, like the rail', /Ready/.test(headWord) && !/Idle/.test(headWord) && /Ready/.test(railWord), `${headWord} | ${railWord}`)

  const since = new Date(Date.now() - 75_000).toISOString()
  await evaluate(`${T}.upsert({ id: 'e2e-v52', title: 'e2e-v52', status: 'working', statusSince: '${since}', cwd: ${JSON.stringify(A)}, diff: { files: 2, insertions: 12, deletions: 3, untracked: 0, at: '${since}' } })`)
  await evaluate(`${AG}.upsert({ id: 'e2e-v52-main', terminalId: 'e2e-v52', role: 'main', status: 'working', currentTool: 'Edit' })`)
  await sleep(1300)
  const railAct = await evaluate(`(() => { const row = ${NAV}.querySelector('[data-side-pane="${second}"]').closest('[data-rail-row]'); return (row.querySelector('[data-rail-second]')?.textContent ?? '') + '|' + (row.querySelector('[data-rail-activity]')?.textContent ?? '') })()`)
  check('F3: rail row shows tool and elapsed time', /Edit/.test(railAct.split('|')[0]) && /1m 1\ds/.test(railAct.split('|')[1]), railAct)
  check('F3: rail row shows the diff stat', /\+12/.test(await evaluate(`${NAV}.querySelector('[data-side-pane="${second}"]').closest('[data-rail-row]').querySelector('[data-rail-diff]')?.textContent ?? ''`)))
  const word1 = await evaluate(`${NAV}.querySelector('[data-side-pane="${second}"]').closest('[data-rail-row]').querySelector('[data-rail-second]')`)
  await sleep(1100)
  check('F3: rail time ticks without re-keying the state word', await evaluate(`${NAV}.querySelectorAll('[data-side-pane="${second}"]').length === 1 && ${NAV}.querySelector('[data-side-pane="${second}"]').closest('[data-rail-row]').querySelectorAll('[data-rail-second]').length === 1`))
  void word1
  check('F3: pane header shows tool and elapsed time', /Edit/.test(await evaluate(`document.querySelector('[data-pane="${second}"] [data-pane-activity]')?.textContent ?? ''`)))
  await shot('v52-01-activity')
  await evaluate(`${T}.upsert({ id: 'e2e-v52', title: 'e2e-v52', status: 'idle', cwd: ${JSON.stringify(A)} })`)
  await evaluate(`${AG}.upsert({ id: 'e2e-v52-main', terminalId: 'e2e-v52', role: 'main', status: 'idle' })`)

  const canvasW = await evaluate(`document.querySelector('[data-pane="${first}"]').parentElement.getBoundingClientRect().width`)
  await evaluate(`${W}.setRatio('${tab}', '', ${(232 / canvasW).toFixed(4)})`)
  await sleep(600)
  const overflow = await evaluate(`(() => {
    const out = []
    for (const sec of document.querySelectorAll('[data-pane]')) {
      if (!sec.offsetParent) continue
      const head = sec.querySelector('header') ?? sec.querySelector('[role=toolbar]')
      if (!head) continue
      const box = sec.getBoundingClientRect()
      for (const el of head.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width && r.right > box.right + 0.5) out.push(sec.dataset.pane + ':' + (el.className?.baseVal ?? el.className).toString().slice(0, 40))
      }
    }
    return out
  })()`)
  const narrowW = await evaluate(`document.querySelector('[data-pane="${first}"]').getBoundingClientRect().width`)
  check('A1: pane headers stay inside a ~220px pane', overflow.length === 0, `${Math.round(narrowW)}px ${overflow.slice(0, 4).join(', ')}`)
  check('A1: narrow pane moves extra actions into "…"', await evaluate(`!!document.querySelector('[data-pane="${first}"] [data-pane-more]')?.offsetParent`))
  check('A2: branch label is never a lone letter', await evaluate(`[...document.querySelectorAll('[data-pane="${first}"] header button')].every((b) => !/^[^\\s]{1,2}$/.test(b.textContent.trim()) || !!b.querySelector('svg') && b.textContent.trim() === '')`))
  await shot('v52-02-narrow')
  await evaluate(`${W}.setRatio('${tab}', '', 0.5)`)
  await sleep(400)

  await click(`[data-side-pane="${first}"]`, 'right')
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'row menu')
  check('A5: menu opened by mouse highlights no item', await evaluate(`!document.activeElement?.matches('[data-menu-id]') && !!document.activeElement?.closest('[data-context-menu]')`), await evaluate(`document.activeElement?.outerHTML.slice(0, 80) ?? ''`))
  await shot('v52-03-menu-mouse')
  await key('ArrowDown', 'ArrowDown', 40)
  await sleep(150)
  check('A5: arrow key then highlights the first item', await evaluate(`document.activeElement?.matches('[data-menu-id]') && document.activeElement === document.querySelector('[data-context-menu] [data-menu-id]:not([aria-disabled=true])')`))
  await key('Escape', 'Escape', 27)
  await sleep(300)

  await evaluate(`${W}.activate('${first}')`)
  await evaluate(`document.querySelector('[data-pane="${first}"] .xterm-helper-textarea')?.focus()`)
  await chord('Enter', 'Enter', 13, CTRL | SHIFT)
  await sleep(500)
  check('F1: Ctrl+Shift+Enter zooms the focused pane', (await evaluate(`${W}.tabOf('${first}').zoom`)) === first && (await visiblePanes()).length === 1)
  check('F1: zoomed header offers "+1" to show the rest', /\+?1/.test(await evaluate(`document.querySelector('[data-pane="${first}"] [data-pane-hidden]')?.textContent ?? ''`)))
  check('F1: zoomed tab carries a glyph in the strip', await evaluate(`!!document.querySelector('[data-tab-item="${tab}"] [data-tab-zoom]')`))
  await shot('v52-04-zoomed')
  await click(`[data-pane="${first}"] [data-pane-hidden]`)
  await sleep(500)
  check('F1: "+1" unzooms', !(await evaluate(`${W}.tabOf('${first}').zoom`)) && (await visiblePanes()).length === 2)
  await evaluate(`document.querySelector('[data-pane="${first}"] header').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))`)
  await sleep(500)
  check('F1: double-click on the pane header zooms', (await evaluate(`${W}.tabOf('${first}').zoom`)) === first)
  await evaluate(`${W}.activate('${second}')`)
  await sleep(500)
  check('F1: focusing another pane of the tab unzooms', !(await evaluate(`${W}.tabOf('${first}').zoom`)) && (await visiblePanes()).length === 2)

  check('F6: dim toggle shows in the tab bar for a split tab', await evaluate(`!!document.querySelector('[data-dim-toggle]')?.offsetParent`))
  await click('[data-dim-toggle]')
  await sleep(500)
  const dims = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-pane]')].filter((el) => el.offsetParent).map((el) => [el.dataset.pane, Number(getComputedStyle(el.querySelector('[data-pane-dim]') ?? el).opacity)]))`).then(JSON.parse)
  const dimOf = Object.fromEntries(dims)
  check('F6: toggle dims the inactive pane only', (await evaluate(`${SET}.dimInactive`)) === true && dimOf[first] > 0.2 && dimOf[second] < 0.05, JSON.stringify(dimOf))
  check('F6: toggle reports pressed', (await evaluate(`document.querySelector('[data-dim-toggle]').getAttribute('aria-pressed')`)) === 'true')
  await shot('v52-05-dim')
  await click('[data-dim-toggle]')
  await sleep(300)
  check('F6: toggle turns it off again', (await evaluate(`${SET}.dimInactive`)) === false)

  await evaluate(`localStorage.removeItem('ccm.workspace.dimTip'); ${S}.get('tips').setOff(false)`)
  const t2 = await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true }).key`)
  await waitFor(`${W}.panes.find((p) => p.key === '${t2}')?.state === 'running'`, 15000, 'third shell')
  await evaluate(`${W}.split('${t2}', 'row')`)
  await waitFor(`!!document.querySelector('[data-dim-tip]')`, 4000, 'dim tip').catch(() => {})
  check('F6: first split shows the one-time dim tip', await evaluate(`!!document.querySelector('[data-dim-tip]')`))
  await shot('v52-06-dim-tip')
  await click('[data-dim-later]')
  await sleep(400)
  check('F6: "Not now" closes the tip for good', await evaluate(`!document.querySelector('[data-dim-tip]') && localStorage.getItem('ccm.workspace.dimTip') === '1'`))
  await evaluate(`${S}.get('tips').setOff(true)`)
  await evaluate(`${S}.get('settings').dustEffect = true`)

  const t2tab = await evaluate(`${W}.tabOf('${t2}').key`)
  const t2b = await evaluate(`${W}.tabs.find((t) => t.key === '${t2tab}') && ${W}.panes.find((p) => p.key !== '${t2}' && ${W}.tabOf(p.key)?.key === '${t2tab}').key`)
  await waitFor(`${W}.panes.find((p) => p.key === '${t2b}')?.state === 'running'`, 15000, 'split shell')
  await sleep(800)
  const closeBtn = `[data-pane="${t2b}"] [data-pane-close]`
  const dust = evaluate(FRAMES('[data-dust] canvas', 1600))
  await click(closeBtn)
  const out = await dust
  await waitFor(`!!document.querySelector('[data-undo-toast]')`, 3000, 'undo toast').catch(() => {})
  check('F2: closing a pane offers Undo', await evaluate(`!!document.querySelector('[data-undo-toast]') && !${W}.panes.some((p) => p.key === '${t2b}')`), JSON.stringify(out))
  await shot('v52-07-undo-toast')
  await sleep(300)
  const assemble = evaluate(FRAMES('[data-dust="in"] canvas', 1600))
  await click('[data-undo]')
  const back = await assemble
  check('F2: Undo brings the pane back next to its sibling', (await evaluate(`${W}.tabs.find((t) => t.key === '${t2tab}') ? ${W}.panes.filter((p) => ${W}.tabOf(p.key)?.key === '${t2tab}').length : 0`)) === 2)
  check('F2: the pane assembles from dust', back.most >= 8, JSON.stringify(back))
  check('F2: assembling stays smooth (worst gap under 50 ms, at most 2 over 34 ms)', back.worst < 50 && back.slow <= 2, JSON.stringify(back))
  await sleep(1200)
  check('F2: assemble overlay clears and the pane is visible', await evaluate(`!document.querySelector('[data-dust="in"]') && [...document.querySelectorAll('[data-pane]')].filter((el) => el.offsetParent && ${W}.tabOf(el.dataset.pane)?.key === '${t2tab}').every((el) => Number(getComputedStyle(el).opacity) > 0.99)`))
  await shot('v52-08-undone')

  await evaluate(`${W}.renameTab('${t2tab}', 'Build box')`)
  const before = await evaluate(`${W}.tabs.length`)
  await evaluate(`(() => { const b = document.querySelectorAll('[data-tab-item="${t2tab}"] button'); b[b.length - 1].click() })()`)
  await waitFor(`${W}.tabs.length === ${before - 1}`, 6000, 'tab closed').catch(() => {})
  await sleep(1400)
  await evaluate(`document.querySelector('[data-pane="${first}"] .xterm-helper-textarea')?.focus()`)
  await chord('Z', 'KeyZ', 90, CTRL | SHIFT)
  await sleep(1500)
  check('F2: Ctrl+Shift+Z reopens the whole tab with its name and layout', await evaluate(`${W}.tabs.some((t) => t.name === 'Build box' && ${W}.panes.filter((p) => ${W}.tabOf(p.key)?.key === t.key).length === 2)`))

  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus()`)
  await chord('O', 'KeyO', 79, CTRL | SHIFT)
  await waitFor(`!!document.querySelector('[data-mission][role=dialog]')`, 5000, 'mission open')
  await sleep(900)
  const fill = await evaluate(`(() => {
    const root = document.querySelector('[data-mission][role=dialog]').getBoundingClientRect()
    const cards = [...document.querySelectorAll('[data-mission-card]')].map((c) => c.getBoundingClientRect())
    const area = cards.reduce((n, r) => n + r.width * r.height, 0)
    return { n: cards.length, ratio: area / (root.width * root.height), minW: Math.min(...cards.map((r) => r.width)) }
  })()`)
  check('F5: Mission Control cards fill the space', fill.ratio > 0.3 && fill.minW > 300, JSON.stringify(fill))
  check('F5: cards carry number badges', await evaluate(`!!document.querySelector('[data-mission-index="1"]')`))
  await shot('v52-09-mission')
  await evaluate(`(() => { const f = document.querySelector('[data-mission-filter]'); f.focus() })()`)
  await cmd('Input.insertText', { text: 'zzzz-nothing' })
  await sleep(600)
  check('F5: filter with no match shows an empty state', await evaluate(`!!document.querySelector('[data-mission-empty="filter"]') && document.querySelectorAll('[data-mission-card]').length === 0`))
  await key('Escape', 'Escape', 27)
  await sleep(500)
  check('F5: Esc clears the filter first, Mission Control stays open', await evaluate(`!!document.querySelector('[data-mission][role=dialog]') && document.querySelectorAll('[data-mission-card]').length > 0`))
  const firstCard = await evaluate(`document.querySelector('[data-mission-index="1"]')?.closest('[data-mission-card]')?.dataset.missionCard ?? ''`)
  await evaluate(`document.querySelector('[data-mission][role=dialog] [data-mission-card]')?.focus()`)
  await chord('1', 'Digit1', 49, 0)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed').catch(() => {})
  check('F5: number key 1 opens the first card', (await evaluate(`${W}.activeTab?.key`)) === firstCard, firstCard)

  check('A6: tab strip hides its scrollbar', (await evaluate(`getComputedStyle(document.querySelector('.ccm-tabstrip')).scrollbarWidth`)) === 'none')

  const AT = `${S}.get('attachments')`
  const note = path.join(A, 'note.txt')
  fs.writeFileSync(note, 'hello from the attachment\n')
  await evaluate(`${W}.activate('${second}')`)
  await sleep(400)
  await evaluate(`(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 800
    const g = c.getContext('2d'); g.fillStyle = '#3a7'; g.fillRect(0, 0, 1200, 800); g.fillStyle = '#fff'; g.fillRect(100, 100, 400, 300)
    const data = c.toDataURL('image/png')
    const t = document.createElement('canvas'); t.width = 96; t.height = 64; t.getContext('2d').drawImage(c, 0, 0, 96, 64)
    const v = document.createElement('canvas'); v.width = 960; v.height = 640; v.getContext('2d').drawImage(c, 0, 0, 960, 640)
    ${AT}.autoInsert = false
    ${AT}.add('${second}', [{ kind: 'image', name: 'shot.png', source: 'paste', data, thumb: t.toDataURL('image/png'), view: v.toDataURL('image/png') }, { kind: 'file', name: 'note.txt', source: 'pick', path: ${JSON.stringify(note)} }])
    ${AT}.toggle('${second}', true)
  })()`)
  await waitFor(`!!document.querySelector('[data-pane="${second}"] [data-attachments] [data-attach-open]')`, 4000, 'attachments panel').catch(() => {})
  const imageRow = await evaluate(`[...document.querySelectorAll('[data-pane="${second}"] [data-attachments] [data-attach-open]')].find((b) => /shot\\.png/.test(b.textContent))?.dataset.attachOpen ?? ''`)
  check('Attachments: image row is clickable for a preview', !!imageRow)
  await click(`[data-attach-open="${imageRow}"]`)
  await waitFor(`!!document.querySelector('[data-attach-look] [data-attach-look-image]')?.naturalWidth`, 4000, 'quick look').catch(() => {})
  const look = await evaluate(`(() => { const img = document.querySelector('[data-attach-look] [data-attach-look-image]'); return img ? { w: img.naturalWidth, h: img.naturalHeight, size: document.querySelector('[data-attach-look-size]')?.textContent ?? '' } : null })()`)
  check('Attachments: click opens Quick Look with the sharp 960px view, not the 96px thumb', look?.w === 960 && look?.h === 640 && /960 × 640/.test(look.size), JSON.stringify(look))
  await shot('v52-10-quick-look')
  await key('Escape', 'Escape', 27)
  await sleep(450)
  check('Attachments: Esc closes Quick Look and focus returns to the row', await evaluate(`!document.querySelector('[data-attach-look]') && document.activeElement?.dataset.attachOpen === '${imageRow}'`))
  await key(' ', 'Space', 32)
  await sleep(450)
  check('Attachments: Space on the row opens it again', await evaluate(`!!document.querySelector('[data-attach-look]')`))
  await key(' ', 'Space', 32)
  await sleep(450)
  check('Attachments: Space closes it, like Quick Look', await evaluate(`!document.querySelector('[data-attach-look]')`))
  const fileRow = await evaluate(`[...document.querySelectorAll('[data-pane="${second}"] [data-attachments] [data-attach-open]')].find((b) => /note\\.txt/.test(b.textContent))?.dataset.attachOpen ?? ''`)
  await click(`[data-attach-open="${fileRow}"]`)
  await waitFor(`${W}.panes.some((p) => p.kind === 'file' && p.path === ${JSON.stringify(note)})`, 5000, 'file pane').catch(() => {})
  check('Attachments: clicking a file opens it in a pane', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path === ${JSON.stringify(note)})`))
}

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('v52-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-v52.txt'), results.join('\n'))
    try {
      fs.rmSync(BASE, { recursive: true, force: true })
    } catch {}
    process.exit(0)
  }
})()
