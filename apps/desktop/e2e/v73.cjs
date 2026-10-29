// v73 against fakes: History tool / skill / subagent / MCP stats (seeded transcript in a fake CLAUDE_CONFIG_DIR), usage-limit
// chip on a fake agent pane (limit record appended live, reset 20 s ahead: schedule → cancel → schedule → "continue" is only
// prefilled, never followed by Enter), APK size dialog from the Explorer menu (+ previous-build compare), device app data
// over the fake adb (run-as, sql.js, read-only guard, prefs; no Save / Restore: those open native confirms), shell command
// marks in a PowerShell pane. The real phone, if one is plugged in, is never seen: adb comes from the fake ANDROID_HOME.
const { execFileSync, spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT, REPO } = require('./cdp.cjs')
const { apk, appDb, PREFS } = require('./fixtures/v73-fixtures.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const UI = `${S}.get('ui')`
const TM = `${S}.get('terminals')`
const MOD = process.platform === 'darwin' ? 4 : 2
const WIN = process.platform === 'win32'
const VERSION = require('../package.json').version
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v73-')))
const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v73fake-')))
const CONFIG = path.join(FAKE, 'claude-config')
const SDK = path.join(FAKE, 'android-sdk')
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const DEVICE = 'emulator-5554'
const PKG = 'com.example.demo'
const SID = crypto.randomUUID()
const TRANSCRIPT = path.join(CONFIG, 'projects', DIR.replace(/[^a-zA-Z0-9]/g, '-'), `${SID}.jsonl`)

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

function fakeAdb() {
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'run-fakes', 'adb.js'), path.join(TOOLS, 'adb.js'))
  const exe = path.join(SDK, 'platform-tools', WIN ? 'adb.exe' : 'adb')
  if (!WIN) {
    write(exe, `#!/bin/sh\nexec "${process.execPath}" "${path.join(TOOLS, 'adb.js')}" "$@"\n`)
    return fs.chmodSync(exe, 0o755)
  }
  const cs = path.join(FAKE, 'launcher.cs')
  fs.writeFileSync(cs, fs.readFileSync(path.join(__dirname, 'fixtures', 'run-fakes', 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  fs.mkdirSync(path.dirname(exe), { recursive: true })
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, cs], { stdio: 'pipe' })
}

let seq = 0
const line = (o) => JSON.stringify(o) + '\n'
const assistant = (at, content) => line({ type: 'assistant', timestamp: at, cwd: DIR, sessionId: SID, message: { id: `msg_e2e${(seq++).toString().padStart(4, '0')}`, model: 'claude-opus-5-5', role: 'assistant', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content } })
const toolUse = (id, name, input = {}) => ({ type: 'tool_use', id, name, input })
const result = (at, id, isError) => line({ type: 'user', timestamp: at, cwd: DIR, sessionId: SID, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: isError ? 'boom' : 'ok' }] } })

/**
 * Last 7 days: Bash ×2 (one error), Skill pdf, Agent Explore, Read, mcp figma ×2.
 * 10 days ago (30-day view only): Bash ×3, Skill docx, Agent without a type (general-purpose), mcp github.
 */
function seedTranscript() {
  const now = new Date(Date.now() - 60_000).toISOString()
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString()
  let text = line({ type: 'user', timestamp: old, cwd: DIR, sessionId: SID, message: { role: 'user', content: 'hello' } })
  for (const i of [1, 2, 3]) text += assistant(old, [toolUse(`toolu_old${i}`, 'Bash', { command: 'secret-arg' })]) + result(old, `toolu_old${i}`, false)
  text += assistant(old, [toolUse('toolu_old4', 'Skill', { skill: 'docx' })]) + assistant(old, [toolUse('toolu_old5', 'Agent', { description: 'x' })]) + assistant(old, [toolUse('toolu_old6', 'mcp__github__get_me')])
  text += assistant(now, [toolUse('toolu_new1', 'Bash', { command: 'false' })]) + result(now, 'toolu_new1', true)
  text += assistant(now, [toolUse('toolu_new2', 'Bash', { command: 'true' })]) + result(now, 'toolu_new2', false)
  text += assistant(now, [toolUse('toolu_new3', 'Skill', { skill: 'pdf' }), toolUse('toolu_new4', 'Agent', { subagent_type: 'Explore' })])
  text += assistant(now, [toolUse('toolu_new5', 'Read', { file_path: 'x' }), toolUse('toolu_new6', 'mcp__figma__get_screenshot'), toolUse('toolu_new7', 'mcp__figma__whoami')])
  text += line({ type: 'assistant', timestamp: now, cwd: DIR, sessionId: SID, message: { id: 'msg_e2eend', model: 'claude-opus-5-5', role: 'assistant', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: 'done' }] } })
  write(TRANSCRIPT, text)
}

