const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const NAV = `document.querySelector('nav[aria-label=Projects]')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v50-')))
const A = path.join(BASE, 'alpha')
fs.mkdirSync(A)

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const chord = async (k, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  const mouse = (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
  const center = async (sel) => JSON.parse(await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null) })()`))
  async function drag(from, to) {
    await mouse('mousePressed', from.x, from.y)
    for (let i = 1; i <= 10; i++) {
      await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10)
      await sleep(30)
    }
    await mouse('mouseReleased', to.x, to.y)
    await sleep(600)
  }

  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.workspace.explorerOpen','0'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','light'); localStorage.setItem('ccm.workspace.sidebar','1'); localStorage.setItem('ccm.tips', JSON.stringify({ off: true, learned: [], shown: {} }))`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')

  const first = await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true }).key`)
  await evaluate(`${W}.split('${first}', 'row')`)
  await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true })`)
  await waitFor(`${W}.panes.length === 3 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'three shells')
  await evaluate(`${W}.activate('${first}')`)
  await sleep(1200)
  const groupTab = await evaluate(`${W}.tabOf('${first}').key`)
  const G = `${NAV}.querySelector('[data-rail-group]')`

  check('split tab shows as one group in the rail', (await evaluate(`${NAV}.querySelectorAll('[data-rail-group]').length`)) === 1)
  check('group lists its two panes as members', (await evaluate(`${NAV}.querySelectorAll('[data-rail-member="${groupTab}"]').length`)) === 2)
  check('group icon draws the split layout (one divider)', (await evaluate(`${G}.querySelectorAll('[data-rail-group-glyph] line').length`)) === 1)
  check('group head sits at row indent, not at the project header', await evaluate(`${G}.querySelector('[data-rail-group-glyph]').getBoundingClientRect().left - ${NAV}.querySelector('[data-rail-name]').closest('button').getBoundingClientRect().left >= 12`))
  check('project folder icon is tinted', await evaluate(`${NAV}.querySelector('[data-rail-folder]')?.classList.contains('text-accent')`))
  check('group disclosure button shows the pane count', (await evaluate(`${G}.querySelector('[data-rail-group-chevron] [data-rail-group-count]')?.textContent.trim()`)) === '2')
  await shot('v50-01-rail-group')

  const heights = await evaluate(`new Promise((done) => {
    const li = ${NAV}.querySelector('[data-rail-member="${groupTab}"]').closest('li')
    const out = []
    const t0 = performance.now()
    ${G}.querySelector('[data-rail-group-chevron]').click()
    const tick = () => { out.push(Math.round(li.getBoundingClientRect().height)); performance.now() - t0 < 450 ? requestAnimationFrame(tick) : done(out) }
    requestAnimationFrame(tick)
  })`)
  const full = Math.max(...heights)
  check('collapse animates the member height', heights.some((h) => h > 1 && h < full) && heights.at(-1) <= 1, JSON.stringify(heights))
  check('collapsed: group folded, members inert', await evaluate(`${G}.hasAttribute('data-folded') && !!${NAV}.querySelector('[data-rail-member="${groupTab}"]').closest('li[inert]')`))
  check('disclosure reports collapsed', (await evaluate(`${G}.querySelector('[data-rail-group-chevron]').getAttribute('aria-expanded')`)) === 'false')
  check('collapsed group shows its state line', await evaluate(`!!${G}.querySelector('[data-rail-group-state]')`))
  await shot('v50-02-rail-group-folded')
  const opening = await evaluate(`new Promise((done) => {
    const li = ${NAV}.querySelector('[data-rail-member="${groupTab}"]').closest('li')
    const out = []
    const t0 = performance.now()
    ${G}.querySelector('[data-rail-group-chevron]').click()
    const tick = () => { out.push(Math.round(li.getBoundingClientRect().height)); performance.now() - t0 < 500 ? requestAnimationFrame(tick) : done(out) }
    requestAnimationFrame(tick)
  })`)
  check('expand animates back to full height', opening.some((h) => h > 1 && h < full) && opening.at(-1) >= full - 1, JSON.stringify(opening))
  check('store keeps the fold state', (await evaluate(`!!${W}.tabs.find((t) => t.key === '${groupTab}').folded`)) === false)

  await evaluate(`document.querySelector('[data-tab="${groupTab}"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-tab-renaming] input[data-tab-rename]')`, 3000, 'strip rename input')
  await key('Enter', 'Enter', 13)
  await sleep(300)
  check('Enter without edits keeps the automatic name', (await evaluate(`${W}.tabs.find((t) => t.key === '${groupTab}').name ?? null`)) === null)
  await evaluate(`document.querySelector('[data-tab="${groupTab}"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await waitFor(`!!document.querySelector('[data-tab-renaming] input[data-tab-rename]')`, 3000, 'strip rename input (2)')
  await evaluate(`(() => { const i = document.querySelector('[data-tab-rename]'); i.value = 'Build box'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await key('Enter', 'Enter', 13)
  await sleep(400)
  check('rename from the strip stores the tab name', (await evaluate(`${W}.tabs.find((t) => t.key === '${groupTab}').name`)) === 'Build box')
  check('strip label shows the name', (await evaluate(`document.querySelector('[data-tab-item="${groupTab}"] [data-tab-label]').textContent.trim()`)) === 'Build box')
  check('rail group title follows', (await evaluate(`${G}.querySelector('[data-rail-group-title]').textContent.trim()`)) === 'Build box')
  await shot('v50-03-renamed')

  await evaluate(`document.querySelector('[data-tab-item="${groupTab}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 80 }))`)
  await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'tab menu')
  const ids = await evaluate(`[...document.querySelectorAll('[data-context-menu] [data-menu-id]')].map((n) => n.dataset.menuId)`)
  check('tab menu: rename, ungroup, move, close', ['rename', 'ungroup', 'move', 'close'].every((id) => ids.includes(id)), JSON.stringify(ids))
  await shot('v50-04-tab-menu')
  await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="ungroup"]').click()`)
  await sleep(700)
  check('ungroup splits the tab into one tab per pane', (await evaluate(`${W}.tabs.length`)) === 3 && (await evaluate(`${NAV}.querySelectorAll('[data-rail-group]').length`)) === 0)

  const target = await evaluate(`${W}.tabOf(${W}.panes[0].key).key`)
  const moving = await evaluate(`${W}.panes[1].key`)
  const from = await center(`[data-rail-drag][data-drag-pane="${moving}"]`)
  const to = await center(`[data-rail-drop][data-drop-tab="${target}"]`)
  await drag(from, to)
  check('rail drag merges a session into another tab of the project', (await evaluate(`${W}.tabOf('${moving}')?.key`)) === target, JSON.stringify({ from, to }))
  check('merged tab is a rail group again', (await evaluate(`${NAV}.querySelectorAll('[data-rail-group]').length`)) === 1)
  await shot('v50-05-rail-merged')

  const T = `${S}.get('terminals')`
  const AG = `${S}.get('agents')`
  const main = await evaluate(`${W}.panes[0].key`)
  await evaluate(`(() => {
    const now = new Date().toISOString()
    ${T}.upsert({ id: 'e2e-v50', title: 'e2e-v50', status: 'idle', statusSince: now })
    ${AG}.upsert({ id: 'e2e-v50-main', terminalId: 'e2e-v50', role: 'main', status: 'idle' })
    ${AG}.upsert({ id: 'e2e-v50-sub', terminalId: 'e2e-v50', parentId: 'e2e-v50-main', role: 'subagent', status: 'working' })
    ${W}.update('${main}', { preset: 'claude', terminalId: 'e2e-v50' })
  })()`)
  await sleep(600)
  check('idle main + running subagent = "subagents" in the rail', (await evaluate(`${NAV}.querySelector('[data-rail-row] [data-side-pane="${main}"]')?.closest('[data-rail-row]')?.dataset.state`)) === 'subagents')
  check('pane header chip counts the subagent', (await evaluate(`document.querySelector('[data-pane="${main}"] [data-subagents]')?.dataset.subagents`)) === '1')
  check('strip tab status is working, not idle', (await evaluate(`document.querySelector('[data-tab-item="${target}"] [data-tab-status]')?.dataset.tabStatus`)) === 'working')
  await shot('v50-06-subagents')
  await evaluate(`${AG}.patch({ id: 'e2e-v50-sub', status: 'completed' })`)
  await sleep(500)
  check('subagent done: rail no longer waits on it', (await evaluate(`${NAV}.querySelector('[data-side-pane="${main}"]')?.closest('[data-rail-row]')?.dataset.state`)) !== 'subagents')

  await evaluate(`${W}.activate('${main}')`)
  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus()`)
  await chord('O', 'KeyO', 79, CTRL | SHIFT)
  await waitFor(`!!document.querySelector('[data-mission][role=dialog]')`, 5000, 'mission open')
  await sleep(700)
  check('Mission Control: one card per tab', (await evaluate(`document.querySelectorAll('[data-mission-card]').length`)) === 2)
  check('grouped card holds both panes', (await evaluate(`document.querySelectorAll('[data-mission-card="${target}"] [data-mission-tile]').length`)) === 2)
  await shot('v50-07-mission')
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed')

  await evaluate(`${S}.get('settings').dustEffect = true`)
  const bytes = await evaluate(`window.ccmDesktop.captureRect({ x: 0, y: 0, width: 40, height: 20 }).then((b) => b?.byteLength ?? b?.length ?? 0)`)
  check('capture-rect returns a PNG for the dust effect', bytes > 0, String(bytes))

  const lone = await evaluate(`${W}.tabs.find((t) => t.key !== '${target}').key`)
  await evaluate(`${W}.activateTab('${lone}')`)
  await sleep(400)
  const dust = await evaluate(`new Promise((done) => {
    let most = 0
    let last = 0
    let seen = 0
    const gaps = []
    const t0 = performance.now()
    const buttons = document.querySelectorAll('[data-tab-item="${lone}"] button')
    buttons[buttons.length - 1].click()
    const tick = () => {
      if (${W}.pendingClose) document.querySelector('[data-close-discard], .ccm-btn-danger')?.click()
      const now = performance.now()
      const live = document.querySelectorAll('[data-dust] canvas').length
      if (live) {
        if (seen) gaps.push(Math.round(now - last))
        seen++
      }
      last = now
      most = Math.max(most, live)
      now - t0 < 2500 ? requestAnimationFrame(tick) : done({ most, frames: gaps.length, worst: Math.max(0, ...gaps), slow: gaps.filter((g) => g > 34).length, at: gaps.map((g, i) => [i, g]).filter(([, g]) => g > 34) })
    }
    requestAnimationFrame(tick)
  })`)
  check('closing a tab scatters it into dust', dust.most >= 16, JSON.stringify(dust))
  check('dust runs without long frames (worst gap under 50 ms, at most 2 over 34 ms)', dust.worst < 50 && dust.slow <= 2, JSON.stringify(dust))
  await sleep(1500)
  check('dust overlay clears afterwards', (await evaluate(`document.querySelectorAll('[data-dust] canvas').length`)) === 0)
  check('closed tab is gone', (await evaluate(`${W}.tabs.some((t) => t.key === '${lone}')`)) === false)

  await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true })`)
  await waitFor(`${W}.tabs.length === 2`, 10000, 'second tab')
  await sleep(800)
  await evaluate(`${W}.activateTab('${target}')`)
  await evaluate(`document.querySelector('[data-tab="${target}"]').focus()`)
  const before = await evaluate(`${W}.tabs.findIndex((t) => t.key === '${target}')`)
  await chord('PageDown', 'PageDown', 34, CTRL | SHIFT)
  const after = await evaluate(`${W}.tabs.findIndex((t) => t.key === '${target}')`)
  check('Ctrl+Shift+PgDn moves the tab right', after === before + 1, `${before} → ${after}`)
  await shot('v50-08-moved')
  await evaluate(`setTimeout(() => { const b = document.querySelectorAll('[data-tab-item="${target}"] button'); b[b.length - 1].click() }, 0)`)
  await waitFor(`!!${W}.pendingClose`, 3000, 'close sheet').catch(() => {})
  await evaluate(`document.querySelector('.ccm-btn-danger')?.click()`)
  await sleep(560)
  await shot('v50-09-dust-mid')
}

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('v50-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-v50.txt'), results.join('\n'))
    try {
      fs.rmSync(BASE, { recursive: true, force: true })
    } catch {}
    process.exit(0)
  }
})()
