// E2E for workspace P5: restore previous workspace after an app restart, resume arg, reopen guard for live sessions.
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const FAKE = '0f0f0f0f-1234-4abc-8def-0123456789ab'

async function boot(app) {
  await app.waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
}

;(async () => {
  let app = await launch()
  try {
    await boot(app)
    await app.evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
    await app.cmd('Page.reload')
    await app.sleep(1500)
    await boot(app)
    await app.evaluate(`${S}.get('ui').setView('workspace')`)
    await app.waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    check('no restore offer on first run', !(await app.evaluate(`!!${W}.last`)))

    // Tab 1: shell split in two; tab 2: claude resuming a session id that does not exist.
    await app.evaluate(`${W}.open('shell', ${JSON.stringify(REPO)})`)
    await app.waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell')
    await app.evaluate(`${W}.split(${W}.panes[0].key, 'row')`)
    await app.waitFor(`${W}.panes[1]?.state === 'running'`, 20000, 'split')
    await app.evaluate(`${W}.open('claude', ${JSON.stringify(REPO)}, ${JSON.stringify(FAKE)})`)
    await app.waitFor(`${W}.panes[2]?.state === 'running'`, 20000, 'claude resume pane')
    await app.sleep(7000)
    const out = await app.evaluate(`(async () => {
      const id = ${W}.panes[2].sessionId; const ep = await window.ccmDesktop.ptyEndpoint()
      return await new Promise((res) => { const ws = new WebSocket(ep.url,[ep.protocol]); ws.binaryType='arraybuffer'; let t='';
        ws.onopen=()=>ws.send(JSON.stringify({t:'attach',id})); ws.onmessage=(e)=>{ if (typeof e.data!=='string') t+=new TextDecoder().decode(e.data) };
        setTimeout(()=>{ws.close();res(t)},1200) })
    })()`)
    const clean = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    check('resume id reaches claude', /No conversation found|0f0f0f0f-1234/i.test(clean), clean.replace(/\s+/g, ' ').slice(-160))
    const snap = await app.evaluate(`JSON.parse(localStorage.getItem('ccm.workspace.last'))`)
    check('snapshot saved without content', snap?.tabs?.length === 2 && snap.panes.length === 3 && snap.panes[2].resume === FAKE && !JSON.stringify(snap).includes('PS '), JSON.stringify(snap).slice(0, 200))
    await app.shot('p5-01-before-quit')

    // Reopen guard: a live external session asks first and never opens on Cancel.
    await app.evaluate(`${S}.get('ui').setView('monitor')`)
    await app.sleep(1500)
    const reopenBtn = await app.evaluate(`!![...document.querySelectorAll('button')].find(b => b.title === 'Open in GolAIm')`)
    check('reopen button on external session', reopenBtn)
    if (reopenBtn) {
      const panesBefore = await app.evaluate(`${W}.panes.length`)
      await app.evaluate(`[...document.querySelectorAll('button')].find(b => b.title === 'Open in GolAIm').click()`)
      await app.sleep(300)
      const warn = await app.evaluate(`document.querySelector('[role=alertdialog]')?.innerText ?? ''`)
      check('live session shows two-writer warning', /still running/i.test(warn), warn.slice(0, 80))
      await app.shot('p5-02-reopen-warning')
      await app.evaluate(`[...document.querySelectorAll('[role=alertdialog] button')].find(b => b.textContent.trim() === 'Cancel').click()`)
      await app.sleep(300)
      check('cancel opens nothing', (await app.evaluate(`${W}.panes.length`)) === panesBefore && (await app.evaluate(`${S}.get('ui').view`)) === 'monitor')
    }

    // Restart the app with the same profile.
    app.stop()
    await app.sleep(3000)
    app = await launch({ keep: true })
    await boot(app)
    await app.evaluate(`${S}.get('ui').setView('workspace')`)
    await app.waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker after restart')
    const offer = await app.evaluate(`document.querySelector('section[aria-label="Restore previous workspace"]')?.innerText.replace(/\\s+/g,' ') ?? null`)
    check('restore offer after restart', !!offer && /2 tabs/.test(offer) && /1 conversation/.test(offer), String(offer))
    await app.shot('p5-03-offer')
    await app.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Restore').click()`)
    await app.waitFor(`${W}.panes.length === 3 && ${W}.panes.every(p => p.state === 'running')`, 25000, 'restored panes')
    const shape = await app.evaluate(`JSON.stringify({tabs: ${W}.tabs.map(t => 'pane' in t.root ? 'leaf' : t.root.dir), resume: ${W}.panes.map(p => p.resume ?? null), cwd: ${W}.panes.map(p => p.cwd)})`)
    check('layout and resume ids restored', shape.includes('"tabs":["row","leaf"]') && shape.includes(FAKE), shape.slice(0, 200))
    check('offer consumed', !(await app.evaluate(`!!${W}.last`)))
    await app.sleep(1500)
    await app.shot('p5-04-restored')
  } catch (e) {
    check('run', false, e.message)
    await app.shot('p5-99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results-p5.txt'), results.join('\n'))
    process.exit(0)
  }
})()
