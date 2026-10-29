// E2E for workspace P1+P2: launch picker, shell pane typing, pane↔session link for claude.
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

;(async () => {
  const app = await launch()
  const { evaluate, waitFor, shot, type, key, sleep } = app
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    const ep = await evaluate(`window.ccmDesktop.ptyEndpoint().then(e => !!e && e.url.startsWith('ws://127.0.0.1:'))`)
    check('pty endpoint handed out', ep)
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
    await app.cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui') && !${S}.get('ui').tourOpen`, 30000, 'reloaded')
    await sleep(1500)

    // Open the workspace tab through the header button.
    const clicked = await evaluate(`(() => { const b=[...document.querySelectorAll('header button, header [role=tab]')].find(x=>/Workspace|Terminal/.test(x.textContent)); b?.click(); return !!b })()`)
    check('workspace tab present', clicked)
    await waitFor(`!!document.querySelector('[data-launch-row]') && ${S}.get('ui').view === 'workspace'`, 10000, 'launch picker')
    await shot('01-empty')

    // Shell preset + home folder from the inline picker.
    await evaluate(`[...document.querySelectorAll('[role=radio]')].find(r=>r.textContent.includes('Shell')).click()`)
    await evaluate(`[...document.querySelectorAll('[data-launch-row]')].at(-1).click()`)
    await waitFor(`${S}.get('workspace').panes[0]?.state === 'running'`, 20000, 'shell running')
    check('shell pane running', true)
    await sleep(2500)
    await app.cmd('Page.bringToFront')
    console.log('dbg', await evaluate(`JSON.stringify({vis: document.visibilityState, focus: document.hasFocus(), view: ${S}.get('ui').view, n: document.querySelectorAll('.xterm-helper-textarea').length})`))
    await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    console.log('dbg active', await evaluate(`document.activeElement?.className`))
    await type('echo ("CCM" + "E2E" + (40+2))')
    await key('Enter', 'Enter', 13)
    await sleep(1500)
    await shot('02-shell')

    // Read output via a second attach (replays the ring buffer).
    const out = await evaluate(`(async () => {
      const ws0 = ${S}.get('workspace'); const id = ws0.panes[0].sessionId
      const ep = await window.ccmDesktop.ptyEndpoint()
      return await new Promise((res) => {
        const ws = new WebSocket(ep.url, [ep.protocol]); ws.binaryType='arraybuffer'; let text=''
        ws.onopen = () => ws.send(JSON.stringify({t:'attach', id}))
        ws.onmessage = (e) => { if (typeof e.data !== 'string') text += new TextDecoder().decode(e.data) }
        setTimeout(() => { ws.close(); res(text) }, 1200)
      })
    })()`)
    check('typed command output', /CCME2E42/.test(out), (out.match(/CCME2E42/g) || []).length + ' hits')
    // That attach stole the pane socket; reconnect from UI.
    await sleep(500)
    const st = await evaluate(`${S}.get('workspace').panes[0].state`)
    check('pane notices stolen socket', st === 'error', st)
    await evaluate(`[...document.querySelectorAll('button')].find(b=>/Reconnect|Kết nối lại/.test(b.title))?.click()`)
    await waitFor(`${S}.get('workspace').panes[0]?.state === 'running'`, 10000, 'reconnected')
    check('reconnect', true)

    // Owners query: shell pid itself is a root → owned.
    const own = await evaluate(`(async () => {
      const p = ${S}.get('workspace').panes[0]; const ep = await window.ccmDesktop.ptyEndpoint()
      return await new Promise((res) => { const ws = new WebSocket(ep.url,[ep.protocol]); ws.onopen=()=>ws.send(JSON.stringify({t:'owners',pids:[p.pid, 4]})); ws.onmessage=(e)=>{ws.close();res({reply:JSON.parse(e.data), sid:p.sessionId, pid:p.pid})} })
    })()`)
    check('owners maps shell pid', own.reply.owners?.[String(own.pid)] === own.sid, JSON.stringify(own.reply))

    // Claude pane in the repo: should link to a monitor terminal.
    await evaluate(`${S}.get('workspace').open('claude', ${JSON.stringify(REPO)})`)
    await waitFor(`${S}.get('workspace').panes[1]?.state === 'running'`, 20000, 'claude pane running')
    check('claude pane running', true)
    await sleep(4000); await shot('03a-claude-start')
    const linked = await waitFor(`${S}.get('workspace').panes[1]?.terminalId`, 45000, 'claude linked').catch(() => null)
    check('claude pane linked to monitor terminal', !!linked, String(linked))
    await sleep(2000)
    await shot('03-claude')
    const header = await evaluate(`document.querySelectorAll('section header')[1]?.innerText`)
    check('pane header shows session status', !!header && /Working|Waiting|Idle|Ready|Đang|Chờ|Rảnh|Sẵn sàng/i.test(header), JSON.stringify(header))

    // Browser-style "+": icon only (v25), the accessible name says what it makes.
    const plus = await evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b=>/^(New tab|Tab mới|New terminal or tab|Terminal hoặc tab mới)$/.test(b.getAttribute('aria-label') ?? '')); return b ? b.textContent.trim() : null })()`)
    check('+ button is icon-only, named New tab', plus === '', plus)
    await evaluate(`[...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b=>/^(New tab|Tab mới|New terminal or tab|Terminal hoặc tab mới)$/.test(b.getAttribute('aria-label') ?? '')).click()`)
    await sleep(400)
    const pop = await evaluate(`!!document.querySelector('[role=dialog] [data-launch-row]')`)
    check('new-terminal popover opens', pop)
    await shot('04-popover')
    await key('Escape', 'Escape', 27)
    await sleep(200)
    check('popover closes on Esc', !(await evaluate(`!!document.querySelector('[role=dialog] [data-launch-row]')`)))

    // Close panes → processes killed.
    const pids = await evaluate(`${S}.get('workspace').panes.map(p=>p.pid)`)
    await evaluate(`(() => { const w=${S}.get('workspace'); [...w.panes].forEach(p=>w.remove(p.key)) })()`)
    await sleep(2500)
    const alive = pids.filter((pid) => { try { process.kill(pid, 0); return true } catch { return false } })
    check('closing panes kills processes', alive.length === 0, `pids ${pids} alive ${alive}`)
    await shot('05-closed')
  } catch (e) {
    check('run', false, e.message)
    await shot('99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results.txt'), results.join('\n'))
    process.exit(0)
  }
})()
