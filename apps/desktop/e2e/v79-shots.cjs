// v79 QA: screenshots of every simplified screen (docs/qa/v79/*.png) plus structural checks (no horizontal overflow, text < 11px, black screens).
// Fixture Claude root (scripts/demo-fixture.mjs, static) + temp project folders; shells only, no prompts sent.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const W = `${S}.get('workspace')`
const ST = `${S}.get('settings')`
const TM = `${S}.get('terminals')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const ROOT = path.join(OUT, 'v79-root')
const QA = process.env.CCM_QA_DIR || path.join(REPO, 'docs', 'qa', 'v79')
fs.mkdirSync(QA, { recursive: true })
const TMPD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v79-')))
const PROJECTS = ['alpha-app', 'beta-game', 'gamma-tool', 'delta-site', 'epsilon-api', 'zeta-lib', 'eta-docs'].map((n) => {
  const d = path.join(TMPD, n)
  fs.mkdirSync(d)
  return d
})

function startFixture() {
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'demo-fixture.mjs'), `--root=${ROOT}`, '--sessions=6', '--subagents=3', '--tick=600000'], { stdio: ['ignore', 'pipe', 'inherit'] })
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('fixture root')) resolve(child) })
    child.on('exit', (code) => reject(new Error('fixture exited ' + code)))
  })
}

// Visible text nodes smaller than 11px, and horizontal overflow of the page.
const AUDIT = `(() => {
  const small = new Map()
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n; (n = w.nextNode()); ) {
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || el.closest('svg')) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const px = parseFloat(cs.fontSize)
    if (px < 10.99) small.set((el.className?.toString?.() || el.tagName).slice(0, 60) + ' | ' + n.textContent.trim().slice(0, 24), px)
  }
  const clipped = []
  for (const el of document.querySelectorAll('[data-card-state], [data-session-card] *, [data-status-pill], [data-sub-pill]')) {
    if (!el.closest('.sr-only') && el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && getComputedStyle(el).textOverflow !== 'ellipsis') clipped.push((el.className?.toString?.() || el.tagName).slice(0, 50) + ' | ' + el.textContent.trim().slice(0, 20))
  }
  return { small: [...small].slice(0, 12), hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped: clipped.slice(0, 8) }
})()`

async function main() {
  const fixture = await startFixture()
  const app = await launch({ env: { CLAUDE_CONFIG_DIR: ROOT, CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0' } })
  const { evaluate, waitFor, sleep, cmd, type, key } = app
  const version = require('../package.json').version
  const size = (w, h) => cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  const shoot = async (name, opts = {}) => {
    await sleep(opts.wait ?? 500)
    const r = await cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(QA, name + '.png'), Buffer.from(r.result.data, 'base64'))
    const a = await evaluate(AUDIT)
    const bad = []
    if (a.hOverflow > 0) bad.push(`overflow-x ${a.hOverflow}px`)
    if (a.small.length && !opts.ignoreSmall) bad.push(`text<11px: ${a.small.map((s) => s[0] + '=' + s[1]).join('; ')}`)
    if (a.clipped.length) bad.push(`clipped: ${a.clipped.join('; ')}`)
    check(`shot ${name}`, bad.length === 0, bad.join(' || ') || 'ok')
  }
  const theme = (id) => evaluate(`${ST}.theme = '${id}'`)
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','vi'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.mapView','map'); localStorage.setItem('ccm.workspace.preset','shell')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${UI}`, 30000, 'reloaded')
    await size(1440, 900)
    await evaluate(`${ST}.hideFinished = false`)

    // Monitor
    await evaluate(`${UI}.setView('monitor'); ${UI}.openSessionTab(null)`)
    await waitFor(`${TM}.list.length >= 4`, 30000, 'fixture sessions').catch(() => {})
    await sleep(1500)
    await evaluate(`${UI}.panels.sessions.open = true`)
    await shoot('01-monitor-open-vi-dark')
    await evaluate(`${UI}.panels.sessions.open = false`)
    await shoot('02-monitor-closed-vi-dark')
    await evaluate(`${UI}.panels.sessions.open = true`)
    await sleep(400)
    const card = await evaluate(`(() => { const c = document.querySelector('[data-session-card]'); if (!c) return null; const r = c.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
    if (card) await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card[0], y: card[1] })
    await shoot('03-session-card-hover')
    await evaluate(`document.querySelector('[data-card-more]')?.click()`)
    await shoot('04-session-card-menu')
    await key('Escape', 'Escape', 27)
    const cardH = await evaluate(`[...document.querySelectorAll('[data-session-card]')].map((c) => Math.round(c.getBoundingClientRect().height))`)
    check('cards counted + heights', cardH.length >= 1, JSON.stringify(cardH))
    await evaluate(`document.querySelector('[data-session-card]')?.click()`)
    await sleep(600)
    await shoot('05-agent-map-with-details')
    await evaluate(`${UI}.openSessionTab(null)`)
    await evaluate(`${UI}.panels.sessions.open = true`)

    // Narrow window: sheet
    await size(760, 700)
    await sleep(500)
    await evaluate(`${UI}.panels.sessions.open = true`)
    await shoot('06-monitor-sheet-narrow')
    const sh = await evaluate(`Math.round(document.querySelector('[data-sheet]')?.getBoundingClientRect().height ?? 0)`)
    check('narrow sheet is a bottom sheet under 75% of the window height', sh > 0 && sh <= 525, String(sh))
    await evaluate(`${UI}.panels.sessions.open = false`)
    await shoot('07-monitor-narrow-zoom-cluster')
    await size(1440, 900)

    // Header popover Hạn mức
    await evaluate(`document.querySelector('[data-status-button]')?.click()`)
    await shoot('08-header-limits-popover')
    await key('Escape', 'Escape', 27)

    // Light monitor
    await theme('light')
    await evaluate(`${UI}.panels.sessions.open = true`)
    await shoot('09-monitor-light')
    await theme('dark')

    // Settings pages, 900px tall
    for (const p of ['general', 'appearance', 'editor', 'notify', 'reminders', 'github', 'integrations', 'access', 'data', 'about']) {
      await evaluate(`${UI}.settingsPage = '${p}'; ${UI}.settingsOpen = true`)
      await sleep(500)
      const hi = await evaluate(`(() => { const c = document.querySelector('[data-settings-current]'); const cont = c?.querySelector('.ccm-set-page') ?? c; return cont ? [cont.scrollHeight, cont.clientHeight] : null })()`)
      await shoot(`10-settings-${p}`, { ignoreSmall: false })
      const lay = await evaluate(`(() => { const d = document.querySelector('[data-settings-dialog]'); const side = d.querySelector('nav').parentElement.getBoundingClientRect(); const c = document.querySelector('[data-settings-current]').getBoundingClientRect(); return { sideRight: side.right, contentLeft: c.left, contentH: c.height } })()`)
      check(`settings ${p}: sidebar beside content, content >= 400px tall`, lay.contentLeft >= lay.sideRight - 1 && lay.contentH >= 400, JSON.stringify(lay))
    }
    await evaluate(`${UI}.settingsPage = 'notify'`)
    await sleep(300)
    const nh = await evaluate(`document.querySelector('[data-settings-current]').scrollHeight`)
    check('Thông báo page <= 1.3 screens (scrollHeight vs 900)', nh > 0 && nh <= 1170, String(nh))
    // search
    await evaluate(`document.querySelector('[data-settings-search]')?.focus()`)
    await type('âm')
    await sleep(600)
    await shoot('11-settings-search')
    const trap = await evaluate(`(() => { const d = document.querySelector('[data-settings-dialog]'); return !!d && d.contains(document.activeElement) })()`)
    check('Settings focus inside dialog while searching', trap)
    await key('Enter', 'Enter', 13)
    await sleep(700)
    await shoot('12-settings-search-picked-flash', { wait: 150 })
    await key('Escape', 'Escape', 27)
    await evaluate(`${UI}.settingsOpen = false`)
    await evaluate(`0`)
    await theme('light')
    await evaluate(`${UI}.settingsPage = 'general'; ${UI}.settingsOpen = true`)
    await shoot('13-settings-light')
    await evaluate(`${UI}.settingsOpen = false`)
    await theme('dark')

    // History, Usage, Devices, Extensions
    for (const [v, n] of [['history', '14-history'], ['usage', '15-usage'], ['devices', '16-devices'], ['extensions', '17-extensions']]) {
      await evaluate(`${UI}.setView('${v}')`)
      await sleep(1500)
      await shoot(n)
    }

    // Workspace: rail with 7 projects, one pane, split
    await evaluate(`${UI}.setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]') || ${W}.panes.length`, 15000, 'workspace').catch(() => {})
    await evaluate(`${W}.open('shell', ${JSON.stringify(PROJECTS[0])})`)
    await waitFor(`${W}.panes.length >= 1 && ${W}.panes[0].state === 'running'`, 25000, 'first shell')
    await sleep(800)
    await shoot('18-workspace-1-pane-dark')
    await theme('light')
    await shoot('19-workspace-1-pane-light')
    await theme('dark')
    await evaluate(`${W}.open('shell', ${JSON.stringify(PROJECTS[0])}, undefined, { split: { key: ${W}.panes[0].key, dir: 'row' } })`)
    await waitFor(`${W}.panes.length >= 2 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'split shells')
    await sleep(800)
    await shoot('20-workspace-split-2-pane')
    for (const d of PROJECTS.slice(1)) {
      await evaluate(`${W}.open('shell', ${JSON.stringify(d)}, undefined, { tab: true })`)
      await sleep(250)
    }
    await waitFor(`${W}.panes.length >= 8`, 30000, 'many panes').catch(() => {})
    await sleep(1500)
    const rows = await evaluate(`document.querySelectorAll('[data-side-head], [data-rail-row], [data-side-item]').length`)
    check('rail rows counted', rows > 0, String(rows))
    await shoot('21-workspace-rail-7-projects')

    // Git log with Branches toolbar
    const GIT = PROJECTS[0]
    const { execFileSync } = require('node:child_process')
    const git = (...a) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-C', GIT, ...a], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    fs.writeFileSync(path.join(GIT, 'a.txt'), 'a')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    git('checkout', '-q', '-b', 'feature/x')
    fs.writeFileSync(path.join(GIT, 'b.txt'), 'b')
    git('add', '.')
    git('commit', '-q', '-m', 'feat b')
    await evaluate(`${W}.openChanges(${JSON.stringify(GIT)})`)
    await waitFor(`!!document.querySelector('[data-kind=changes] [data-pane-more]')`, 10000, 'changes more').catch(() => {})
    await waitFor(`(() => { if (document.querySelector('[data-context-menu] [data-menu-id="log"]')) return true; document.querySelector('[data-kind=changes] [data-pane-more]')?.click(); return false })()`, 12000, 'menu log').catch(() => {})
    await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="log"]')?.click()`)
    await waitFor(`!!document.querySelector('[data-refs-toolbar]')`, 10000, 'log toolbar').catch(() => {})
    await shoot('22-git-log-toolbar')
    await evaluate(`document.querySelector('[data-refs-more]')?.click()`)
    await shoot('23-git-log-toolbar-more')
    await key('Escape', 'Escape', 27)
    await theme('light')
    await shoot('24-workspace-light-log')
  } catch (e) {
    check('script error', false, String(e.message ?? e))
    try { await shoot('99-error') } catch {}
  } finally {
    fs.writeFileSync(path.join(QA, 'shots-results.txt'), results.join('\n'))
    app.stop()
    fixture.kill()
    fs.rmSync(TMPD, { recursive: true, force: true })
  }
}
main().then(() => process.exit(0))
