// v38 multi-project: project rail, project-scoped strip (Spaces), Mission Control, needs-you list, rail column.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const NAV = `document.querySelector('nav[aria-label=Projects]')`
const STRIP = `document.querySelector('[role=tablist][aria-label=Terminals]')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const ALT = 1, CTRL = 2, SHIFT = 8

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-rail-')))
const A = path.join(BASE, 'alpha')
const B = path.join(BASE, 'beta')
fs.mkdirSync(A)
fs.mkdirSync(B)
fs.writeFileSync(path.join(A, 'x.txt'), 'hello\n')
let hasGit = true
try {
  execFileSync('git', ['init', '-q'], { cwd: A, stdio: 'pipe' })
} catch {
  hasGit = false
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const chord = async (k, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.workspace.sidebar','1'); localStorage.setItem('ccm.workspace.sideView','projects'); localStorage.removeItem('ccm.workspace.railOrder')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')

  await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true })`)
  await evaluate(`${W}.open('shell', ${JSON.stringify(B)}, undefined, { tab: true })`)
  await evaluate(`${W}.open('shell', ${JSON.stringify(A)}, undefined, { tab: true })`)
  await waitFor(`${W}.panes.length === 3 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'three shells')
  await sleep(1500)

  // --- Rail ---
  const names = await evaluate(`[...${NAV}.querySelectorAll('[data-rail-name]')].map((n) => n.textContent.trim())`)
  check('rail shows one cluster per project', JSON.stringify(names) === JSON.stringify(['alpha', 'beta']), JSON.stringify(names))
  check('rail rows: one per tab without agents', (await evaluate(`${NAV}.querySelectorAll('[data-side-row]').length`)) === 3)
  check('every tab is bound to its project', await evaluate(`${W}.tabs.every((t) => !!t.project)`))

  // --- Spaces: strip scoped to the active tab's project ---
  const drawn = () => evaluate(`${STRIP}.querySelectorAll('[role=tab]').length`)
  check('strip shows only the active project tabs (alpha: 2)', (await drawn()) === 2, String(await drawn()))
  check('project capsule names the active project', (await evaluate(`document.querySelector('[data-strip-project]')?.textContent.trim()`))?.startsWith('alpha'))
  await evaluate(`${W}.activateTab(${W}.tabs[0].key)`)
  await sleep(200)
  await chord('2', 'Digit2', 50, CTRL | ALT)
  check('Ctrl+Alt+2 = second tab of this project', await evaluate(`${W}.activeTab.key === ${W}.tabs[2].key`))
  await chord('Tab', 'Tab', 9, CTRL)
  check('Ctrl+Tab cycles inside the project', await evaluate(`${W}.activeTab.key === ${W}.tabs[0].key`))
  await evaluate(`${W}.activate(${W}.panes[1].key)`)
  await sleep(300)
  check('switching to beta draws its single tab', (await drawn()) === 1, String(await drawn()))
  await shot('rail-01-spaces')

  // --- Mission Control ---
  await evaluate(`${W}.activate(${W}.panes[0].key)`)
  await evaluate(`${W}.openFile(${JSON.stringify(path.join(A, 'x.txt'))}, undefined, { cwd: ${JSON.stringify(A)}, split: { key: ${W}.panes[0].key, dir: 'row' } })`)
  await evaluate(`${W}.activate(${W}.panes[0].key)`)
  await sleep(500)
  await evaluate(`document.querySelector('.xterm-helper-textarea')?.focus()`)
  await chord('O', 'KeyO', 79, CTRL | SHIFT)
  await waitFor(`!!document.querySelector('[data-mission][role=dialog]')`, 5000, 'mission open')
  check('Ctrl+Shift+O opens Mission Control', true)
  await sleep(700)
  const current = await evaluate(`${W}.activeTab.key`)
  check('grid: 3 tab cards in 2 project sections', await evaluate(`document.querySelectorAll('[data-mission-card]').length === 3 && document.querySelectorAll('[data-mission-section]').length === 2`))
  const tiles = await evaluate(`document.querySelectorAll('[data-mission-card="${current}"] [data-mission-tile]').length`)
  check('current card draws both panes of its tab', tiles === 2, String(tiles))
  check('a file pane tile shows its path instead of output', /x\.txt/.test(await evaluate(`document.querySelector('[data-mission-view]')?.textContent ?? ''`)))
  check('focus starts on the current tab card', (await evaluate(`document.activeElement?.dataset.missionCard`)) === current)
  await shot('rail-02-mission')
  await key('ArrowRight', 'ArrowRight', 39)
  const moved = await evaluate(`document.activeElement?.dataset.missionCard`)
  check('arrow keys move between cards', !!moved && moved !== current, String(moved))
  await key('ArrowLeft', 'ArrowLeft', 37)
  check('arrow back returns to the current card', (await evaluate(`document.activeElement?.dataset.missionCard`)) === current)
  const target = await evaluate(`(() => { const t = [...document.querySelectorAll('[data-mission-card="${current}"] [data-mission-tile]')].find((n) => n.dataset.missionTile !== ${W}.activeKey); t?.focus(); return t?.dataset.missionTile })()`)
  await key('Enter', 'Enter', 13)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed')
  check('Enter on a pane tile jumps to that pane', !!target && (await evaluate(`${W}.activeKey`)) === target, String(target))
  await evaluate(`document.querySelector('[data-strip-project]').focus()`)
  await evaluate(`document.querySelector('[data-strip-project]').click()`)
  await waitFor(`!!document.querySelector('[data-mission]')`, 5000, 'mission reopened')
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed by Esc')
  check('Esc returns focus to the opener', await evaluate(`document.activeElement?.hasAttribute('data-strip-project')`))

  // --- Exited pane that never printed: the host refuses a missing cwd, so its xterm stays empty ---
  const GONE = path.join(BASE, 'gone')
  const dead = JSON.stringify(await evaluate(`${W}.open('shell', ${JSON.stringify(GONE)}, undefined, { tab: true }).key`))
  await waitFor(`${W}.panes.find((p) => p.key === ${dead})?.state === 'error'`, 10000, 'spawn refused')
  await evaluate(`${W}.update(${dead}, { state: 'exited', exitCode: 0, error: undefined })`)
  await evaluate(`document.querySelector('[data-strip-project]').click()`)
  await waitFor(`!!document.querySelector('[data-mission-tile]')`, 5000, 'mission for exited pane')
  check(
    'exited pane tile shows the empty text and its state',
    await evaluate(`(() => { const w = document.querySelector('[data-mission-tile=' + JSON.stringify(${dead}) + ']'); return !!w?.querySelector('[data-mission-empty]') && /Ended/.test(w.textContent) })()`),
  )
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed')
  await evaluate(`${W}.remove(${dead}); ${W}.forget(${JSON.stringify(GONE)})`)
  await sleep(300)

  // --- Needs-you list --- (focus elsewhere: the focused pane clears its own attention)
  await evaluate(`${W}.activate(${W}.panes[0].key)`)
  await sleep(200)
  await evaluate(`${W}.update(${W}.panes[1].key, { attention: 'waiting' }); ${W}.update(${W}.panes[2].key, { attention: 'waiting' })`)
  await sleep(300)
  await evaluate(`document.querySelector('[data-attention-chip]').click()`)
  await waitFor(`!!document.querySelector('[data-attention-popover] [role=listbox]')`, 5000, 'needs list')
  check('chip opens a list of who needs you', (await evaluate(`document.querySelectorAll('[data-attention-popover] [role=option]').length`)) === 2, await evaluate(`JSON.stringify({ opts: [...document.querySelectorAll('[data-attention-popover] [role=option]')].map((o) => o.textContent.trim().slice(0, 60)), panes: ${W}.panes.map((p) => [p.kind, p.preset, p.state, p.attention]) })`))
  await shot('rail-03-needs')
  const second = await evaluate(`(() => { const o = document.querySelectorAll('[data-attention-popover] [role=option]')[1]; return o.id })()`)
  await key('ArrowDown', 'ArrowDown', 40)
  await key('Enter', 'Enter', 13)
  await sleep(300)
  check('↓ + Enter focuses the second entry', !!second && !(await evaluate(`!!document.querySelector('[data-attention-popover]')`)) && [await evaluate(`${W}.panes[1].key`), await evaluate(`${W}.panes[2].key`)].includes(await evaluate(`${W}.activeKey`)))

  // --- Waiting sessions from the collector (agent rows), oldest first ---
  const T = `${S}.get('terminals')`
  await evaluate(`(() => {
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
    for (const p of ${W}.panes) ${W}.update(p.key, { attention: undefined })
    ${T}.upsert({ id: 'e2e-newer', title: 'e2e-newer', status: 'waiting', statusSince: ago(1) })
    ${T}.upsert({ id: 'e2e-older', title: 'e2e-older', status: 'waiting', statusSince: ago(10) })
    ${W}.update(${W}.panes[1].key, { preset: 'claude', terminalId: 'e2e-newer' })
    ${W}.update(${W}.panes[2].key, { preset: 'claude', terminalId: 'e2e-older' })
  })()`)
  await sleep(400)
  await evaluate(`document.querySelector('[data-attention-chip]').click()`)
  await waitFor(`!!document.querySelector('[data-attention-popover] [role=listbox]')`, 5000, 'needs list (sessions)')
  const order = await evaluate(`[...document.querySelectorAll('[data-attention-popover] [role=option]')].map((o) => o.textContent.match(/e2e-(?:older|newer)/)?.[0] ?? '')`)
  check('waiting sessions are listed oldest first', JSON.stringify(order) === JSON.stringify(['e2e-older', 'e2e-newer']), JSON.stringify(order))
  await key('Escape', 'Escape', 27)
  await evaluate(`(() => {
    for (const p of ${W}.panes.slice(1, 3)) ${W}.update(p.key, { preset: 'shell', terminalId: undefined })
    ${T}.remove('e2e-newer')
    ${T}.remove('e2e-older')
  })()`)
  await sleep(300)

  // --- Alt+↓ reorders projects from the header ---
  await evaluate(`${NAV}.querySelector('[data-side-head]').focus()`)
  await chord('ArrowDown', 'ArrowDown', 40, ALT)
  const reordered = await evaluate(`[...${NAV}.querySelectorAll('[data-rail-name]')].map((n) => n.textContent.trim())`)
  check('Alt+↓ on a header moves the project down', JSON.stringify(reordered) === JSON.stringify(['beta', 'alpha']), JSON.stringify(reordered))
  check('order is remembered', (await evaluate(`localStorage.getItem('ccm.workspace.railOrder')`))?.includes('beta'))

  // --- v43 context menus: project header, keyboard, Copy path, row Split right, Close project, empty space ---
  const MENU = `document.querySelector('[data-context-menu]')`
  const headOf = (name) => `[...${NAV}.querySelectorAll('[data-side-head]')].find((h) => h.querySelector('[data-rail-name]')?.textContent.trim() === ${JSON.stringify(name)})`
  const rightClick = (sel) => evaluate(`(() => { const el = ${sel}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10, button: 2 })); return true })()`)
  const item = (id) => `document.querySelector('[data-context-menu] [data-menu-id=${JSON.stringify(id)}], [data-context-submenu] [data-menu-id=${JSON.stringify(id)}]')`
  await rightClick(headOf('alpha'))
  await waitFor(`!!${MENU}`, 5000, 'project menu')
  check('right-click on a project header opens its menu', await evaluate(`['new', 'copy-path', 'move-up', 'close-project'].every((id) => !!document.querySelector('[data-context-menu] [data-menu-id="' + id + '"]'))`))
  await shot('rail-05-project-menu')
  await cmd('Page.bringToFront')
  await evaluate(`${item('copy-path')}.click()`)
  await waitFor(`!${MENU}`, 3000, 'menu closed after pick')
  const copied = await evaluate(`navigator.clipboard.readText().catch((e) => 'ERR ' + e.message)`)
  const status = await evaluate(`${NAV}.querySelector('[data-rail-status]')?.textContent.trim() ?? ''`)
  check('Copy path copies the project folder and says so', status === 'Path copied' && (copied === A || String(copied).startsWith('ERR')), `${status} / ${copied}`)

  await evaluate(`${headOf('alpha')}.focus()`)
  await chord('F10', 'F10', 121, SHIFT)
  await waitFor(`!!${MENU}`, 5000, 'menu from keyboard')
  check('Shift+F10 on a header opens the menu with focus on its first item', await evaluate(`document.activeElement?.getAttribute('role') === 'menuitem' && !!document.activeElement.closest('[data-context-menu]')`))
  await key('Escape', 'Escape', 27)
  await waitFor(`!${MENU}`, 3000, 'menu closed by Esc')
  check('Esc closes the menu and returns focus to the header', await evaluate(`document.activeElement === ${headOf('alpha')}`))

  const firstRow = `${NAV}.querySelector('[data-group] [data-side-row]')`
  const rowTab = await evaluate(`(() => { const k = ${firstRow}.dataset.sidePane; return ${W}.tabs.findIndex((t) => JSON.stringify(t.root).includes(k)) })()`)
  const leavesBefore = await evaluate(`JSON.stringify(${W}.tabs[${rowTab}].root).split('"pane"').length - 1`)
  await rightClick(`${firstRow}.closest('[data-rail-row]')`)
  await waitFor(`!!${MENU}`, 5000, 'row menu')
  check('right-click on a row opens the row menu', await evaluate(`['focus', 'split-right', 'copy-cwd', 'close'].every((id) => !!document.querySelector('[data-context-menu] [data-menu-id="' + id + '"]'))`))
  await evaluate(`${item('split-right')}.click()`)
  await waitFor(`!!document.querySelector('[data-context-submenu]')`, 3000, 'split submenu')
  await evaluate(`${item('split:row:shell')}.click()`)
  await waitFor(`JSON.stringify(${W}.tabs[${rowTab}].root).split('"pane"').length - 1 === ${leavesBefore + 1}`, 5000, 'split right')
  check('row menu Split right ▸ Shell adds a pane to that tab', true)
  await shot('rail-06-row-split')

  const G = path.join(BASE, 'gamma')
  fs.mkdirSync(G)
  await evaluate(`${W}.open('shell', ${JSON.stringify(G)}, undefined, { tab: true })`)
  await waitFor(`!!${headOf('gamma')}`, 10000, 'gamma cluster')
  await rightClick(headOf('gamma'))
  await waitFor(`!!${MENU}`, 5000, 'gamma menu')
  await evaluate(`${item('close-project')}.click()`)
  await sleep(500)
  if (await evaluate(`!!${W}.pendingClose`)) await evaluate(`${W}.confirmClose()`)
  await waitFor(`!${W}.tabs.some((t) => (t.project ?? '').endsWith('gamma'))`, 5000, 'gamma closed')
  check('Close project from the menu closes its tabs', true)
  await evaluate(`${W}.forget(${JSON.stringify(G)})`)
  await sleep(300)

  await evaluate(`(() => { const l = ${NAV}.querySelector('.overflow-y-auto'); const r = l.getBoundingClientRect(); l.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 4 })) })()`)
  await waitFor(`!!${MENU}`, 5000, 'empty menu')
  check('right-click on empty rail space offers Collapse all', await evaluate(`!!${item('collapse-all')}`))
  await key('Escape', 'Escape', 27)
  await waitFor(`!${MENU}`, 3000, 'empty menu closed')

  // --- Open Project (native folder picker, not driven here): pinned above the scrolling project list ---
  check('Open Project is pinned at the top of the rail', await evaluate(`(() => { const b = ${NAV}.querySelector('[data-rail-open-project]'); return !!b && /Open Project/.test(b.textContent) && ${NAV}.firstElementChild === b && !b.closest('.overflow-y-auto') })()`))

  // --- Mouse wheel scrolls the tab strip sideways ---
  const wheel = await evaluate(`(() => {
    const strip = document.querySelector('[role=tablist][aria-label="Tabs"]') ?? document.querySelector('[data-tab-row] [role=tablist]')
    strip.style.maxWidth = '90px'
    strip.scrollLeft = 0
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
    const moved = strip.scrollLeft
    strip.style.maxWidth = ''
    strip.scrollLeft = 0
    return moved
  })()`)
  check('vertical wheel scrolls the tab strip', wheel > 0, String(wheel))

  // --- Collapsed rail column ---
  await evaluate(`document.querySelector('button[aria-label="Show or hide projects"]').click()`)
  await sleep(600)
  check('closed sidebar leaves a 52px avatar column', await evaluate(`Math.round(document.querySelector('[data-tour="ws-sidebar"]').getBoundingClientRect().width) === 52 && document.querySelectorAll('[data-rail-avatar]').length === 2`))
  await evaluate(`document.querySelector('[data-rail-avatar]').click()`)
  await waitFor(`!!document.querySelector('[data-rail-flyout] [data-side-row]')`, 5000, 'flyout')
  check('avatar opens that project in a flyout', true)
  await rightClick(`document.querySelector('[data-rail-flyout] [data-rail-row]')`)
  await waitFor(`!!${MENU}`, 5000, 'flyout row menu')
  check('row menu opens inside the flyout and keeps it open', await evaluate(`!!document.querySelector('[data-rail-flyout]') && !!${item('split-right')}`))
  await key('Escape', 'Escape', 27)
  await waitFor(`!${MENU}`, 3000, 'flyout menu closed')
  check('column has the Open project icon, the flyout does not', await evaluate(`!!document.querySelector('[data-rail-column] > [data-rail-open-project][aria-label]') && !document.querySelector('[data-rail-flyout] [data-rail-open-project]')`))
  await shot('rail-04-column')
  await evaluate(`document.querySelector('button[aria-label="Show or hide projects"]').click()`)
  await sleep(400)
  if (!hasGit) check('git available for the repo fixture', false, 'git not found')
}

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('rail-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-rail.txt'), results.join('\n'))
    try {
      fs.rmSync(BASE, { recursive: true, force: true })
    } catch {}
    process.exit(0)
  }
})()
