// `claude` / `codex` typed by hand in a shell pane: the pane header, icon and rail show that agent while it runs, then a shell again.
// Starts real `claude` and `codex` in this repo; no prompt is sent.
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const CTRL = 2

;(async () => {
  const app = await launch()
  const { evaluate, waitFor, shot, type, key, sleep } = app
  const head = () => evaluate(`(() => { const p = ${W}.panes[0]; const h = document.querySelector('[data-pane="' + p.key + '"] [data-pane-head]'); return { text: h?.innerText ?? '', icon: h?.querySelector('svg')?.getAttribute('class') ?? '' } })()`)
  const enter = async (text) => {
    await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    await type(text)
    await sleep(300)
    await key('Enter', 'Enter', 13)
  }
  // Agent shown within `ms` of pressing Enter; null when it never was.
  const until = async (expr, ms) => {
    const at = Date.now()
    return (await waitFor(expr, ms, expr).then(() => true, () => false)) ? Date.now() - at : null
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${require('../package.json').version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
    await app.cmd('Page.reload')
    await waitFor(`!!${S}.get('ui') && !${S}.get('ui').tourOpen`, 30000, 'reloaded')
    await evaluate(`${S}.get('ui').setView('workspace')`)
    await evaluate(`${W}.open('shell', ${JSON.stringify(REPO)}, undefined, { tab: true })`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')
    await sleep(2500)
    await app.cmd('Page.bringToFront')
    const before = await head()
    check('shell pane starts as Shell', /Shell/.test(before.text) && /text-agent-shell/.test(before.icon), JSON.stringify(before))

    await enter('claude')
    const claudeMs = await until(`${W}.panes[0]?.agent === 'claude'`, 45000)
    check('claude typed in the shell is detected', claudeMs !== null, `${claudeMs} ms`)
    await sleep(300)
    const asClaude = await head()
    check('header shows Claude Code and its icon', /Claude Code/.test(asClaude.text) && /text-agent-claude/.test(asClaude.icon), JSON.stringify(asClaude))
    await shot('shell-agent-01-claude')

    await enter('/exit')
    const backMs = await until(`!${W}.panes[0]?.agent`, 30000)
    check('back to Shell after /exit', backMs !== null, `${backMs} ms`)
    await sleep(300)
    const after = await head()
    check('header shows Shell again', /Shell/.test(after.text) && /text-agent-shell/.test(after.icon), JSON.stringify(after))

    // Codex 0.162 writes its rollout (what the monitor sees) only with the first prompt, and none is sent here.
    await sleep(1500)
    await enter('codex')
    const codexMs = await until(`${W}.panes[0]?.agent === 'codex'`, 20000)
    console.log(`INFO codex before its first prompt: ${codexMs === null ? 'not seen yet (no rollout)' : `shown after ${codexMs} ms`}`)
    await shot('shell-agent-02-codex')
    if (codexMs !== null) {
      const asCodex = await head()
      check('header shows Codex and its icon', /Codex/.test(asCodex.text) && /text-agent-codex/.test(asCodex.icon), JSON.stringify(asCodex))
    }
    await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`)
    await key('c', 'KeyC', 67, CTRL)
    await sleep(400)
    await key('c', 'KeyC', 67, CTRL)
    if (codexMs !== null) check('back to Shell after quitting codex', (await until(`!${W}.panes[0]?.agent`, 30000)) !== null)
  } catch (e) {
    check('run', false, e.message)
    await shot('shell-agent-99-error').catch(() => {})
  } finally {
    await evaluate(`(() => { const w = ${W}; [...w.panes].forEach((p) => w.remove(p.key)) })()`).catch(() => {})
    await sleep(1500)
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results.txt'), results.join('\n'))
    process.exit(0)
  }
})()
