// E2E for workspace P6: sidebar groups, attention latch + jump, close confirmation.
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const T = `${S}.get('terminals')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2, SHIFT = 8

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
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')

    await evaluate(`${W}.open('shell', ${JSON.stringify(REPO)})`)
    await evaluate(`${W}.open('shell')`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(REPO)})`)
    await waitFor(`${W}.panes.length === 3 && ${W}.panes.every(p => p.state === 'running')`, 25000, 'three shells')
    await sleep(800)
    const groups = await evaluate(`[...document.querySelectorAll('nav[aria-label=Projects] section h3')].map(h => h.textContent.trim())`)
    check('sidebar groups by project', JSON.stringify(groups) === JSON.stringify([require('node:path').basename(REPO), require('node:path').basename(require('node:os').homedir())]), JSON.stringify(groups))
    const rows = await evaluate(`document.querySelectorAll('nav[aria-label=Projects] [data-side-row]').length`)
    check('sidebar lists every pane', rows === 3, String(rows))
    await evaluate(`[...document.querySelectorAll('nav[aria-label=Projects] [data-side-row]')][1].click()`)
    check('sidebar row focuses its pane', await evaluate(`${W}.activeKey === ${W}.panes[2].key`))

    // Fake a linked agent on pane 0 and drive its status while pane 2 is active.
    await evaluate(`(() => { ${T}.upsert({ id: 'fake-1', title: 'fix login bug', status: 'working', cwd: ${JSON.stringify(REPO)} }); ${W}.update(${W}.panes[0].key, { terminalId: 'fake-1' }) })()`)
    await sleep(300)
    await evaluate(`${T}.patch({ id: 'fake-1', status: 'waiting' })`)
    await sleep(400)
    check('waiting latches attention on unseen pane', await evaluate(`${W}.panes[0].attention === 'waiting'`))
    const chip = await evaluate(`[...document.querySelectorAll('button')].find(b => /need/.test(b.textContent))?.textContent.trim() ?? null`)
    check('attention chip shows count', chip === '1 needs you', String(chip))
    await evaluate(`${T}.patch({ id: 'fake-1', status: 'working' })`)
    await sleep(300)
    check('answered elsewhere clears waiting', await evaluate(`!${W}.panes[0].attention`))
    await evaluate(`${T}.patch({ id: 'fake-1', status: 'idle' })`)
    await sleep(300)
    check('working → idle latches done', await evaluate(`${W}.panes[0].attention === 'done'`))
    await evaluate(`${T}.patch({ id: 'fake-1', status: 'waiting' })`)
    await sleep(300)
    await shot('p6-01-attention')
    await evaluate(`document.querySelectorAll('.xterm-helper-textarea')[2].focus()`)
    await chord('A', 'KeyA', 65, CTRL | SHIFT)
    await sleep(300)
    check('Ctrl+Shift+A jumps to waiting pane and clears it', await evaluate(`${W}.activeKey === ${W}.panes[0].key && !${W}.panes[0].attention`))

    // Close: linked agent pane asks first; plain shell closes at once.
    await evaluate(`[...document.querySelectorAll('section[aria-label] button')].filter(b => b.offsetParent && b.title === 'Close terminal')[0].click()`)
    await sleep(400)
    const dialog = await evaluate(`document.querySelector('[role=alertdialog][aria-modal]')?.innerText.replace(/\\s+/g, ' ') ?? null`)
    check('busy pane asks before closing, names the agent', !!dialog && /fix login bug/.test(dialog), String(dialog))
    await shot('p6-02-confirm')
    await chord('Escape', 'Escape', 27, 0)
    check('Esc cancels, pane kept', await evaluate(`${W}.panes.length === 3 && !${W}.pendingClose`))
    await evaluate(`${W}.activate(${W}.panes[1].key)`)
    await sleep(300)
    await chord('W', 'KeyW', 87, CTRL | SHIFT)
    await sleep(500)
    check('idle shell closes without asking', await evaluate(`${W}.panes.length === 2 && !${W}.pendingClose`))
    await evaluate(`${W}.activate(${W}.panes[0].key)`)
    await sleep(200)
    await chord('W', 'KeyW', 87, CTRL | SHIFT)
    await sleep(300)
    await evaluate(`document.querySelector('[role=alertdialog] .ccm-btn-danger').click()`)
    await sleep(800)
    check('confirm closes busy pane', await evaluate(`${W}.panes.length === 1`))
  } catch (e) {
    check('run', false, e.message)
    await shot('p6-99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results-p6.txt'), results.join('\n'))
    process.exit(0)
  }
})()
