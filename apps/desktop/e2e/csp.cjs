// CSP: header present, no violations across every view, terminals still work.
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

;(async () => {
  const app = await launch(process.argv[2] ? { exe: process.argv[2] } : {})
  const { evaluate, waitFor, shot, sleep, cmd } = app
  try {
    await cmd('Page.enable')
    await cmd('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber))`,
    })
    await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${S}.get('ui') && Array.isArray(window.__csp)`, 30000, 'reloaded')
    const header = await evaluate(`fetch('/').then(r => r.headers.get('content-security-policy'))`)
    check('CSP header on the page', !!header && header.includes("script-src 'self' 'sha256-"), String(header).slice(0, 120))
    for (const view of ['monitor', 'usage', 'history', 'workspace']) {
      await evaluate(`${S}.get('ui').setView('${view}')`)
      await sleep(2500)
    }
    await evaluate(`${W}.open('shell')`)
    await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell under CSP')
    check('terminal works under CSP', true)
    await evaluate(`${S}.get('ui').paletteOpen = true`)
    await sleep(600)
    await evaluate(`${S}.get('ui').paletteOpen = false; ${S}.get('ui').settingsOpen = true`)
    await sleep(800)
    await evaluate(`${S}.get('ui').settingsOpen = false; ${S}.get('ui').tourOpen = 'monitor'`)
    await sleep(1200)
    const violations = await evaluate(`window.__csp`)
    check('no CSP violations across views', violations.length === 0, JSON.stringify(violations).slice(0, 400))
    const injected = await evaluate(`(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.body.appendChild(s); return new Promise(r => setTimeout(() => r(window.__pwned === 1), 200)) })()`)
    check('injected inline script is blocked', injected === false)
    await shot('p7-csp')
  } catch (e) {
    check('run', false, e.message)
    await shot('p7-99-error').catch(() => {})
  } finally {
    app.stop()
    require('node:fs').writeFileSync(require('node:path').join(OUT, 'results-p7.txt'), results.join('\n'))
    process.exit(0)
  }
})()
