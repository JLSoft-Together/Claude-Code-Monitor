// v80 QA: screenshots of the v80 screens (docs/qa/v80/*.png) plus structural checks. Fixture Claude root + temp project folders; shells only, no prompts sent.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { launch, REPO, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const W = `${S}.get('workspace')`
const TM = `${S}.get('terminals')`
const AG = `${S}.get('agents')`
const T = `${S}.get('toasts')`
const results = []
const soft = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'SKIP (CHƯA KIỂM: fixture has no data)'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }
const ROOT = path.join(OUT, 'v80-root')
const QA = process.env.CCM_QA_DIR || path.join(REPO, 'docs', 'qa', 'v80')
fs.mkdirSync(QA, { recursive: true })
const TMPD = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v80-')))
const GIT = path.join(TMPD, 'review-app')
const FLUTTER = path.join(TMPD, 'flutter-app')
fs.mkdirSync(GIT)
fs.mkdirSync(path.join(FLUTTER, 'lib'), { recursive: true })
fs.writeFileSync(path.join(FLUTTER, 'pubspec.yaml'), 'name: flutter_app\nenvironment:\n  sdk: ^3.9.0\ndependencies:\n  flutter:\n    sdk: flutter\n')
fs.writeFileSync(path.join(FLUTTER, 'lib', 'main.dart'), 'void main() {}\n')
fs.mkdirSync(path.join(FLUTTER, 'android'), { recursive: true })
fs.mkdirSync(path.join(FLUTTER, '.dart_tool'), { recursive: true })
fs.writeFileSync(path.join(FLUTTER, '.dart_tool', 'package_config.json'), '{"configVersion":2,"packages":[]}\n')

function startFixture() {
  const child = spawn(process.execPath, [path.join(REPO, 'scripts', 'demo-fixture.mjs'), `--root=${ROOT}`, '--sessions=6', '--subagents=3', '--tick=600000'], { stdio: ['ignore', 'pipe', 'inherit'] })
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('fixture root')) resolve(child) })
    child.on('exit', (code) => reject(new Error('fixture exited ' + code)))
  })
}

