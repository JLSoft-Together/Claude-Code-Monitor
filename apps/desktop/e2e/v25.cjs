// v25: browser-style "+", workspace guide + shortcut tips + help menu, colour themes, map context menu → workspace,
// attachments tray on a real Claude pane (drop / paste / remove; no prompt is ever sent, no Enter is pressed).
// Inserting an image puts it on the system clipboard (that is how the agent receives it).
const fs = require('node:fs')
const path = require('node:path')
const { launch, OUT, REPO } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const A = `${S}.get('attachments')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2
const IMAGE = path.join(REPO, 'scripts', 'assets', 'ccm-256.png')
const PKG = path.join(REPO, 'package.json')

async function main() {
  const app = await launch({ exe: process.argv[2] })
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const click = async (sel) => {
    const r = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r && [r.left + r.width / 2, r.top + r.height / 2] })()`)
    if (!r) throw new Error('no element ' + sel)
    for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 })
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.removeItem('ccm.tourWorkspaceDone'); localStorage.removeItem('ccm.tips'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')

    // Workspace guide opens by itself the first time the view is shown.
    await evaluate(`${S}.get('ui').view = 'workspace'`)
    const tour = await waitFor(`${S}.get('ui').tourOpen === 'workspace' && document.querySelector('#tour-title')?.textContent`, 5000, 'workspace tour').catch(() => null)
    check('workspace guide auto-opens once', !!tour, tour)
    await sleep(400); await shot('v25-01-tour')
    await key('ArrowRight', 'ArrowRight', 39); await sleep(500); await shot('v25-02-tour-new')
    await key('Escape', 'Escape', 27)
    check('guide marked done', await evaluate(`localStorage.getItem('ccm.tourWorkspaceDone') === '1' && !${S}.get('ui').tourOpen`))

    // Browser-style "+": right after the last tab.
    await evaluate(`${W}.open('shell', ${JSON.stringify(REPO)})`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
    const plusGap = `(() => { const b = document.querySelector('[data-tour="ws-new"][aria-haspopup=dialog]'); const strip = document.querySelector('[role=tablist][aria-label=Terminals]'); return b && strip ? Math.round(b.getBoundingClientRect().left - strip.getBoundingClientRect().right) : null })()`
    const gap1 = await evaluate(plusGap)
    check('+ follows the only tab', gap1 !== null && gap1 >= 0 && gap1 <= 12, gap1)

    // Three mouse opens of the New-tab menu → tip naming the chord.
    for (let i = 0; i < 3; i++) {
      await click('[data-tour="ws-new"][aria-haspopup=dialog]')
      await sleep(300)
      await key('Escape', 'Escape', 27)
      await sleep(200)
    }
    const tip = await waitFor(`document.querySelector('[data-shortcut-tip]')?.textContent`, 3000, 'tip').catch(() => null)
    check('tip after 3 mouse uses names Ctrl+Shift+T', !!tip && tip.includes('Ctrl+Shift+T'), tip)
    await shot('v25-03-tip')
    await evaluate(`[...document.querySelectorAll('[data-shortcut-tip] button')].find(b => /show tips|hiện mẹo/i.test(b.textContent)).click()`)
    await sleep(400)
    check('"Don\'t show tips" persists', await evaluate(`JSON.parse(localStorage.getItem('ccm.tips')).off === true && !document.querySelector('[data-shortcut-tip]')`))

    // Help menu → shortcuts list.
    await click('[data-tour="ws-help"]')
    await waitFor(`!!document.querySelector('[data-menu=shortcuts]')`, 3000, 'help menu')
    check('help menu: shortcuts + guide', await evaluate(`!!document.querySelector('[data-menu=tour]')`))
    await evaluate(`document.querySelector('[data-menu=shortcuts]').click()`)
    check('shortcuts dialog opens from the workspace', !!(await waitFor(`${S}.get('ui').shortcutsOpen`, 3000, 'shortcuts').catch(() => false)))
    await sleep(300); await shot('v25-04-shortcuts')
    await evaluate(`${S}.get('ui').shortcutsOpen = false`)

    // Themes: data-theme + mode class + tokens from themes.css; one screenshot each.
    for (const [id, mode] of [['dracula', 'dark'], ['monokai', 'dark'], ['solarized-light', 'light'], ['github-dark', 'dark'], ['xcode-light', 'light'], ['material', 'dark'], ['one-dark', 'dark'], ['github-light', 'light'], ['islands-light', 'light'], ['islands-dark', 'dark']]) {
      await evaluate(`${S}.get('settings').setTheme('${id}')`)
      await sleep(350)
      const st = await evaluate(`(() => { const r = document.documentElement; return { theme: r.dataset.theme, dark: r.classList.contains('dark'), surface: getComputedStyle(r).getPropertyValue('--ccm-surface').trim(), soft: getComputedStyle(r).getPropertyValue('--ccm-accent-soft').trim() } })()`)
      check(`theme ${id}`, st.theme === id && st.dark === (mode === 'dark') && /^#/.test(st.surface) && st.soft.startsWith('color-mix'), JSON.stringify(st))
      await shot(`v25-05-theme-${id}`)
    }
    await evaluate(`${S}.get('ui').settingsOpen = true`)
    await sleep(500); await shot('v25-06-settings-themes')
    await evaluate(`${S}.get('ui').settingsOpen = false`)
    await evaluate(`${S}.get('settings').setTheme('dark')`)
    check('Apple dark has no data-theme', await evaluate(`!document.documentElement.dataset.theme && document.documentElement.classList.contains('dark')`))

    // Claude pane: linked session for the map menu, then the attachments tray.
    await evaluate(`${W}.open('claude', ${JSON.stringify(REPO)}, undefined, { tab: true })`)
    await waitFor(`${W}.panes[1]?.state === 'running'`, 20000, 'claude running')
    const claudeKey = await evaluate(`${W}.panes[1].key`)
    const terminalId = await waitFor(`${W}.panes[1]?.terminalId`, 60000, 'claude linked').catch(() => null)
    check('claude pane linked', !!terminalId, String(terminalId))

    if (terminalId) {
      await evaluate(`${S}.get('ui').view = 'monitor'`)
      await sleep(1500)
      // Zoom to this session: fitting the whole map with other big live sessions leaves its node tiny / under the toolbar.
      await evaluate(`${S}.get('ui').focusTerminal(${JSON.stringify(terminalId)})`)
      await sleep(1200)
      const agentId = await evaluate(`${S}.get('agents').mainOf(${JSON.stringify(terminalId)})?.id`)
      // Right-click a point that really hits the node (not the floating map toolbar over it).
      const node = await waitFor(`(() => {
        const n = document.querySelector('.vue-flow__node[data-id="${agentId}"]'); if (!n) return null
        const r = n.getBoundingClientRect(); if (!r.width || r.right > innerWidth || r.bottom > innerHeight) return null
        for (let fy = 0.1; fy < 1; fy += 0.1) for (let fx = 0.1; fx < 1; fx += 0.1) {
          const x = r.left + r.width * fx, y = r.top + r.height * fy
          if (n.contains(document.elementFromPoint(x, y))) return [x, y]
        }
        return null
      })()`, 15000, 'map node').catch(() => null)
      check('main agent node on the map', !!node)
      if (node) {
        for (const type of ['mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: node[0], y: node[1], button: 'right', clickCount: 1 })
        const menu = await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id=show-in-workspace]')`, 3000, 'agent menu').catch(() => false)
        check('right-click main agent → "Show in workspace"', menu)
        await sleep(250); await shot('v25-07-agent-menu')
        if (menu) {
          await evaluate(`document.querySelector('[data-context-menu] [data-menu-id=show-in-workspace]').click()`)
          await sleep(500)
          check('menu lands on the pane in Workspace', await evaluate(`${S}.get('ui').view === 'workspace' && ${W}.activeKey === ${JSON.stringify(claudeKey)}`))
        }
      }
    }

    await evaluate(`${S}.get('ui').view = 'workspace'; ${W}.activate(${JSON.stringify(claudeKey)})`)
    // Claude's input box (two rules) must be on screen before anything is inserted.
    await sleep(6000)
    const pane = `[data-pane="${claudeKey}"]`
    const center = await evaluate(`(() => { const r = document.querySelector('${pane} .xterm')?.getBoundingClientRect(); return r && [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] })()`)
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cmd('Input.dispatchDragEvent', { type, x: center[0], y: center[1], data: { items: [], files: [PKG, IMAGE], dragOperationsMask: 1 } })
      await sleep(120)
    }
    const dropped = await waitFor(`(() => { const l = ${A}.list(${JSON.stringify(claudeKey)}); return l.length === 2 && l.every(a => a.state === 'inserted' && a.seen) && l.map(a => a.token).join(' ') })()`, 20000, 'dropped items in prompt').catch(() => null)
    check('drop: @package.json + [Image #N] in the prompt, named', !!dropped && dropped.includes('@package.json') && /\[Image #\d+\]/.test(dropped), String(dropped ?? (await evaluate(`JSON.stringify(${A}.list(${JSON.stringify(claudeKey)}))`))))
    check('panel shows file names', await evaluate(`(() => { const t = document.querySelector('${pane} [data-attachments]')?.textContent ?? ''; return t.includes('package.json') && t.includes('ccm-256.png') })()`))
    await shot('v25-08-attach-drop')

    // A row dragged out of the Explorer carries its path under the app type, no OS file.
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cmd('Input.dispatchDragEvent', { type, x: center[0], y: center[1], data: { items: [{ mimeType: 'application/x-ccm-path', data: path.join(REPO, 'CLAUDE.md') }], dragOperationsMask: 1 } })
      await sleep(120)
    }
    const fromTree = await waitFor(`${A}.list(${JSON.stringify(claudeKey)}).find(a => a.token === '@CLAUDE.md' && a.state === 'inserted' && a.seen)?.token`, 15000, 'explorer drop').catch(() => null)
    check('Explorer row drop → @CLAUDE.md in the prompt', fromTree === '@CLAUDE.md', String(fromTree ?? (await evaluate(`JSON.stringify(${A}.list(${JSON.stringify(claudeKey)}).map(a => [a.token, a.state, a.seen]))`))))
    await shot('v25-08b-attach-explorer')

    // Paste image from the panel (clipboard holds the image just inserted).
    await evaluate(`document.querySelector('${pane} [data-attach=paste]').click()`)
    const pasted = await waitFor(`${A}.list(${JSON.stringify(claudeKey)}).find(a => a.source === 'paste' && a.token)?.token`, 15000, 'pasted').catch(() => null)
    check('panel "Paste image" → new [Image #N]', !!pasted, String(pasted))

    // Ctrl+V in the terminal: the agent's paste key, the row is named "Clipboard image".
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    await key('v', 'KeyV', 86, CTRL)
    const viaKey = await waitFor(`${A}.list(${JSON.stringify(claudeKey)}).filter(a => a.source === 'paste' && a.token).length >= 2`, 15000, 'ctrl+v').catch(() => false)
    check('Ctrl+V of an image reaches Claude ([Image #N] bound)', viaKey)
    await shot('v25-09-attach-paste')

    // Backspace in the terminal (cursor after the last "[Image #N] "): the row leaves the tray.
    const before = await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length`)
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    await key('Backspace', 'Backspace', 8, 0)
    await key('Backspace', 'Backspace', 8, 0)
    const afterBs = await waitFor(`${A}.live(${JSON.stringify(claudeKey)}).length === ${before - 1}`, 5000, 'backspace removed').catch(() => false)
    check('Backspace in the terminal removes the tray row', afterBs, String(await evaluate(`JSON.stringify(${A}.live(${JSON.stringify(claudeKey)}).map((a) => a.token))`)))

    // Remove from the panel in any order: always the FIRST row (not at the end of the prompt).
    let removed = 0
    for (let i = 0; i < 6; i++) {
      const first = await evaluate(`${A}.list(${JSON.stringify(claudeKey)}).find(a => a.state === 'inserted')?.id ?? null`)
      if (!first) break
      await evaluate(`document.querySelector('${pane} [data-attachments] li[data-attachment=inserted] [data-attach-remove]').click()`)
      const gone = await waitFor(`!${A}.list(${JSON.stringify(claudeKey)}).some(a => a.id === ${JSON.stringify(first)})`, 6000, 'removed').catch(() => false)
      if (!gone) break
      removed++
    }
    check('remove from panel works in any order (first row each time)', removed >= 3 && (await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length === 0`)), `removed ${removed}`)
    await shot('v25-10-attach-removed')

    // Erasing a mention one Backspace at a time leaves no ghost rows.
    await evaluate(`${A}.add(${JSON.stringify(claudeKey)}, [{ kind: 'file', name: 'CLAUDE.md', source: 'pick', path: ${JSON.stringify(path.join(REPO, 'CLAUDE.md'))} }], true)`)
    await waitFor(`${A}.live(${JSON.stringify(claudeKey)}).some(a => a.token === '@CLAUDE.md' && a.seen)`, 10000, 'mention in').catch(() => {})
    await evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    for (let i = 0; i < '@CLAUDE.md '.length; i++) {
      await key('Backspace', 'Backspace', 8, 0)
      await sleep(60)
    }
    await sleep(600)
    check('no ghost rows while a mention is erased', await evaluate(`${A}.live(${JSON.stringify(claudeKey)}).length === 0`), String(await evaluate(`JSON.stringify(${A}.live(${JSON.stringify(claudeKey)}).map((a) => a.token))`)))

    const focusTerm = () => evaluate(`document.querySelector('${pane} .xterm-helper-textarea').focus()`)
    await focusTerm()
    await cmd('Input.insertText', { text: '!' })
    await sleep(500)
    await cmd('Input.insertText', { text: 'echo nl-a' })
    await sleep(300)
    await key('Enter', 'Enter', 13, 8)
    await sleep(500)
    await cmd('Input.insertText', { text: 'echo nl-b' })
    await sleep(300)
    await key('Enter', 'Enter', 13, 2)
    await sleep(500)
    await cmd('Input.insertText', { text: 'echo nl-c' })
    await sleep(800)
    await key('O', 'KeyO', 79, 2 | 8)
    await waitFor(`!!document.querySelector('[data-mission][role=dialog]')`, 5000, 'mission').catch(() => {})
    await sleep(700)
    const box = await evaluate(`document.querySelector('[data-mission-tile="${claudeKey}"] [data-mission-output]')?.textContent ?? ''`)
    await key('Escape', 'Escape', 27)
    await sleep(500)
    const lines = box.split('\n').map((l) => l.trim()).filter(Boolean)
    const at = lines.findIndex((l) => /^!\s*echo nl-a$/.test(l))
    check('Shift+Enter and Ctrl+Enter add lines to the prompt, nothing is sent', at >= 0 && lines[at + 1] === 'echo nl-b' && lines[at + 2] === 'echo nl-c' && !lines.some((l) => /^nl-a$/.test(l)), lines.slice(-6).join(' | '))
    await focusTerm()
    await key('c', 'KeyC', 67, 2)
    await sleep(600)
    await key('Backspace', 'Backspace', 8, 0)
    await sleep(300)
  } catch (err) {
    check('script error', false, String(err?.message ?? err))
    await app.shot('v25-error').catch(() => {})
  } finally {
    app.stop()
  }
  fs.writeFileSync(path.join(OUT, 'v25.txt'), results.join('\n') + '\n')
}
main()
