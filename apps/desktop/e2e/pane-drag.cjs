// v48 pane drag: dock a pane by its header, swap with Ctrl, pop it out onto the tab row, drop a whole tab next to a pane.
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const rect = async (sel) => JSON.parse(await evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect() ?? null)`))
  const leavesOf = () => evaluate(`JSON.stringify((function walk(n) { return 'pane' in n ? [n.pane] : [...walk(n.a), ...walk(n.b)] })(${W}.activeTab.root))`).then(JSON.parse)
  const mouse = (type, x, y, modifiers = 0) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers })
  /** Presses at `from`, moves there in steps, optionally runs `during` before letting go. */
  async function drag(from, to, { modifiers = 0, during, release = true } = {}) {
    await mouse('mousePressed', from.x, from.y, modifiers)
    for (let i = 1; i <= 8; i++) {
      await mouse('mouseMoved', from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8, modifiers)
      await sleep(30)
    }
    if (during) await during()
    if (release) await mouse('mouseReleased', to.x, to.y, modifiers)
    await sleep(500)
  }
  // A point on the header's label, away from its buttons.
  const headOf = async (key) => {
    const r = await rect(`[data-pane="${key}"] header`)
    return { x: r.left + 30, y: r.top + r.height / 2 }
  }
  const nearEdge = async (key, edge) => {
    const r = await rect(`[data-pane="${key}"]`)
    const cy = r.top + r.height / 2
    const cx = r.left + r.width / 2
    return edge === 'left' ? { x: r.left + 15, y: cy } : edge === 'right' ? { x: r.right - 15, y: cy } : edge === 'top' ? { x: cx, y: r.top + 40 } : { x: cx, y: r.bottom - 15 }
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.tips', JSON.stringify({ off: true, learned: [], shown: {} }))`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`[...document.querySelectorAll('[data-launch-row]')].at(-1).click()`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
    await evaluate(`${W}.split(${W}.panes[0].key, 'row')`)
    await waitFor(`${W}.panes.length === 2 && ${W}.panes.every((p) => p.state === 'running')`, 20000, 'two shells')
    await sleep(600)
    const [a, b] = await leavesOf()
    const ids = await evaluate(`JSON.stringify(${W}.panes.map((p) => p.terminalId ?? p.ptyId ?? p.key))`)

    check('header is a drag grip with several panes', await evaluate(`!!document.querySelector('[data-pane="${b}"] header[data-pane-grip]')`))

    // Dock B on the left of A, checking the preview and ghost mid-drag.
    let mid = {}
    await drag(await headOf(b), await nearEdge(a, 'left'), {
      during: async () => {
        mid = JSON.parse(await evaluate(`JSON.stringify({ edge: document.querySelector('[data-drop-preview]')?.dataset.edge, ghost: document.querySelector('[data-drag-ghost]')?.textContent.trim() })`))
        await shot('pane-drag-1-preview')
      },
    })
    check('preview shows the left half while dragging', mid.edge === 'left', JSON.stringify(mid))
    check('ghost names the pane and the action', /Shell/.test(mid.ghost ?? '') && /left|trái/i.test(mid.ghost ?? ''), mid.ghost)
    check('dock left moves the pane', JSON.stringify(await leavesOf()) === JSON.stringify([b, a]))
    check('no preview after drop', await evaluate(`!document.querySelector('[data-drop-preview]') && !document.querySelector('[data-drag-ghost]')`))

    // Ctrl held: swap back.
    await drag(await headOf(a), await nearEdge(b, 'top'), { modifiers: 2 })
    check('Ctrl + drop swaps the panes', JSON.stringify(await leavesOf()) === JSON.stringify([a, b]))

    // Esc cancels.
    await drag(await headOf(b), await nearEdge(a, 'bottom'), { release: false })
    await key('Escape', 'Escape', 27)
    await mouse('mouseReleased', 0, 0)
    await sleep(300)
    check('Esc cancels the drag', JSON.stringify(await leavesOf()) === JSON.stringify([a, b]) && (await evaluate(`!document.querySelector('[data-drop-preview]')`)))

    // Keyboard: Alt+Shift+← with B focused swaps it with A.
    await evaluate(`${W}.activate('${b}')`)
    await key('ArrowLeft', 'ArrowLeft', 37, 1 | 8)
    await sleep(300)
    check('Alt+Shift+arrow swaps with the neighbour', JSON.stringify(await leavesOf()) === JSON.stringify([b, a]))

    // Onto the tab row: B gets a tab of its own.
    const row = await rect('[data-tab-row]')
    await drag(await headOf(b), { x: row.right - 60, y: row.top + row.height / 2 })
    check('drop on the tab row pops the pane out', await evaluate(`${W}.tabs.length === 2`))

    // Drag B's tab onto the right half of A: one tab again.
    await evaluate(`${W}.activate('${a}')`)
    await sleep(400)
    const tabKey = await evaluate(`${W}.tabOf('${b}').key`)
    const tr = await rect(`[data-tab="${tabKey}"]`)
    await drag({ x: tr.left + 20, y: tr.top + tr.height / 2 }, await nearEdge(a, 'right'), { during: () => shot('pane-drag-2-tab') })
    check('tab dropped on a pane merges into a split', (await evaluate(`${W}.tabs.length === 1`)) && JSON.stringify(await leavesOf()) === JSON.stringify([a, b]))
    check('terminals kept running (no restart)', await evaluate(`${W}.panes.length === 2 && ${W}.panes.every((p) => p.state === 'running') && JSON.stringify(${W}.panes.map((p) => p.terminalId ?? p.ptyId ?? p.key)) === ${JSON.stringify(ids)}`))
    await shot('pane-drag-3-done')

    // A new terminal in the same project joins this tab instead of opening one.
    await evaluate(`${W}.open('shell', ${W}.panes[0].cwd)`)
    await waitFor(`${W}.panes.length === 3`, 5000, 'third pane')
    await sleep(600)
    check('new terminal joins the project tab', await evaluate(`${W}.tabs.length === 1 && ${W}.activeTab.root.dir !== undefined && ${W}.activeKey === ${W}.panes[2].key`))
    check('three panes on screen', await evaluate(`[...document.querySelectorAll('[data-pane]')].filter((el) => el.getBoundingClientRect().width > 0).length === 3`))
    await shot('pane-drag-4-new-terminal')
  } catch (e) {
    check('run', false, e.message)
    await shot('pane-drag-99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results-pane-drag.txt'), results.join('\n'))
    process.exit(0)
  }
})()
