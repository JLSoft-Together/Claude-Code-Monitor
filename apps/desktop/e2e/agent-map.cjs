// v47 Agent Map interactions against a static fake Claude root (scripts/demo-fixture.mjs, no ticks): node context menu
// copies, text drag-select + Ctrl+C, keyboard navigation / details / fold, find, canvas menu "Copy map as text",
// and the session card's menu (Copy ▸ Session ID, Shift+F10, Ctrl+C).
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { launch, OUT, REPO } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const AG = `${S}.get('agents')`
const TM = `${S}.get('terminals')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2
const ROOT = path.join(OUT, 'agent-map-root')

function startFixture() {
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'demo-fixture.mjs'), `--root=${ROOT}`, '--sessions=2', '--subagents=3', '--tick=600000'], { stdio: ['ignore', 'pipe', 'inherit'] })
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('fixture root')) resolve(child) })
    child.on('exit', (code) => reject(new Error('fixture exited ' + code)))
  })
}

async function main() {
  const fixture = await startFixture()
  const app = await launch({ exe: process.argv[2], env: { CLAUDE_CONFIG_DIR: ROOT, CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0' } })
  const { evaluate, waitFor, shot, sleep, cmd } = app
  const mouse = async (type, x, y, button = 'left', buttons = 0) => cmd('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 })
  const press = async (key, code, vk, mods = 0, commands) => {
    await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods, commands })
    if (key.length === 1 && !mods) await cmd('Input.dispatchKeyEvent', { type: 'char', key, text: key, unmodifiedText: key })
    await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods })
    await sleep(200)
  }
  const clip = () => evaluate(`navigator.clipboard.readText().catch(() => null)`)
  const resetClip = () => evaluate(`navigator.clipboard.writeText('sentinel').catch(() => {})`)
  const focused = `document.activeElement?.closest('.vue-flow__node')?.dataset.id ?? null`
  // A point inside `sel` that really hits it (not the floating toolbar / find bar over the map).
  const hitPoint = (sel) => `(() => {
    const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return null
    const r = n.getBoundingClientRect(); if (!r.width || r.right > innerWidth || r.bottom > innerHeight) return null
    for (let fy = 0.1; fy < 1; fy += 0.1) for (let fx = 0.1; fx < 1; fx += 0.1) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy
      if (n.contains(document.elementFromPoint(x, y))) return [x, y]
    }
    return null
  })()`
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.mapView','map'); localStorage.removeItem('ccm.mapLayout.v53')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${UI}`, 30000, 'reloaded')
    await evaluate(`${UI}.setView('monitor'); ${UI}.openSessionTab(null); ${S}.get('settings').hideFinished = false`)
    await cmd('Page.bringToFront')

    const terminalId = await waitFor(`(() => { const t = ${TM}.list.find((x) => x.claudeSessionId && (${AG}.byTerminal[x.id]?.length ?? 0) >= 4); return t?.id })()`, 30000, 'fixture session with subagents').catch(() => null)
    check('fixture session with 3 subagents on the map', !!terminalId, String(terminalId))
    if (!terminalId) return
    const mainId = await evaluate(`${AG}.mainOf(${JSON.stringify(terminalId)})?.id`)
    const sessionId = await evaluate(`${TM}.byId[${JSON.stringify(terminalId)}].claudeSessionId`)
    await evaluate(`${UI}.focusTerminal(${JSON.stringify(terminalId)})`)
    await sleep(1200)
    const nodeSel = `.vue-flow__node[data-id="${mainId}"] [data-agent-node]`

    // 1. Right-click → Copy ▸ Session ID.
    const pt = await waitFor(hitPoint(nodeSel), 15000, 'main node on screen').catch(() => null)
    check('main agent node hit-testable', !!pt)
    if (pt) {
      await resetClip()
      await mouse('mousePressed', pt[0], pt[1], 'right', 2)
      await mouse('mouseReleased', pt[0], pt[1], 'right')
      const menu = await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id=copy-summary]')`, 3000, 'node menu').catch(() => false)
      check('right-click node → map menu with Copy summary', menu)
      check('menu keeps workspace entry or copy group', await evaluate(`!!document.querySelector('[data-context-menu] [data-menu-id=copy]')`))
      await shot('agent-map-01-menu')
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id=copy]').click()`)
      await waitFor(`!!document.querySelector('[data-context-submenu] [data-menu-id=copy-session-id]')`, 3000, 'copy submenu').catch(() => {})
      await shot('agent-map-02-copy-submenu')
      await evaluate(`document.querySelector('[data-context-submenu] [data-menu-id=copy-session-id]')?.click()`)
      const got = await waitFor(`navigator.clipboard.readText().then((t) => t === ${JSON.stringify(sessionId)} ? t : null).catch(() => null)`, 3000, 'clipboard').catch(() => null)
      check('Copy ▸ Session ID puts the session id on the clipboard', got === sessionId, String(got))
      const notice = await waitFor(`document.querySelector('[data-map-notice]')?.textContent?.trim()`, 2000, 'notice').catch(() => null)
      check('"Copied" status line shows', !!notice && /copied/i.test(notice), String(notice))
      check('menu closed after pick', await evaluate(`!document.querySelector('[data-context-menu]')`))
    }

    // 2. Drag across the title selects text (no node drag, no details), Ctrl+C copies the selection.
    await evaluate(`${UI}.selectAgent(null)`)
    const title = await evaluate(`(() => { const s = document.querySelector('${nodeSel} .select-text'); const r = s?.getBoundingClientRect(); return s && r.width ? { x0: r.left + 2, x1: r.right - 2, y: r.top + r.height / 2, text: s.textContent.trim() } : null })()`)
    if (title) {
      const before = await evaluate(`JSON.stringify(document.querySelector('.vue-flow__node[data-id="${mainId}"]').style.transform)`)
      await resetClip()
      await mouse('mousePressed', title.x0, title.y, 'left', 1)
      for (let i = 1; i <= 6; i++) await mouse('mouseMoved', title.x0 + ((title.x1 - title.x0) * i) / 6, title.y, 'left', 1)
      await mouse('mouseReleased', title.x1, title.y, 'left', 0)
      await sleep(250)
      const sel = await evaluate(`getSelection().toString()`)
      check('drag on the title selects its text', !!sel && title.text.includes(sel.trim()) && sel.trim().length >= 3, JSON.stringify(sel))
      check('text drag does not move the node', (await evaluate(`JSON.stringify(document.querySelector('.vue-flow__node[data-id="${mainId}"]').style.transform)`)) === before)
      check('text drag does not open details', await evaluate(`${UI}.selectedAgentId === null`))
      await press('c', 'KeyC', 67, CTRL, ['copy'])
      const copied = await clip()
      check('Ctrl+C copies the selected text', !!copied && copied.trim() === sel.trim(), JSON.stringify(copied))
      await evaluate(`getSelection().removeAllRanges()`)
    } else check('title span found', false)

    // 3. Keyboard: focus ring, arrows, Enter = details, Ctrl+C = summary, Space = fold.
    await evaluate(`document.querySelector('${nodeSel}').focus()`)
    await press('ArrowDown', 'ArrowDown', 40)
    const down = await evaluate(focused)
    check('↓ moves to the first subagent', !!down && down !== mainId && (await evaluate(`${AG}.byId[${JSON.stringify(down)}]?.terminalId === ${JSON.stringify(terminalId)}`)), String(down))
    check('focused node shows a focus ring', await evaluate(`getComputedStyle(document.activeElement).outlineStyle !== 'none'`))
    await shot('agent-map-03-keyboard')
    await press('ArrowLeft', 'ArrowLeft', 37)
    check('← goes back to the parent', (await evaluate(focused)) === mainId)
    await press('Enter', 'Enter', 13)
    check('Enter opens details of the focused agent', await evaluate(`${UI}.selectedAgentId === ${JSON.stringify(mainId)} && !!document.querySelector('[data-agent-details]')`))
    await press('Enter', 'Enter', 13)
    check('Enter again closes them', await evaluate(`${UI}.selectedAgentId === null`))
    await resetClip()
    await press('c', 'KeyC', 67, CTRL, ['copy'])
    const summary = await clip()
    check('Ctrl+C on a node copies its summary', !!summary && summary.includes(`Agent ID: ${mainId}`) && summary.includes(`Session ID: ${sessionId}`), JSON.stringify(summary?.slice(0, 120)))
    const count = `document.querySelectorAll('.vue-flow__node').length`
    const n0 = await evaluate(count)
    await press(' ', 'Space', 32)
    await sleep(400)
    const n1 = await evaluate(count)
    check('Space folds the subtree (+N badge)', n1 < n0 && (await evaluate(`!!document.querySelector('.vue-flow__node[data-id="${mainId}"] [data-fold][aria-expanded=false]')`)), `${n0} → ${n1}`)
    await shot('agent-map-04-folded')
    await press(' ', 'Space', 32)
    await sleep(400)
    check('Space again unfolds it', (await evaluate(count)) === n0)

    // 4. Find: Ctrl+F, type a subagent id, Enter cycles, Esc returns focus to the hit.
    const target = down
    await evaluate(`document.querySelector('${nodeSel}').focus()`)
    await press('f', 'KeyF', 70, CTRL)
    const findOpen = await waitFor(`document.activeElement?.closest('[data-map-find]') ? true : false`, 3000, 'find focused').catch(() => false)
    check('Ctrl+F opens find with focus in the field', findOpen)
    if (findOpen && target) {
      await cmd('Input.insertText', { text: target })
      await sleep(600)
      const st = await evaluate(`({ count: document.querySelector('[data-map-find] [aria-live]')?.textContent.trim(), hit: !!document.querySelector('.vue-flow__node[data-id="${target}"] .ring-accent') })`)
      check('find highlights the match and counts it', st.hit && /1 of 1/.test(st.count), JSON.stringify(st))
      await shot('agent-map-05-find')
      await press('Escape', 'Escape', 27)
      await sleep(300)
      check('Esc closes find and focuses the match', (await evaluate(`!document.querySelector('[data-map-find]')`)) && (await evaluate(focused)) === target)
    }
    await press('/', 'Slash', 191)
    check('"/" on the map opens find too', await waitFor(`!!document.querySelector('[data-map-find]')`, 2000, 'slash find').then(() => true).catch(() => false))
    await press('Escape', 'Escape', 27)

    // 5. Canvas background menu → Copy map as text.
    const empty = await evaluate(`(() => {
      const r = document.querySelector('.vue-flow').getBoundingClientRect()
      for (let fy = 0.95; fy > 0.2; fy -= 0.05) for (let fx = 0.95; fx > 0.05; fx -= 0.05) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy
        if (document.elementFromPoint(x, y)?.classList.contains('vue-flow__pane')) return [x, y]
      }
      return null
    })()`)
    check('empty canvas point found', !!empty)
    if (empty) {
      await resetClip()
      await mouse('mousePressed', empty[0], empty[1], 'right', 2)
      await mouse('mouseReleased', empty[0], empty[1], 'right')
      const canvasMenu = await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id=copy-map]')`, 3000, 'canvas menu').catch(() => false)
      check('right-click on the background → canvas menu', canvasMenu)
      await shot('agent-map-06-canvas-menu')
      if (canvasMenu) {
        await evaluate(`document.querySelector('[data-context-menu] [data-menu-id=copy-map]').click()`)
        const title = await evaluate(`${TM}.byId[${JSON.stringify(terminalId)}].alias || ${TM}.byId[${JSON.stringify(terminalId)}].title`)
        const text = await waitFor(`navigator.clipboard.readText().then((t) => t !== 'sentinel' ? t : null).catch(() => null)`, 3000, 'map text').catch(() => null)
        check('Copy map as text: session header + indented agents', !!text && text.includes(title) && /\n  - .+\[/.test(text), JSON.stringify(text?.slice(0, 160)))
      }
    }

    // 6. Session card (dashboard): same menu without the map-only entries, Copy ▸ Session ID, Shift+F10, Ctrl+C.
    await press('Escape', 'Escape', 27)
    await evaluate(`${UI}.panels.sessions.open = true`)
    const cardSel = `[data-session-card="${terminalId}"]`
    await waitFor(`!!document.querySelector('${cardSel}')`, 5000, 'session card').catch(() => {})
    await evaluate(`document.querySelector('${cardSel}')?.scrollIntoView({ block: 'center' })`)
    await sleep(500)
    const cardPt = await waitFor(hitPoint(cardSel), 5000, 'card on screen').catch(() => null)
    check('session card hit-testable', !!cardPt)
    if (cardPt) {
      await resetClip()
      await mouse('mousePressed', cardPt[0], cardPt[1], 'right', 2)
      await mouse('mouseReleased', cardPt[0], cardPt[1], 'right')
      const cardMenu = await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id=copy-summary]')`, 3000, 'card menu').catch(() => false)
      check('right-click card → menu with Copy summary + Show details', cardMenu && (await evaluate(`!!document.querySelector('[data-context-menu] [data-menu-id=details]')`)))
      check('card menu has no map-only entries', !(await evaluate(`!!document.querySelector('[data-context-menu] [data-menu-id=zoom-node], [data-context-menu] [data-menu-id=show-session]')`)))
      await shot('agent-map-07-card-menu')
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id=copy]')?.click()`)
      await waitFor(`!!document.querySelector('[data-context-submenu] [data-menu-id=copy-session-id]')`, 3000, 'card copy submenu').catch(() => {})
      await evaluate(`document.querySelector('[data-context-submenu] [data-menu-id=copy-session-id]')?.click()`)
      const cardClip = await waitFor(`navigator.clipboard.readText().then((t) => t !== 'sentinel' ? t : null).catch(() => null)`, 3000, 'card clip').catch(() => null)
      check('card Copy ▸ Session ID → clipboard', cardClip === sessionId, JSON.stringify(cardClip))
      check('card shows the "copied" status', await waitFor(`/copied/i.test(document.querySelector('${cardSel} [data-card-notice]')?.textContent ?? '')`, 2000, 'card notice').then(() => true).catch(() => false))
      await shot('agent-map-08-card-copied')

      await evaluate(`document.querySelector('${cardSel}').focus()`)
      await press('F10', 'F10', 121, 8)
      const keyMenu = await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id=copy-summary]')`, 3000, 'card key menu').catch(() => false)
      check('Shift+F10 on a focused card opens its menu', keyMenu)
      await press('Escape', 'Escape', 27)
      check('Esc closes it and refocuses the card', (await evaluate(`!document.querySelector('[data-context-menu]')`)) && (await evaluate(`document.activeElement?.matches('${cardSel}')`)))
      await resetClip()
      await press('c', 'KeyC', 67, CTRL, ['copy'])
      const cardSummary = await clip()
      check('Ctrl+C on a focused card copies the summary', !!cardSummary && cardSummary.includes(`Agent ID: ${mainId}`) && cardSummary.includes(`Session ID: ${sessionId}`), JSON.stringify(cardSummary?.slice(0, 120)))
    }
  } catch (err) {
    check('script error', false, String(err?.message ?? err))
    await app.shot('agent-map-error').catch(() => {})
  } finally {
    app.stop()
    try { execFileSync('taskkill', ['/T', '/F', '/PID', String(fixture.pid)], { stdio: 'ignore' }) } catch { fixture.kill() }
  }
  fs.writeFileSync(path.join(OUT, 'agent-map.txt'), results.join('\n') + '\n')
}
main()
