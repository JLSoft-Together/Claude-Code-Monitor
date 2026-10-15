// E2E for workspace P3: tabs, split, shortcuts, divider drag, reload keeps layout.
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const ALT = 1, CTRL = 2, SHIFT = 8

;(async () => {
  const app = await launch()
  const { evaluate, waitFor, shot, sleep, cmd } = app
  const chord = async (key, code, vk, mods) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(300)
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`[...document.querySelectorAll('[data-launch-row]')].at(-1).click()`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'pane 1 running')
    await sleep(1200)
    const firstXterm = await evaluate(`(window.__x1 = document.querySelector('.xterm'), !!window.__x1)`)

    await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    await chord('D', 'KeyD', 68, ALT | SHIFT)
    await waitFor(`${W}.panes.length === 2 && ${W}.panes[1].state === 'running'`, 20000, 'split pane running')
    const tabs1 = await evaluate(`${W}.tabs.length`)
    check('Alt+Shift+D splits inside the tab', tabs1 === 1, `tabs=${tabs1}`)
    const sameNode = await evaluate(`document.querySelector('.xterm') === window.__x1 && document.body.contains(window.__x1)`)
    check('first terminal not remounted by split', firstXterm && sameNode)
    const rects = await evaluate(`[...document.querySelectorAll('section[aria-label]')].filter(s=>s.offsetParent).map(s=>{const r=s.getBoundingClientRect();return [Math.round(r.x),Math.round(r.width)]})`)
    check('two panes side by side', rects.length === 2 && rects[1][0] > rects[0][0] + rects[0][1] - 2, JSON.stringify(rects))
    const focusNew = await evaluate(`${W}.activeKey === ${W}.panes[1].key`)
    check('new pane focused', focusNew)
    await sleep(800)
    await shot('p3-01-split')

    await chord('ArrowLeft', 'ArrowLeft', 37, ALT)
    check('Alt+Left moves focus', await evaluate(`${W}.activeKey === ${W}.panes[0].key`))
    const active = await evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea') && document.activeElement.closest('section') === document.querySelectorAll('section[aria-label]')[0]`)
    check('keyboard focus follows', active)

    // Divider drag: move to 30%.
    const div = await evaluate(`(() => { const d=document.querySelector('[role=separator][aria-valuemin="15"]'); const r=d.getBoundingClientRect(); const c=d.parentElement.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,cx:c.x,cw:c.width} })()`)
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: div.x, y: div.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 5; i++) await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: div.x - ((div.x - (div.cx + div.cw * 0.3)) * i) / 5, y: div.y, button: 'left', buttons: 1 })
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: div.cx + div.cw * 0.3, y: div.y, button: 'left', clickCount: 1 })
    await sleep(400)
    const ratio = await evaluate(`${W}.tabs[0].root.ratio`)
    check('divider drag sets ratio', Math.abs(ratio - 0.3) < 0.04, String(ratio))

    // Ctrl+Shift+T opens the picker; launch a second tab.
    await chord('T', 'KeyT', 84, CTRL | SHIFT)
    const pop = await evaluate(`!!document.querySelector('[role=dialog] [data-launch-row]')`)
    check('Ctrl+Shift+T opens new-terminal picker', pop)
    await evaluate(`[...document.querySelectorAll('[role=dialog] [data-launch-row]')].at(-1).click()`)
    await waitFor(`${W}.tabs.length === 2 && ${W}.panes[2]?.state === 'running'`, 20000, 'tab 2 running')
    check('second tab opened', true)
    await chord('Tab', 'Tab', 9, CTRL)
    check('Ctrl+Tab cycles to first tab', await evaluate(`${W}.activeTab.key === ${W}.tabs[0].key`))
    await chord('2', 'Digit2', 50, CTRL | ALT)
    check('Ctrl+Alt+2 jumps to tab 2', await evaluate(`${W}.activeTab.key === ${W}.tabs[1].key`))
    await shot('p3-02-tab2')

    // Reload: layout + sessions survive.
    const before = await evaluate(`JSON.stringify({tabs: ${W}.tabs.map(t=>t.root), ids: ${W}.panes.map(p=>p.sessionId)})`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('workspace') && ${W}.panes.length === 3 && ${W}.panes.every(p => p.state === 'running')`, 25000, 'restored after reload')
    const after = await evaluate(`JSON.stringify({tabs: ${W}.tabs.map(t=>t.root), ids: ${W}.panes.map(p=>p.sessionId)})`)
    check('reload keeps tabs, splits and sessions', before === after, after.slice(0, 160))
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`${W}.tabs.length === 2`, 5000)
    await evaluate(`${W}.activateTab(${W}.tabs[0].key)`)
    await sleep(1500)
    await shot('p3-03-reloaded')

    // Ctrl+Shift+W closes the focused pane; tab collapses to one.
    await evaluate(`document.querySelectorAll('.xterm-helper-textarea')[0].focus()`)
    const pid0 = await evaluate(`${W}.panes.find(p=>p.key===${W}.activeKey).pid`)
    await chord('W', 'KeyW', 87, CTRL | SHIFT)
    await sleep(2000)
    check('Ctrl+Shift+W closes pane', await evaluate(`${W}.panes.length === 2 && 'pane' in ${W}.tabs[0].root`))
    let dead = true
    try { process.kill(pid0, 0); dead = false } catch {}
    check('closed pane process gone', dead, `pid ${pid0}`)
    const typedOk = await evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea')`)
    check('focus lands on remaining pane', typedOk)
  } catch (e) {
    check('run', false, e.message)
    await shot('p3-99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results-p3.txt'), results.join('\n'))
    process.exit(0)
  }
})()
