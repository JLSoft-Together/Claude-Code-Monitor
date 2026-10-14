// Split button opens a menu: the new pane runs the picked agent (or a browser) in the same folder.
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.workspace.preset','shell')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`[...document.querySelectorAll('[data-launch-row]')].at(-1).click()`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')

    await evaluate(`document.querySelector('[aria-haspopup=menu]').click()`)
    await waitFor(`!!document.querySelector('[role=menu]')`, 5000, 'menu')
    const items = await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].map((b) => b.textContent.trim())`)
    check('menu lists Claude, Codex, Shell, Browser', items.length === 4 && /Claude/.test(items[0]) && /Codex/.test(items[1]) && /Shell/.test(items[2]) && /Browser/.test(items[3]), JSON.stringify(items))
    check('current agent is focused', await evaluate(`/Shell/.test(document.activeElement?.textContent ?? '')`))
    await key('ArrowDown', 'ArrowDown', 40)
    await key('ArrowDown', 'ArrowDown', 40)
    check('arrows wrap through the items', await evaluate(`/Claude/.test(document.activeElement?.textContent ?? '')`))
    await shot('split-menu')
    await key('Escape', 'Escape', 27)
    check('Esc closes the menu', await evaluate(`!document.querySelector('[role=menu]')`))

    await evaluate(`document.querySelector('[aria-haspopup=menu]').click()`)
    await waitFor(`!!document.querySelector('[role=menu]')`, 5000, 'menu again')
    await evaluate(`[...document.querySelectorAll('[role=menu] [role=menuitem]')].find((b) => /Codex/.test(b.textContent)).click()`)
    await waitFor(`${W}.panes.length === 2`, 5000, 'second pane')
    const pair = await evaluate(`JSON.stringify(${W}.panes.map((p) => [p.preset, p.cwd]))`)
    const [a, b] = JSON.parse(pair)
    check('picked agent opens next to it, same folder', b[0] === 'codex' && a[1] === b[1], pair)
    check('still one tab', await evaluate(`${W}.tabs.length === 1`))
    await sleep(800)
    await shot('split-done')
  } catch (e) {
    check('run', false, e.message)
    await shot('split-99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results-split.txt'), results.join('\n'))
    process.exit(0)
  }
})()
