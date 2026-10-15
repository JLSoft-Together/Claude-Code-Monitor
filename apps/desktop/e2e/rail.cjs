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

  await evaluate(`${W}.open('shell', ${JSON.stringify(A)})`)
  await evaluate(`${W}.open('shell', ${JSON.stringify(B)})`)
  await evaluate(`${W}.open('shell', ${JSON.stringify(A)})`)
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
  check('shelf: 3 spaces in 2 projects', await evaluate(`document.querySelectorAll('[data-mission-space]').length === 3 && document.querySelectorAll('[data-mission] [role=group] > h3').length === 2`))
  const wins = await evaluate(`document.querySelectorAll('[data-mission-window]').length`)
  check('spread shows the panes of the current tab', wins === 2, String(wins))
  check('a pane that never printed shows the empty text', await evaluate(`!!document.querySelector('[data-mission-empty]')`))
  check('focus starts on the focused pane', await evaluate(`document.activeElement?.dataset.missionWindow === ${W}.activeKey`))
  await shot('rail-02-mission')
  await key('ArrowRight', 'ArrowRight', 39)
  const target = await evaluate(`document.activeElement?.dataset.missionWindow`)
  await key('Enter', 'Enter', 13)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed')
  check('Enter on a window jumps to that pane', (await evaluate(`${W}.activeKey`)) === target)
  await evaluate(`document.querySelector('[data-strip-project]').focus()`)
  await evaluate(`document.querySelector('[data-strip-project]').click()`)
  await waitFor(`!!document.querySelector('[data-mission]')`, 5000, 'mission reopened')
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed by Esc')
  check('Esc returns focus to the opener', await evaluate(`document.activeElement?.hasAttribute('data-strip-project')`))

  // --- Exited pane that never printed: the host refuses a missing cwd, so its xterm stays empty ---
  const GONE = path.join(BASE, 'gone')
  const dead = JSON.stringify(await evaluate(`${W}.open('shell', ${JSON.stringify(GONE)}).key`))
  await waitFor(`${W}.panes.find((p) => p.key === ${dead})?.state === 'error'`, 10000, 'spawn refused')
  await evaluate(`${W}.update(${dead}, { state: 'exited', exitCode: 0, error: undefined })`)
  await evaluate(`document.querySelector('[data-strip-project]').click()`)
  await waitFor(`!!document.querySelector('[data-mission-window]')`, 5000, 'mission for exited pane')
  check(
    'exited pane window shows the empty text and its state',
    await evaluate(`(() => { const w = document.querySelector('[data-mission-window=' + JSON.stringify(${dead}) + ']'); return !!w?.querySelector('[data-mission-empty]') && /Ended/.test(w.textContent) })()`),
  )
  await key('Escape', 'Escape', 27)
  await waitFor(`!document.querySelector('[data-mission]')`, 5000, 'mission closed')
  await evaluate(`${W}.remove(${dead}); ${W}.forget(${JSON.stringify(GONE)})`)
  await sleep(300)

  // --- Needs-you list ---
  await evaluate(`${W}.update(${W}.panes[1].key, { attention: 'waiting' }); ${W}.update(${W}.panes[2].key, { attention: 'waiting' })`)
  await sleep(300)
  await evaluate(`document.querySelector('[data-attention-chip]').click()`)
  await waitFor(`!!document.querySelector('[data-attention-popover] [role=listbox]')`, 5000, 'needs list')
  check('chip opens a list of who needs you', (await evaluate(`document.querySelectorAll('[data-attention-popover] [role=option]').length`)) === 2)
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
  const order = await evaluate(`[...document.querySelectorAll('[data-attention-popover] [role=option]')].map((o) => o.textContent.match(/e2e-\\w+/)?.[0] ?? '')`)
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