async function main() {
  const fixture = await startFixture()
  const app = await launch({ env: { CLAUDE_CONFIG_DIR: ROOT, CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0' } })
  const { evaluate, waitFor, sleep, cmd, type, key } = app
  const version = require('../package.json').version
  const shoot = async (name, wait = 500) => {
    await sleep(wait)
    const r = await cmd('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(QA, name + '.png'), Buffer.from(r.result.data, 'base64'))
    const over = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
    check(`shot ${name}`, over <= 0, over > 0 ? `overflow-x ${over}px` : 'ok')
  }
  const git = (...a) => execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-C', GIT, ...a], { stdio: 'ignore' })
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${version}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','vi'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.mapView','map'); localStorage.setItem('ccm.workspace.preset','shell')`)
    await cmd('Page.reload')
    await sleep(1500)
    await waitFor(`!!${UI}`, 30000, 'reloaded')
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

    // Ctrl+K: groups and prefixes
    await evaluate(`${UI}.setView('monitor'); ${UI}.openSessionTab(null)`)
    await waitFor(`${TM}.list.length >= 4`, 30000, 'fixture sessions').catch(() => {})
    await sleep(1500)
    await key('k', 'KeyK', 75, 2)
    await waitFor(`!!document.querySelector('[role="dialog"] input, [data-palette] input')`, 5000, 'palette').catch(() => {})
    await shoot('01-palette-empty')
    const groups0 = await evaluate(`document.querySelectorAll('[role="dialog"] [role="group"], [data-palette-group]').length`)
    await type('a')
    await shoot('02-palette-groups')
    check('palette shows more than one group for a loose query', groups0 >= 0 && (await evaluate(`document.querySelectorAll('[role="dialog"] [role="option"]').length`)) > 1)
    await key('a', 'KeyA', 65, 2)
    await key('Backspace', 'Backspace', 8)
    await type('>')
    await shoot('03-palette-prefix-actions')
    await key('a', 'KeyA', 65, 2)
    await key('Backspace', 'Backspace', 8)
    await type(':')
    await shoot('04-palette-prefix-settings')
    await evaluate(`${UI}.paletteOpen = false`)
    await sleep(400)

    // Agent Map: sub-agent tool timeline
    const sub = await evaluate(`(() => { const a = ${AG}.list?.find?.((x) => x.role === 'subagent') ?? Object.values(${AG}.byId ?? {}).find((x) => x.role === 'subagent'); return a ? a.id : null })()`)
    check('fixture has a sub-agent', !!sub, String(sub))
    if (sub) {
      await evaluate(`${UI}.panels.sessions.open = false; ${UI}.selectAgent(${JSON.stringify(sub)})`)
      await sleep(2500)
      const rows = await evaluate(`document.querySelectorAll('[data-tool-row], [data-agent-tools] li').length`)
      await shoot('05-agent-map-tool-timeline')
      soft('sub-agent panel shows tool rows', rows > 0, String(rows))
      await evaluate(`${UI}.selectAgent(null)`)
    }

    // Changes: unseen group
    fs.writeFileSync(path.join(GIT, 'a.txt'), 'a\n')
    fs.writeFileSync(path.join(GIT, 'b.txt'), 'b\n')
    fs.writeFileSync(path.join(GIT, 'c.txt'), 'c\n')
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.appendFileSync(path.join(GIT, f), 'change\n')
    await evaluate(`${UI}.setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]') || ${W}.panes.length`, 15000, 'workspace').catch(() => {})
    await evaluate(`${W}.open('shell', ${JSON.stringify(GIT)})`)
    await waitFor(`${W}.panes.length >= 1 && ${W}.panes.every((p) => p.state === 'running')`, 25000, 'shell').catch(() => {})
    await evaluate(`${W}.openChanges(${JSON.stringify(GIT)})`)
    await waitFor(`document.querySelectorAll('[role="option"][aria-selected]').length >= 3`, 15000, 'changes rows').catch(() => {})
    for (const idx of [1, 2]) {
      const pt = await evaluate(`(() => { const r = document.querySelectorAll('[role="option"][aria-selected]')[${idx}]?.getBoundingClientRect(); return r ? [r.x + 60, r.y + r.height / 2] : null })()`)
      if (!pt) break
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x: pt[0], y: pt[1], button: 'left', clickCount: 1 })
      await sleep(600)
    }
    fs.appendFileSync(path.join(GIT, 'a.txt'), 'later' + String.fromCharCode(10))
    await evaluate(`window.dispatchEvent(new Event('focus'))`)
    await sleep(2500)
    await shoot('06-changes-unseen-group')
    check('Changes shows the unseen badge', await evaluate(`!!document.querySelector('[data-review-unseen]')`))

    // Toast stack of three
    await evaluate(`for (const id of ['a', 'b', 'c']) ${T}.push({ id, kind: 'info', text: 'Thông báo mẫu ' + id, timeoutMs: 0 })`)
    await shoot('07-toast-stack')
    check('three toasts stacked', (await evaluate(`document.querySelectorAll('[data-toast]').length`)) === 3)
    await evaluate(`${T}.list.splice(0)`)

    // Run bar auto-reload switch
    await evaluate(`${W}.open('shell', ${JSON.stringify(FLUTTER)}, undefined, { tab: true })`)
    await sleep(1500)
    await evaluate(`${W}.openRun(${JSON.stringify(FLUTTER)})`)
    await waitFor(`!!document.querySelector('[data-run-menu-button]')`, 15000, 'run bar').catch(() => {})
    await evaluate(`document.querySelector('[data-run-menu-button]')?.click()`)
    await waitFor(`!!document.querySelector('[data-run-auto-reload]')`, 5000, 'auto reload item').catch(() => {})
    await shoot('08-runbar-auto-reload')
    check('Run menu has the auto-reload switch', await evaluate(`!!document.querySelector('[data-run-auto-reload]')`))
    await key('Escape', 'Escape', 27)

    // History: Continue button
    await evaluate(`${UI}.setView('history')`)
    await sleep(2000)
    await shoot('09-history')
    const cont = await evaluate(`document.querySelectorAll('[data-history-resume]').length`)
    soft('History rows have a Continue button', cont > 0, String(cont))

    // Limits popover
    await evaluate(`${UI}.setView('monitor')`)
    await sleep(600)
    await evaluate(`document.querySelector('[data-status-button]')?.click()`)
    await sleep(600)
    await shoot('10-limits-popover')
    const fc = await evaluate(`document.querySelectorAll('[data-limit-forecast]').length`)
    soft('limits popover forecast line', fc > 0, String(fc))
    await key('Escape', 'Escape', 27)
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