/** A live process for the registry entry (CCM_VERIFY_PROCESSES=0 skips the command-line check, not the pid). */
function seedSession() {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { stdio: 'ignore' })
  write(
    path.join(CONFIG, 'sessions', `${child.pid}.json`),
    JSON.stringify({ pid: child.pid, sessionId: SID, cwd: DIR, startedAt: Date.now() - 600_000, version: '2.1.294', kind: 'interactive', entrypoint: 'cli', name: 'v73-limit', nameSource: 'derived', status: 'idle', updatedAt: Date.now(), statusUpdatedAt: Date.now() }),
  )
  return child
}

async function seedDevice() {
  const dir = path.join(STATE, 'appdata', PKG)
  write(path.join(dir, 'databases', 'app.db'), await appDb(REPO))
  write(path.join(dir, 'shared_prefs', 'settings.xml'), PREFS)
}

async function main() {
  let sleeper = null
  try {
    fakeAdb()
    await seedDevice()
    seedTranscript()
    sleeper = seedSession()
    write(path.join(DIR, 'README.md'), '# v73\n')
    fs.writeFileSync(path.join(DIR, 'app-debug.apk'), apk(1))
    fs.writeFileSync(path.join(DIR, 'old.apk'), apk(1))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DIR, stdio: 'pipe' })
  } catch (e) {
    check('fixtures', false, e.message)
    sleeper?.kill()
    return
  }
  const env = { ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, CLAUDE_CONFIG_DIR: CONFIG, CCM_VERIFY_PROCESSES: '0', CCM_CODEX: '0' }
  const app = await launch(process.argv[2] ? { exe: process.argv[2], env } : { env })
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  const esc = () => key('Escape', 'Escape', 27)
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v73-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
      await esc().catch(() => {})
    }
  }
  const panesOf = (kind) => evaluate(`${W}.panes.filter((p) => (p.kind ?? 'term') === 'term').map((p) => p.key)`).then((k) => (kind === 'first' ? k[0] : k.at(-1)))
  const focusTerm = (k) => evaluate(`document.querySelector('[data-pane="${k}"] .xterm-helper-textarea')?.focus()`)
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark'); localStorage.removeItem('ccm.resumeText'); localStorage.removeItem('ccm.shellIntegration')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')

    await step('tool stats', async () => {
      await evaluate(`${UI}.setView('history')`)
      const radio = (label) => evaluate(`[...document.querySelectorAll('[data-tool-stats] [role=radio]')].find((b) => b.textContent.trim() === '${label}')?.click()`)
      const hasRows = `!!document.querySelector('[data-tool-stats-group="tools"] li')`
      for (let i = 0; i < 6 && !(await waitFor(hasRows, 5000, 'rows').catch(() => false)); i++) {
        // The first request can beat the transcript scan; switching the range asks again.
        await radio('7 days')
        await sleep(300)
        await radio('30 days')
      }
      await waitFor(hasRows, 5000, 'tool stats rows')
      const read = () => evaluate(`Object.fromEntries([...document.querySelectorAll('[data-tool-stats-group]')].map((g) => [g.dataset.toolStatsGroup, Object.fromEntries([...g.querySelectorAll('li')].map((li) => [li.querySelector('.font-mono').textContent.trim(), Number(li.lastElementChild.textContent.trim())]))]))`)
      const m30 = await read()
      const want30 = { tools: { Bash: 5, Skill: 2, Agent: 2, Read: 1 }, skills: { docx: 1, pdf: 1 }, agents: { Explore: 1, 'general-purpose': 1 }, mcp: { figma: 2, github: 1 } }
      check('30 days: tools, skills, subagent types (untyped → general-purpose) and MCP servers counted', JSON.stringify(m30) === JSON.stringify(Object.fromEntries(Object.entries(want30).map(([g, o]) => [g, Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))]))), JSON.stringify(m30))
      const err = await evaluate(`[...document.querySelectorAll('[data-tool-stats-group="tools"] li')].find((li) => li.querySelector('.font-mono').textContent.trim() === 'Bash')?.querySelector('[data-tool-stats-errors]')?.textContent.trim() ?? ''`)
      check('Bash error rate from the is_error result (1 of 5 → 20%)', err === '20% errors', err)
      check('no tool input reaches the page', !(await evaluate(`document.querySelector('[data-tool-stats]').textContent.includes('secret-arg')`)))
      await shot('v73-01-toolstats-30')
      await evaluate(`[...document.querySelectorAll('[data-tool-stats] [role=radio]')].find((b) => b.textContent.trim() === '7 days')?.click()`)
      await waitFor(`(() => { const li = [...document.querySelectorAll('[data-tool-stats-group="tools"] li')].find((x) => x.querySelector('.font-mono').textContent.trim() === 'Bash'); return li && li.lastElementChild.textContent.trim() === '2' })()`, 10000, '7 day counts').catch(() => {})
      const m7 = await read()
      check('7 days: only this week (Bash 2 with 1 error, pdf, Explore, figma 2)', m7.tools?.Bash === 2 && !m7.skills?.docx && m7.skills?.pdf === 1 && m7.agents?.Explore === 1 && !m7.agents?.['general-purpose'] && m7.mcp?.figma === 2 && !m7.mcp?.github, JSON.stringify(m7))
      const err7 = await evaluate(`[...document.querySelectorAll('[data-tool-stats-group="tools"] li')].find((li) => li.querySelector('.font-mono').textContent.trim() === 'Bash')?.querySelector('[data-tool-stats-errors]')?.textContent.trim() ?? ''`)
      check('7 days: Bash error rate 50%', err7 === '50% errors', err7)
      await shot('v73-02-toolstats-7')
    })

    await evaluate(`${UI}.setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes.some((p) => p.state === 'running')`, 20000, 'shell running')
    const shellKey = await panesOf('first')

    await step('limit chip', async () => {
      const term = await waitFor(`${TM}.list.find((t) => t.claudeSessionId === '${SID}')?.id`, 30000, 'seeded session')
      await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
      await waitFor(`${W}.panes.filter((p) => p.state === 'running').length >= 2`, 20000, 'second shell')
      const agentKey = await panesOf('last')
      await evaluate(`${W}.update('${agentKey}', { preset: 'claude', terminalId: '${term}' })`)
      await evaluate(`${W}.activate('${agentKey}')`)
      check('no chip before a limit record', !(await evaluate(`!!document.querySelector('[data-pane="${agentKey}"] [data-limit-resume]')`)))
      const resetSecs = Math.ceil(Date.now() / 1000) + 20
      fs.appendFileSync(TRANSCRIPT, line({ type: 'assistant', timestamp: new Date().toISOString(), cwd: DIR, sessionId: SID, isApiErrorMessage: true, apiError: 'usage_limit_reached', error: 'rate_limit', quotaLimits: { status: 'rejected', resetsAt: resetSecs, rateLimitType: 'five_hour' }, message: { id: 'msg_e2elimit', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit" }] } }))
      await waitFor(`${TM}.byId['${term}']?.limitHit?.resetsAt`, 15000, 'limitHit from the transcript')
      check('collector reads usage_limit_reached → limitHit (five_hour, resetsAt)', await evaluate(`(() => { const h = ${TM}.byId['${term}'].limitHit; return h.window === 'five_hour' && Date.parse(h.resetsAt) === ${resetSecs * 1000} })()`))
      const chip = `document.querySelector('[data-pane="${agentKey}"] [data-limit-resume]')`
      await waitFor(`!!${chip}`, 5000, 'chip')
      const hhmm = await evaluate(`new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(${resetSecs * 1000}))`)
      const label = await evaluate(`${chip}.getAttribute('aria-label')`)
      check('chip waits for the reset time', (await evaluate(`${chip}.dataset.limitResume`)) === 'waiting' && label.includes(`Waiting for reset ${hhmm}`), label)
      await evaluate(`(() => { window.__v73Sent = []; const send = (window.__v73Send = WebSocket.prototype.send); WebSocket.prototype.send = function (d) { try { window.__v73Sent.push(typeof d === 'string' ? d : new TextDecoder().decode(d)) } catch {} return send.call(this, d) } })()`)
      await evaluate(`${chip}.click()`)
      await waitFor(`!!document.querySelector('[data-limit-resume-pop]')`, 3000, 'popover')
      check('popover prefills the default "continue"', (await evaluate(`document.querySelector('[data-limit-resume-text]').value`)) === 'continue')
      await shot('v73-03-limit-pop')
      await evaluate(`document.querySelector('[data-limit-resume-confirm]').click()`)
      await waitFor(`${chip}?.dataset.limitResume === 'scheduled'`, 3000, 'scheduled').catch(() => {})
      check('Schedule → chip "Continue at …"', (await evaluate(`${chip}.dataset.limitResume`)) === 'scheduled' && (await evaluate(`${chip}.getAttribute('aria-label')`)).includes('Continue at'))
      await evaluate(`${chip}.click()`)
      await waitFor(`!!document.querySelector('[data-limit-resume-cancel]')`, 3000, 'cancel button')
      await evaluate(`document.querySelector('[data-limit-resume-cancel]').click()`)
      await sleep(300)
      check('Cancel schedule → back to waiting, nothing stored', (await evaluate(`${chip}.dataset.limitResume`)) === 'waiting' && (await evaluate(`!sessionStorage.getItem('ccm.resumeSchedule')`)))
      await evaluate(`${chip}.click()`)
      await waitFor(`!!document.querySelector('[data-limit-resume-confirm]')`, 3000, 'popover again')
      await evaluate(`document.querySelector('[data-limit-resume-confirm]').click()`)
      await waitFor(`${chip}?.dataset.limitResume === 'scheduled'`, 3000, 'scheduled again')
      const fireAt = resetSecs * 1000 + 15_000
      await waitFor(`Date.now() > ${fireAt} && window.__v73Sent.some((d) => d.includes('continue'))`, Math.max(5000, fireAt - Date.now() + 15000), 'prefill at reset + 15 s').catch(() => {})
      const sent = await evaluate(`(() => { const i = window.__v73Sent.findIndex((d) => d.includes('continue')); return i < 0 ? null : window.__v73Sent.slice(i) })()`)
      check('at reset + 15 s "continue" is pasted into the pane input', !!sent, String(Date.now() - fireAt))
      await sleep(1500)
      const after = await evaluate(`(() => { const i = window.__v73Sent.findIndex((d) => d.includes('continue')); return i < 0 ? [] : window.__v73Sent.slice(i) })()`)
      check('…and never submitted (no Enter after the prefill)', !!sent && !after.some((d) => d.includes('\\r') || d.includes('\\\\r')), JSON.stringify(after).slice(0, 300))
      check('schedule cleared after it fired, pane focused', !(await evaluate(`!!sessionStorage.getItem('ccm.resumeSchedule')`)) && (await evaluate(`${W}.activeKey === '${agentKey}'`)))
      await shot('v73-04-limit-filled')
      await evaluate(`if (window.__v73Send) WebSocket.prototype.send = window.__v73Send`)
      await evaluate(`${W}.update('${agentKey}', { preset: 'shell', terminalId: undefined })`)
    })

    const rowSel = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === ${JSON.stringify(name)})`
    const openApk = async () => {
      await evaluate(`${W}.activate('${shellKey}')`)
      await evaluate(`if (!document.querySelector('[data-explorer-tree]')) document.querySelector('[data-explorer-toggle]').click()`)
      await waitFor(`!!(${rowSel('app-debug.apk')})`, 10000, 'apk row')
      await evaluate(`(() => { const el = ${rowSel('app-debug.apk')}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
      await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id="apk-size"]')`, 3000, 'apk menu item')
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="apk-size"]').click()`)
      await waitFor(`!!document.querySelector('[data-apk-size] [data-apk-groups]')`, 15000, 'apk report')
    }
    await step('apk size', async () => {
      await openApk()
      const groups = await evaluate(`[...document.querySelectorAll('[data-apk-groups] tbody tr')].map((r) => r.cells[0].textContent.trim())`)
      const want = ['Code (dex)', 'Resources (res/)', 'Resource table', 'Assets', 'Native libraries · arm64-v8a', 'Signature and metadata']
      check('Explorer menu → APK groups (dex, res, arsc, assets, lib:arm64-v8a, meta)', want.every((g) => groups.includes(g)), JSON.stringify(groups))
      const head = await evaluate(`document.querySelector('[data-apk-size]').textContent.replace(/\\s+/g, ' ')`)
      check('dex method refs and manifest (package, 1.2.3 (42), debuggable, min 24 / target 35)', head.includes('1,500 method references in 2 dex') && head.includes('com.example.app') && head.includes('1.2.3 (42)') && head.includes('Debuggable build') && head.includes('min 24 · target 35'), head.slice(0, 400))
      check('permissions listed (2)', head.includes('Permissions (2)'))
      check('first analysis: no earlier build to compare', head.includes('No earlier build of this project has been analyzed') && !(await evaluate(`!!document.querySelector('[data-apk-prev]')`)))
      const c1 = await evaluate(`document.querySelector('[data-apk-total]').textContent`)
      await evaluate(`[...document.querySelectorAll('[data-apk-by] [role=radio]')].find((b) => b.textContent.trim() === 'Uncompressed')?.click()`)
      await sleep(200)
      check('Uncompressed switch changes the total', (await evaluate(`document.querySelector('[data-apk-total]').textContent`)) !== c1)
      await shot('v73-05-apk')
      await esc()
      await waitFor(`!document.querySelector('[data-apk-size]')`, 5000, 'apk closed')
      fs.writeFileSync(path.join(DIR, 'app-debug.apk'), apk(2))
      await openApk()
      await waitFor(`!!document.querySelector('[data-apk-diff]')`, 5000, 'diff').catch(() => {})
      const diff = await evaluate(`[...document.querySelectorAll('[data-apk-diff] tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim()))`)
      check('rebuilt at the same path → compared with the previous build', (await evaluate(`!!document.querySelector('[data-apk-prev][aria-pressed="true"]')`)) && diff.some((r) => r[0] === 'Native libraries · x86_64' && r[1] === '—') && diff.some((r) => r[0] === 'Assets' && r[2] === '—') && diff.some((r) => r[0] === 'Native libraries · arm64-v8a' && r[3].startsWith('+')), JSON.stringify(diff))
      const lists = await evaluate(`[...document.querySelectorAll('[data-apk-files]')].map((d) => d.dataset.apkFiles + ':' + d.querySelector('summary').textContent.trim())`)
      check('added / removed / changed file lists', ['added', 'removed', 'changed'].every((k) => lists.some((l) => l.startsWith(k))), JSON.stringify(lists))
      await shot('v73-06-apk-compare')
      await esc()
      const ipc = await evaluate(`window.ccmDesktop.apkCompare({ path: ${JSON.stringify(path.join(DIR, 'app-debug.apk'))}, other: ${JSON.stringify(path.join(DIR, 'old.apk'))} })`)
      check('compare two files in the project (IPC; the button opens a native picker)', ipc?.ok && ipc.diff.addedCount === 1 && ipc.diff.removedCount === 1, JSON.stringify(ipc?.diff ? { a: ipc.diff.addedCount, r: ipc.diff.removedCount } : ipc))
      const out = await evaluate(`window.ccmDesktop.apkAnalyze({ path: ${JSON.stringify(path.join(os.tmpdir(), 'nope.apk'))}, root: null })`)
      check('a path outside the projects is refused', out?.ok === false && ['denied', 'missing'].includes(out.error), JSON.stringify(out))
    })

    const row = `document.querySelector('[data-dev-row="${DEVICE}"]')`
    const appData = '[data-device-appdata]'
    await step('device app data', async () => {
      await evaluate(`${UI}.setView('devices')`)
      await waitFor(`!!${row}?.querySelector('[data-dev-action=appData]')`, 20000, 'device row')
      await evaluate(`${row}.querySelector('[data-dev-action=appData]').click()`)
      await waitFor(`!!document.querySelector('${appData} [data-appdata-pkg]')`, 5000, 'dialog')
      // The button enables on the next render after the input event.
      const setPkg = (p) => evaluate(`(async () => { const i = document.querySelector('[data-appdata-pkg]'); i.value = ${JSON.stringify(p)}; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 100)); document.querySelector('[data-appdata-load]').click() })()`)
      await setPkg('com.example.release')
      await waitFor(`!!document.querySelector('[data-appdata-message]')`, 15000, 'refusal').catch(() => {})
      check('release build refused (run-as: not debuggable)', (await evaluate(`document.querySelector('[data-appdata-message]')?.textContent ?? ''`)).includes('not debuggable'))
      await setPkg(PKG)
      await waitFor(`!!document.querySelector('[data-appdata-file="app.db"]')`, 15000, 'files')
      check('lists the database and the prefs file', await evaluate(`!!document.querySelector('[data-appdata-file="settings.xml"]')`))
      await evaluate(`document.querySelector('[data-appdata-file="app.db"]').click()`)
      await waitFor(`!!document.querySelector('[data-appdata-grid] tbody tr')`, 20000, 'rows').catch(() => {})
      const err = await evaluate(`document.querySelector('[data-appdata-message]')?.textContent ?? ''`)
      const tables = await evaluate(`[...document.querySelectorAll('[data-appdata-table] option')].map((o) => o.textContent.trim())`)
      check('sql.js opens the pulled copy: tables with row counts + the view', JSON.stringify(tables) === JSON.stringify(['items · 450', 'notes · 2', 'cheap (view)']), JSON.stringify(tables) + ' ' + err)
      const pageText = () => evaluate(`document.querySelector('${appData}').textContent.match(/Rows [\\d,–]+( of [\\d,]+)?/)?.[0] ?? ''`)
      check('first page: rows 1–200 of 450', (await pageText()) === 'Rows 1–200 of 450', await pageText())
      const next = `document.querySelector('${appData} [aria-label="Next page"]')`
      await evaluate(`${next}.click()`)
      await waitFor(`document.querySelector('[data-appdata-grid] tbody tr td:nth-child(2)')?.textContent === 'item-201'`, 5000, 'page 2').catch(() => {})
      await evaluate(`${next}.click()`)
      await waitFor(`document.querySelector('[data-appdata-grid] tbody tr td:nth-child(2)')?.textContent === 'item-401'`, 5000, 'page 3').catch(() => {})
      check('paging to rows 401–450, Next disabled at the end', (await pageText()) === 'Rows 401–450 of 450' && (await evaluate(`${next}.disabled`)), await pageText())
      const query = (sql) => evaluate(`(async () => { const q = document.querySelector('[data-appdata-query]'); q.value = ${JSON.stringify(sql)}; q.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 100)); document.querySelector('[data-appdata-run]').click() })()`)
      await query("UPDATE items SET name = 'x'")
      await waitFor(`!!document.querySelector('[data-appdata-message]')`, 5000, 'guard').catch(() => {})
      check('read-only guard rejects UPDATE', (await evaluate(`document.querySelector('[data-appdata-message]')?.textContent ?? ''`)).includes('Only one read-only statement'))
      await query('SELECT count(*) AS n FROM cheap')
      await waitFor(`document.querySelector('[data-appdata-grid] th')?.textContent === 'n'`, 5000, 'query result').catch(() => {})
      check('SELECT on the view runs (49 cheap items)', (await evaluate(`document.querySelector('[data-appdata-grid] tbody td')?.textContent`)) === '49')
      await shot('v73-07-appdata-db')
      await evaluate(`document.querySelector('[data-appdata-file="settings.xml"]').click()`)
      await waitFor(`!!document.querySelector('[data-appdata-prefs]')`, 15000, 'prefs')
      const prefs = await evaluate(`[...document.querySelectorAll('[data-appdata-prefs] tbody tr')].map((r) => [...r.cells].slice(0, 3).map((c) => c.textContent.trim()).join('|'))`)
      check('prefs table: key, type, value', ['user_name|string|Ann', 'onboarded|boolean|true', 'launch_count|int|7'].every((p) => prefs.includes(p)), JSON.stringify(prefs))
      check('Restore original disabled (nothing changed from Orrery)', await evaluate(`document.querySelector('[data-appdata-restore]').disabled`))
      await evaluate(`document.querySelector('[data-appdata-edit="launch_count"]').click()`)
      await waitFor(`!!document.querySelector('[data-appdata-draft]')`, 3000, 'editor')
      await evaluate(`(() => { const i = document.querySelector('[data-appdata-draft]'); i.value = 'abc'; i.dispatchEvent(new Event('input')) })()`)
      await sleep(150)
      check('invalid int blocks Save (Save not clicked: it opens a native confirm)', await evaluate(`document.querySelector('[data-appdata-save]').disabled`))
      await shot('v73-08-appdata-prefs')
      await esc()
      await sleep(150)
      check('Esc leaves the editor, the dialog stays', await evaluate(`!document.querySelector('[data-appdata-draft]') && !!document.querySelector('${appData}')`))
      await evaluate(`document.querySelector('[data-appdata-close]').click()`)
      await waitFor(`!document.querySelector('${appData}')`, 5000, 'closed').catch(() => {})
      check('Close button closes the dialog', await evaluate(`!document.querySelector('${appData}')`))
      check('device file untouched', fs.readFileSync(path.join(STATE, 'appdata', PKG, 'shared_prefs', 'settings.xml'), 'utf8') === PREFS)
    })

    await step('shell marks', async () => {
      await evaluate(`${UI}.setView('workspace')`)
      await evaluate(`${W}.activate('${shellKey}')`)
      await sleep(500)
      const pane = `[data-pane="${shellKey}"]`
      const marks = () => evaluate(`[...document.querySelectorAll('${pane} [data-shell-mark]')].map((m) => m.dataset.mark)`)
      const run = async (text) => {
        await cmd('Page.bringToFront')
        await focusTerm(shellKey)
        await type(text)
        await key('Enter', 'Enter', 13)
      }
      await run('cmd /c exit 3')
      const failed = await waitFor(`[...document.querySelectorAll('${pane} [data-shell-mark]')].some((m) => m.dataset.mark === 'fail')`, 30000, 'fail mark').catch(() => false)
      check('PowerShell pane: exit 3 gets a ✗ mark', !!failed, JSON.stringify(await marks()))
      if (!failed) return
      await run('echo ok')
      await waitFor(`[...document.querySelectorAll('${pane} [data-shell-mark]')].some((m) => m.dataset.mark === 'ok')`, 15000, 'ok mark').catch(() => {})
      check('echo ok gets a ✓ mark', (await marks()).includes('ok'), JSON.stringify(await marks()))
      const failLabel = await evaluate(`document.querySelector('${pane} [data-shell-mark][data-mark=fail]').getAttribute('aria-label')`)
      check('mark label names the command and exit code', failLabel.includes('cmd /c exit 3') && failLabel.includes('exit 3'), failLabel)
      await shot('v73-09-shell-marks')
      const openMarkMenu = (kind) => evaluate(`document.querySelector('${pane} [data-shell-mark][data-mark=${kind}]').click()`)
      await openMarkMenu('fail')
      await waitFor(`!!document.querySelector('[data-context-menu]')`, 3000, 'mark menu')
      const items = await evaluate(`[...document.querySelectorAll('[data-context-menu] [role=menuitem]')].map((b) => b.dataset.menuId)`)
      check('mark menu: copy command, copy output, fill into agent, run again', JSON.stringify(items) === JSON.stringify(['copyCommand', 'copyOutput', 'fillAgent', 'runAgain']), JSON.stringify(items))
      await evaluate(`navigator.clipboard.writeText('sentinel').catch(() => {})`)
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="copyCommand"]').click()`)
      await sleep(400)
      check('Copy command', (await evaluate(`navigator.clipboard.readText().catch(() => null)`)) === 'cmd /c exit 3')
      await openMarkMenu('ok')
      await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id="copyOutput"]')`, 3000, 'ok menu')
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="copyOutput"]').click()`)
      await sleep(400)
      check('Copy output', (await evaluate(`navigator.clipboard.readText().catch(() => null)`)) === 'ok', await evaluate(`navigator.clipboard.readText().catch(() => null)`))
      await run('1..80')
      await sleep(2500)
      const top = () => evaluate(`(() => { const s = document.querySelector('${pane} .xterm-scrollable-element .scrollbar.vertical .slider'); return s ? parseFloat(s.style.top) || 0 : document.querySelector('${pane} .xterm-viewport').scrollTop })()`)
      const bottom = await top()
      await focusTerm(shellKey)
      await key('ArrowUp', 'ArrowUp', 38, MOD)
      await sleep(300)
      const up1 = await top()
      await key('ArrowUp', 'ArrowUp', 38, MOD)
      await sleep(300)
      const up2 = await top()
      check('Ctrl+↑ jumps back command by command', up1 < bottom && up2 < up1, `${bottom} → ${up1} → ${up2}`)
      await key('ArrowDown', 'ArrowDown', 40, MOD)
      await sleep(300)
      const down = await top()
      check('Ctrl+↓ jumps forward', down > up2, `${up2} → ${down}`)
      await shot('v73-10-shell-jump')
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await shot('v73-99-error').catch(() => {})
  } finally {
    app.stop()
    sleeper?.kill()
    fs.writeFileSync(path.join(OUT, 'results-v73.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    for (const d of [DIR, FAKE]) try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
