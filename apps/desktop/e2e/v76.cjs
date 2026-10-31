// v76 against fakes: Resources card over CCM_RES_FIXTURE (fake process + port table, stops only written to
// `<fixture>.killed`, CCM_E2E_RES_CONFIRM=1 answers the confirm), port conflict notice from a transcript EADDRINUSE,
// keep-awake (CCM_E2E_POWER, short CCM_E2E_AWAKE_GRACE_MS), capture folder (CCM_E2E_CAPTURE_DIR), sensitive watch
// from live transcript lines, and phone notifications to a loopback receiver (CCM_PHONE_URL_OVERRIDE, CCM_E2E_IDLE_S).
// Sessions are two idle `node` processes registered in a fake CLAUDE_CONFIG_DIR; nothing real is stopped.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const RES = `${S}.get('resources')`
const TERMS = `${S}.get('terminals')`
const VERSION = require('../package.json').version
const DATA = path.join(OUT, 'run', 'data')
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v76-')))
const CONFIG = path.join(FAKE, 'claude-config')
const DIR_A = path.join(FAKE, 'forgot-app')
const DIR_B = path.join(FAKE, 'busy-app')
const CAPDIR = path.join(FAKE, 'cache')
const FIXTURE = path.join(FAKE, 'procs.json')
const KILLED = `${FIXTURE}.killed`
const SECRET_TOPIC = 'orrery-e2e-topic-7f3k'
const SECRET_SERVER = 'https://ntfy.example.org/private-base'

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}
const line = (o) => `${JSON.stringify(o)}\n`
const slug = (cwd) => path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
const killed = () => (fs.existsSync(KILLED) ? fs.readFileSync(KILLED, 'utf8').split('\n').filter(Boolean).map(Number) : [])
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

const sleepers = []
const sessions = {}
function seedSession(key, cwd, status, ageMs) {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { stdio: 'ignore' })
  sleepers.push(child)
  fs.mkdirSync(cwd, { recursive: true })
  const at = Date.now() - ageMs
  const s = { pid: child.pid, sessionId: require('node:crypto').randomUUID(), cwd, status, at, started: at - 60_000, name: `${key}-session` }
  s.transcript = path.join(CONFIG, 'projects', slug(cwd), `${s.sessionId}.jsonl`)
  write(s.transcript, line({ type: 'user', timestamp: new Date(at).toISOString(), cwd, sessionId: s.sessionId, message: { role: 'user', content: 'hello' } }))
  if (ageMs) fs.utimesSync(s.transcript, new Date(at), new Date(at))
  sessions[key] = s
  registry(s)
}
function registry(s) {
  write(path.join(CONFIG, 'sessions', `${s.pid}.json`), JSON.stringify({
    pid: s.pid, sessionId: s.sessionId, cwd: s.cwd, startedAt: s.started, version: '2.1.294', kind: 'interactive', entrypoint: 'cli',
    name: s.name, nameSource: 'derived', status: s.status, waitingFor: s.status === 'waiting' ? 'permission prompt' : undefined, updatedAt: s.at, statusUpdatedAt: s.at,
  }))
}
function setStatus(key, status) {
  const s = sessions[key]
  s.status = status
  s.at = Date.now()
  registry(s)
}
let toolN = 0
function toolCall(key, name, input, result = { isError: false, content: 'ok' }) {
  const s = sessions[key]
  const id = `toolu_e2e${++toolN}`
  const at = new Date().toISOString()
  fs.appendFileSync(s.transcript, line({ type: 'assistant', timestamp: at, cwd: s.cwd, sessionId: s.sessionId, message: { id: `msg_e2e${toolN}`, model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'tool_use', id, name, input }] } }))
  fs.appendFileSync(s.transcript, line({ type: 'user', timestamp: at, cwd: s.cwd, sessionId: s.sessionId, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: result.isError, content: result.content }] } }))
}

const MB = 1024 * 1024
function fixture({ withB = true } = {}) {
  const A = sessions.a.pid
  const B = sessions.b.pid
  const procs = [
    { pid: A, ppid: 1, name: 'claude.exe', start: '1000', ram: 300 * MB, cpuMs: 500, cmd: 'claude' },
    ...(withB ? [{ pid: B, ppid: 1, name: 'claude.exe', start: '1001', ram: 400 * MB, cpuMs: 900, cmd: 'claude' }] : []),
    { pid: 50001, ppid: B, name: 'bash.exe', start: '1100', ram: 8 * MB, cpuMs: 10, cmd: 'bash' },
    { pid: 50002, ppid: 50001, name: 'node.exe', start: '1101', ram: 120 * MB, cpuMs: 30, cmd: 'node node_modules/vite/bin/vite.js --port 5173 --token sk-ant-api03-e2eSECRETe2eSECRETe2eSECRET' },
    { pid: 50010, ppid: 1, name: 'java.exe', start: '1200', ram: 1024 * MB, cpuMs: 4000, cmd: '"C:\\jdks\\jdk-17.0.9\\bin\\java.exe" -Xmx2g -cp C:\\gradle\\lib\\gradle-daemon-main-8.14.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.14' },
    { pid: 50020, ppid: 1, name: 'qemu-system-x86_64.exe', start: '1300', ram: 2048 * MB, cpuMs: 90000, cmd: 'qemu-system-x86_64.exe -avd Pixel_8 -port 5554 -netdelay none' },
    { pid: 50030, ppid: 1, name: 'postgres.exe', start: '1400', ram: 60 * MB, cpuMs: 5, cmd: 'postgres -D data' },
  ]
  const ports = {
    50002: [{ port: 5173, address: '127.0.0.1', established: 0 }],
    50030: [{ port: 5432, address: '0.0.0.0', established: 2 }],
  }
  fs.writeFileSync(FIXTURE, JSON.stringify({ procs, ports }))
}

const phoneHits = []
let phoneDown = false
function serve() {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      phoneHits.push({ method: req.method, url: req.url, body })
      res.writeHead(phoneDown ? 500 : 200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  let server = null
  try {
    seedSession('a', DIR_A, 'idle', 90 * 60_000)
    seedSession('b', DIR_B, 'busy', 0)
    fixture()
    server = await serve()
  } catch (e) {
    check('fixtures', false, e.message)
    server?.close()
    return
  }
  const env = {
    CLAUDE_CONFIG_DIR: CONFIG,
    CCM_VERIFY_PROCESSES: '0',
    CCM_CODEX: '0',
    CCM_RES_FIXTURE: FIXTURE,
    CCM_E2E_RES_CONFIRM: '1',
    CCM_E2E_POWER: 'ac',
    CCM_E2E_AWAKE_GRACE_MS: '3000',
    CCM_E2E_CAPTURE_DIR: CAPDIR,
    CCM_PHONE_URL_OVERRIDE: `http://127.0.0.1:${server.address().port}/phone`,
    CCM_E2E_IDLE_S: '900',
  }
  const app = await launch({ env })
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const esc = () => key('Escape', 'Escape', 27)
  const click = (sel) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.click() })()`)
  const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  const setInput = (sel, value) => evaluate(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const termId = (key) => evaluate(`Object.values(${TERMS}.byId).find((t) => t.cwd && t.cwd.toLowerCase() === ${JSON.stringify(sessions[key].cwd.toLowerCase())})?.id ?? null`)
  const radio = (group, i) => evaluate(`(() => { const r = document.querySelectorAll(${JSON.stringify(group + ' [role="radio"]')})[${i}]; if (!r) throw new Error('no radio ${i} in ${group}'); r.click() })()`)
  // A pass runs when a window connects; reloading the page reconnects it, so the sampler re-reads the fixture at once.
  const pass = async (label, until = 'true') => {
    await cmd('Page.reload')
    await sleep(500)
    await waitFor(`!!${UI} && (${until})`, 20000, label).catch(async (e) => {
      throw new Error(`${e.message}: ${await evaluate(`JSON.stringify({ at: ${RES}.report?.at, s: ${RES}.report?.sessions, n: ${RES}.report?.servers?.length, t: Object.values(${TERMS}.byId).map((t) => [t.id, t.processId, t.status]) })`).catch(() => '?')}`)
    })
    await sleep(300)
  }
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v76-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
      await esc().catch(() => {})
    }
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await evaluate(`${UI}.setView('monitor')`)
    await waitFor(`Object.keys(${TERMS}.byId).length >= 2`, 20000, 'two sessions')
    const A = await termId('a')
    const B = await termId('b')
    check('both fake sessions listed', !!A && !!B, JSON.stringify([A, B]))
    await pass('report with both sessions', `${RES}.report?.sessions.length === 2`)

    await step('resources', async () => {
      const r = await evaluate(`JSON.parse(JSON.stringify(${RES}.report))`)
      const sa = r.sessions.find((s) => s.sessionId === A)
      const sb = r.sessions.find((s) => s.sessionId === B)
      check('session A idle 90 min → forgotten; B working → not', sa?.forgotten === true && sb?.forgotten === false, JSON.stringify(r.sessions.map((s) => [s.name, s.forgotten, s.idleSinceMs])))
      check('session RAM = whole tree (B: claude + bash + node = 528 MB)', sb?.ramBytes === 528 * MB && sa?.ramBytes === 300 * MB, `${sb?.ramBytes} ${sa?.ramBytes}`)
      const srv = r.servers.find((s) => s.pid === 50001)
      check('shell → node with :5173 is a dev-server of session B', srv?.kind === 'dev-server' && srv.sessionId === B && srv.ports[0]?.port === 5173 && srv.name === 'node.exe', JSON.stringify(srv))
      check('server command line masked (no sk-ant secret)', !!srv && !srv.cmd.includes('e2eSECRET'), srv?.cmd)
      const gradle = r.servers.find((s) => s.pid === 50010)
      const emu = r.servers.find((s) => s.pid === 50020)
      check('Gradle daemon found with version + JDK', gradle?.kind === 'daemon' && gradle.daemon?.type === 'gradle' && gradle.daemon.version === '8.14' && gradle.daemon.jdk === 'jdk-17.0.9', JSON.stringify(gradle?.daemon))
      check('emulator found with AVD + serial', emu?.kind === 'emulator' && emu.daemon?.avd === 'Pixel_8' && emu.daemon?.serial === 'emulator-5554', JSON.stringify(emu?.daemon))
      check('postgres :5432 listed as outside port', (r.outside ?? []).some((o) => o.pid === 50030 && o.ports[0].port === 5432), JSON.stringify(r.outside))
      check('totals count 1 forgotten', r.totals.forgotten === 1, JSON.stringify(r.totals))

      await waitFor(`!!document.querySelector('[data-resources-badge]')`, 5000, 'badge')
      check('header Resources button shows the forgotten badge (1)', (await text('[data-resources-badge]')) === '1', await text('[data-resources-badge]'))
      await waitFor(`document.querySelectorAll('[data-card-resources]').length >= 2`, 5000, 'card lines')
      const cards = await evaluate(`[...document.querySelectorAll('[data-card-resources]')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`)
      check('session cards show a RAM / CPU line, the idle one marked forgotten', cards.some((c) => /528\s?MB/.test(c)) && cards.some((c) => /300\s?MB/.test(c) && /forgotten/i.test(c)), JSON.stringify(cards))

      await click('[data-resources-button]')
      await waitFor(`!!document.querySelector('[data-resources-dialog]')`, 5000, 'dialog')
      check('dialog lists both sessions', (await evaluate(`document.querySelectorAll('[data-res-session]').length`)) === 2)
      await shot('v76-01-resources-sessions')
      await click('[data-res-only-forgotten]')
      await sleep(200)
      check('Only forgotten → just session A', JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-res-session]')].map((e) => e.dataset.resSession)`)) === JSON.stringify([A]))
      await click('[data-res-only-forgotten]')
      await evaluate(`${RES}.tab = 'servers'`)
      await waitFor(`!!document.querySelector('[data-res-server="50001"]')`, 3000, 'server row')
      const row = await text('[data-res-server="50001"]')
      check('Servers tab: node row with :5173 and the session name', row.includes(':5173') && row.includes('b-session'), row)
      await evaluate(`${RES}.tab = 'daemons'`)
      await waitFor(`!!document.querySelector('[data-res-server="50010"]')`, 3000, 'daemon rows')
      const g = await text('[data-res-server="50010"]')
      const em = await text('[data-res-server="50020"]')
      check('Daemons tab: Gradle 8.14 with JDK and emulator Pixel_8', g.includes('8.14') && g.includes('jdk-17.0.9') && em.includes('Pixel_8'), `${g} | ${em}`)
      check('fresh daemon counts as building → Stop disabled', await evaluate(`document.querySelector('[data-res-server="50010"] button')?.disabled === true`))
      await shot('v76-02-resources-daemons')
      await evaluate(`${RES}.tab = 'ports'`)
      await waitFor(`!!document.querySelector('[data-res-port="5432"]')`, 3000, 'port rows')
      const p5432 = await evaluate(`[...document.querySelectorAll('[data-res-port="5432"] button')].map((b) => b.textContent.trim())`)
      const p5173 = await evaluate(`[...document.querySelectorAll('[data-res-port="5173"] button')].map((b) => b.textContent.trim())`)
      check('Ports tab: outside :5432 has Open / Copy only, agent :5173 also Stop', !p5432.some((b) => /stop/i.test(b)) && p5173.some((b) => /stop/i.test(b)), JSON.stringify([p5432, p5173]))
      check(':5432 row shows 2 connections and "outside"', /2 connections/i.test(await text('[data-res-port="5432"]')) && /outside/i.test(await text('[data-res-port="5432"]')), await text('[data-res-port="5432"]'))
      await shot('v76-03-resources-ports')
      await esc()
      await waitFor(`!document.querySelector('[data-resources-dialog]')`, 3000, 'closed')
    })

    await step('port conflict', async () => {
      toolCall('b', 'Bash', { command: 'npm run dev' }, { isError: true, content: 'Error: listen EADDRINUSE: address already in use 127.0.0.1:5173\n    at Server.setupListenHandle' })
      await sleep(2500)
      await pass('conflict', `(${RES}.report?.conflicts ?? []).length > 0`)
      const c = await evaluate(`JSON.parse(JSON.stringify(${RES}.report.conflicts[0]))`)
      check('conflict: port 5173 held by node.exe of session B', c.port === 5173 && c.holder?.pid === 50002 && c.holder.sessionId === B, JSON.stringify(c))
      await waitFor(`!!document.querySelector('[data-port-conflict]')`, 5000, 'conflict bar')
      const bar = await text('[data-port-conflict]')
      check('Monitor shows the conflict notice naming port and holder', bar.includes('5173') && bar.includes('node.exe'), bar)
      await shot('v76-04-port-conflict')
      await evaluate(`document.querySelector('[data-port-conflict] button').click()`)
      await waitFor(`!!document.querySelector('[data-resources-dialog] [data-res-port="5173"]')`, 5000, 'ports tab')
      check('Show → Ports tab, row 5173 focused', (await evaluate(`${RES}.tab`)) === 'ports' && (await evaluate(`document.activeElement?.dataset?.resPort`)) === '5173')
      await esc()
      await waitFor(`!document.querySelector('[data-resources-dialog]')`, 3000, 'closed')
    })

    await step('stop', async () => {
      const bogus = await evaluate(`window.ccmDesktop.resKill([{ pid: 50030, start: '1400' }])`)
      check('IPC refuses an outside process (only report sessions / servers can be stopped)', bogus?.ok === false && bogus.error === 'gone', JSON.stringify(bogus))
      const bad = await evaluate(`window.ccmDesktop.resKill('nope')`)
      check('IPC refuses malformed targets', bad?.ok === false, JSON.stringify(bad))
      await evaluate(`${RES}.show('servers')`)
      await waitFor(`!!document.querySelector('[data-res-server="50001"] button')`, 5000, 'server stop')
      await click('[data-res-server="50001"] button')
      await waitFor(`!!document.querySelector('[data-res-message]')`, 8000, 'message')
      check('Stop one server → only its pid recorded (fixture, nothing real stopped)', JSON.stringify(killed()) === '[50001]' && /stopped/i.test(await text('[data-res-message]')), `${JSON.stringify(killed())} ${await text('[data-res-message]')}`)
      await esc()
      fixture({ withB: false })
      await pass('orphan', `(${RES}.report?.servers ?? []).some((s) => s.pid === 50001 && s.orphan)`)
      const orphan = await evaluate(`JSON.parse(JSON.stringify(${RES}.report.servers.find((s) => s.pid === 50001)))`)
      check('session B process gone → its shell becomes an orphan, forgotten at once', orphan.orphan && orphan.forgotten && orphan.sessionId === B, JSON.stringify(orphan))
      await evaluate(`${RES}.show('servers')`)
      await waitFor(`!!document.querySelector('[data-res-stop-all]:not([disabled])')`, 5000, 'stop all')
      check('Stop all names 2 forgotten (session A + orphan)', /2/.test(await text('[data-res-stop-all]')), await text('[data-res-stop-all]'))
      await shot('v76-05-orphan')
      fs.writeFileSync(KILLED, '')
      await click('[data-res-stop-all]')
      await waitFor(`/stopped/i.test(document.querySelector('[data-res-message]')?.textContent ?? '')`, 8000, 'stop all message')
      const k = killed().sort((x, y) => x - y)
      check('Stop all → session A + orphan only, never daemons / outside', JSON.stringify(k) === JSON.stringify([50001, sessions.a.pid].sort((x, y) => x - y)), JSON.stringify(k))
      check('fixture mode: real session process still alive', alive(sessions.a.pid))
      await esc()
      fixture()
    })

    await step('sensitive', async () => {
      await evaluate(`${UI}.setView('monitor')`)
      toolCall('b', 'Edit', { file_path: path.join(DIR_B, '.env'), old_string: 'A=1', new_string: 'A=2' })
      toolCall('b', 'Bash', { command: 'git push --force origin main' })
      await waitFor(`${S}.get('activity').items.filter((e) => e.kind === 'sensitive').length >= 2`, 15000, 'sensitive events')
      const ev = await evaluate(`JSON.parse(JSON.stringify(${S}.get('activity').items.filter((e) => e.kind === 'sensitive')))`)
      const rules = ev.map((e) => e.data.rule)
      check('Edit .env and git push --force flagged', rules.some((r) => /env/.test(r)) && rules.includes('git-force-push'), JSON.stringify(rules))
      check('no command text or file content in the events', !JSON.stringify(ev).includes('origin main') && !JSON.stringify(ev).includes('A=2'), JSON.stringify(ev.map((e) => e.data)))
      await evaluate(`${UI}.panels.sessions.open = true`)
      await waitFor(`!!document.querySelector('[data-card-sensitive]')`, 5000, 'card badge')
      check('session card badge counts 2', /2/.test(await text('[data-card-sensitive]')), await text('[data-card-sensitive]'))
      check('hit list folded until the badge is clicked', !(await evaluate(`!!document.querySelector('[data-card-sensitive-list]')`)))
      await click('[data-card-sensitive]')
      await waitFor(`document.querySelectorAll('[data-card-sensitive-list] [data-activity-sensitive]').length >= 2`, 5000, 'hit rows')
      check('badge unfolds the hits with shield icon + actions', (await evaluate(`document.querySelectorAll('[data-card-sensitive-list] [data-sensitive-actions]').length`)) >= 2)
      check('.env row offers Open file, git row does not', (await evaluate(`document.querySelectorAll('[data-sensitive-open]').length`)) === 1)
      await shot('v76-06-sensitive')
      const ignores = await evaluate(`document.querySelectorAll('[data-sensitive-ignore]').length`)
      await evaluate(`(() => { const rows = [...document.querySelectorAll('[data-sensitive-actions]')]; const r = rows.find((x) => !x.querySelector('[data-sensitive-open]')); r.querySelector('[data-sensitive-ignore]').click() })()`)
      await waitFor(`document.querySelectorAll('[data-sensitive-ignore]').length < ${ignores}`, 5000, 'ignored')
      await sleep(800)
      check('Ignore for project → stored in sensitive.json', fs.existsSync(path.join(DATA, 'sensitive.json')) && fs.readFileSync(path.join(DATA, 'sensitive.json'), 'utf8').includes('git-force-push'))
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-sensitive-settings]')`, 5000, 'settings')
      check('Settings: rule groups + ignored entry listed', (await evaluate(`document.querySelectorAll('[data-sensitive-group]').length`)) >= 5 && (await evaluate(`document.querySelectorAll('[data-sensitive-ignored]').length`)) === 1)
      await setInput('[data-sensitive-glob-input]', '*.secret')
      await click('[data-sensitive-glob-add]')
      await waitFor(`[...document.querySelectorAll('[data-sensitive-glob]')].some((e) => e.textContent.includes('*.secret'))`, 5000, 'glob added')
      check('own glob added', true)
      await evaluate(`document.querySelector('[data-sensitive-settings]').scrollIntoView()`)
      await shot('v76-07-sensitive-settings')
      await evaluate(`${UI}.settingsOpen = false`)
      await sleep(300)
      toolCall('b', 'Write', { file_path: path.join(DIR_B, 'keys.secret'), content: 'x' })
      await waitFor(`${S}.get('activity').items.some((e) => e.kind === 'sensitive' && e.data.rule === 'custom:*.secret')`, 15000, 'custom rule hit')
      check('Write of keys.secret flagged by the own glob', true)
    })

    await step('idle setting', async () => {
      await evaluate(`${UI}.settingsOpen = true`)
      const group = '[role="radiogroup"][aria-label="Forgotten after"]'
      await waitFor(`!!document.querySelector('${group}')`, 5000, 'idle control')
      const opts = await evaluate(`[...document.querySelectorAll('${group} [role="radio"]')].map((r) => r.textContent.trim() + (r.getAttribute('aria-checked') === 'true' ? '*' : ''))`)
      check('Notifications › Forgotten after: Off / 15 / 30 / 1 h* / 2 h / 4 h', opts.length === 6 && opts[3].endsWith('*'), JSON.stringify(opts))
      await radio(group, 1)
      await waitFor(`document.querySelectorAll('${group} [role="radio"]')[1].getAttribute('aria-checked') === 'true'`, 5000, '15 min')
      await pass('idle 15', `${RES}.report?.idleMinutes === 15`)
      check('collector applies 15 min to the next report', true)
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('${group}')`, 5000, 'idle control again')
      await radio(group, 3)
      await waitFor(`document.querySelectorAll('${group} [role="radio"]')[3].getAttribute('aria-checked') === 'true'`, 5000, 'back to 60')
      await evaluate(`${UI}.settingsOpen = false`)
    })

    await step('keep awake', async () => {
      await waitFor(`!!document.querySelector('[data-awake]')`, 10000, 'awake badge')
      let st = await evaluate(`window.ccmDesktop.awakeState()`)
      check('session B working, on AC, mode Only on power → holding (badge "working")', st?.holding === true && st.reason === 'working' && st.mode === 'plugged' && (await evaluate(`document.querySelector('[data-awake]').dataset.awake`)) === 'working', JSON.stringify(st))
      await shot('v76-08-awake')
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-setting="keep-awake"]')`, 5000, 'awake setting')
      await radio('[data-setting="keep-awake"]', 0)
      await waitFor(`!document.querySelector('[data-awake]')`, 5000, 'released')
      st = await evaluate(`window.ccmDesktop.awakeState()`)
      check('Off → blocker released, badge gone, saved', st?.holding === false && st.reason === 'off' && fs.readFileSync(path.join(DATA, 'keep-awake.json'), 'utf8').includes('off'), JSON.stringify(st))
      await radio('[data-setting="keep-awake"]', 1)
      await waitFor(`!!document.querySelector('[data-awake]')`, 5000, 'holding again')
      check('While agents run → holding again', (await evaluate(`window.ccmDesktop.awakeState()`))?.holding === true)
      await evaluate(`${UI}.settingsOpen = false`)
      setStatus('b', 'idle')
      await waitFor(`document.querySelector('[data-awake]')?.dataset.awake === 'grace'`, 15000, 'grace')
      check('nothing working → grace period keeps holding', (await evaluate(`window.ccmDesktop.awakeState()`))?.holding === true)
      await waitFor(`!document.querySelector('[data-awake]')`, 10000, 'released after grace')
      st = await evaluate(`window.ccmDesktop.awakeState()`)
      check('after the grace → released (idle)', st?.holding === false && st.reason === 'idle', JSON.stringify(st))
      await radio('[data-setting="keep-awake"]', 2).catch(() => evaluate(`window.ccmDesktop.awakeMode('plugged')`))
      await evaluate(`window.ccmDesktop.awakeMode('plugged')`)
    })

    await step('capture folder', async () => {
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-capture-settings]')`, 5000, 'capture settings')
      check('no folder at first (as before)', !(await evaluate(`!!document.querySelector('[data-capture-clear]')`)))
      const none = await evaluate(`window.ccmDesktop.captureShot({ png: ${JSON.stringify(PNG)}, device: 'Pixel' })`)
      check('attach as file without a folder → no-dir', none?.ok === false && none.error === 'no-dir', JSON.stringify(none))
      fs.mkdirSync(CAPDIR, { recursive: true })
      await click('[data-capture-choose]')
      await waitFor(`!!document.querySelector('[data-capture-clear]')`, 5000, 'dir set')
      check('Choose → folder shown', (await text('[data-capture-dir]')) === CAPDIR, await text('[data-capture-dir]'))
      check('attach-as-file on by default, retention 7 days / 2 GB controls', (await evaluate(`document.querySelector('[data-capture-as-file] [role="switch"]').getAttribute('aria-checked')`)) === 'true' && (await evaluate(`!!document.querySelector('[data-capture-keep] [aria-checked="true"]') && !!document.querySelector('[data-capture-max] [aria-checked="true"]')`)))
      await evaluate(`document.querySelector('[data-capture-settings]').scrollIntoView()`)
      await shot('v76-09-capture')
      const shotRes = await evaluate(`window.ccmDesktop.captureShot({ png: ${JSON.stringify(PNG)}, device: '../evil device', frame: 2 })`)
      const shotsDir = path.join(CAPDIR, 'shots')
      const name = shotRes?.ok ? path.basename(shotRes.path) : ''
      check('screenshot written to <dir>/shots with an Orrery name, device sanitised', shotRes?.ok === true && path.dirname(shotRes.path) === shotsDir && /^[A-Za-z0-9._-]+-\d{8}-\d{6}(-\d+)?-f2\.png$/.test(name) && !name.includes('..'), JSON.stringify(shotRes))
      check('PNG bytes on disk', shotRes?.ok && fs.readFileSync(shotRes.path).subarray(1, 4).toString() === 'PNG')
      const notPng = await evaluate(`window.ccmDesktop.captureShot({ png: 'data:image/png;base64,${Buffer.from('hello').toString('base64')}', device: 'x' })`)
      check('non-PNG data refused', notPng?.ok === false, JSON.stringify(notPng))
      await evaluate(`document.querySelector('[data-capture-as-file] [role="switch"]').click()`)
      await waitFor(`document.querySelector('[data-capture-as-file] [role="switch"]').getAttribute('aria-checked') === 'false'`, 5000, 'as-file off')
      check('as-file toggle saved', (await evaluate(`window.ccmDesktop.captureGet()`))?.config.asFile === false)
      await radio('[data-capture-keep]', 0)
      await sleep(300)
      const cfg = (await evaluate(`window.ccmDesktop.captureGet()`))?.config
      check('retention days change saved', cfg && cfg.keepDays !== 7, JSON.stringify(cfg))
      await click('[data-capture-clear]')
      await waitFor(`!document.querySelector('[data-capture-clear]')`, 5000, 'cleared')
      check('Clear → no folder, files left on disk', (await evaluate(`window.ccmDesktop.captureGet()`))?.config.dir === null && fs.existsSync(shotRes.path))
      await evaluate(`${UI}.settingsOpen = false`)
    })

    await step('phone', async () => {
      await evaluate(`window.__phoneEv = []; window.ccmDesktop.onPhone((e) => window.__phoneEv.push(e))`)
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-phone-settings]')`, 5000, 'phone settings')
      check('off by default, not configured, Send test disabled', (await evaluate(`document.querySelector('[data-phone-enable] [role="switch"]').getAttribute('aria-checked')`)) === 'false' && (await evaluate(`document.querySelector('[data-phone-test]').disabled`)))
      const guide = await evaluate(`(() => { const g = document.querySelector('[data-phone-guide]'); return g && { open: g.open, channel: g.dataset.phoneGuideChannel, steps: g.querySelectorAll('[data-phone-guide-step]').length, stores: [...g.querySelectorAll('[data-phone-store]')].map((b) => b.dataset.phoneStore) } })()`)
      check('ntfy setup guide open while not configured: 5 steps + Play / App Store buttons', guide?.open === true && guide.channel === 'ntfy' && guide.steps === 5 && JSON.stringify(guide.stores) === '["play","ios"]', JSON.stringify(guide))
      check('no QR before a topic is typed', !(await evaluate(`!!document.querySelector('[data-phone-qr]')`)))
      await click('[data-phone-generate]')
      await waitFor(`!!document.querySelector('[data-phone-qr-tile] svg')`, 5000, 'qr')
      const gen = await evaluate(`({ v: document.querySelector('[data-phone-topic]').value, type: document.querySelector('[data-phone-topic]').type, copy: !document.querySelector('[data-phone-copy-topic]').disabled })`)
      check('Generate random topic → orrery- + 16 [a-z0-9], shown in clear, Copy enabled', /^orrery-[a-z0-9]{16}$/.test(gen.v) && gen.type === 'text' && gen.copy, JSON.stringify(gen))
      const gen2 = await (async () => { await click('[data-phone-generate]'); return evaluate(`document.querySelector('[data-phone-topic]').value`) })()
      check('a second Generate gives a different topic', gen2 !== gen.v && /^orrery-[a-z0-9]{16}$/.test(gen2))
      check('subscribe QR shown for the unsaved topic', await evaluate(`!!document.querySelector('[data-phone-qr-tile] svg')`))
      await setInput('[data-phone-server]', SECRET_SERVER)
      await setInput('[data-phone-topic]', SECRET_TOPIC)
      await evaluate(`document.querySelector('[data-phone-guide]').scrollIntoView()`)
      await shot('v76-10a-phone-guide')
      await click('[data-phone-save]')
      await waitFor(`/ntfy\\.example\\.org/.test(document.querySelector('[data-phone-status]')?.textContent ?? '')`, 5000, 'configured')
      const state = await evaluate(`window.ccmDesktop.phoneState()`)
      check('saved: page sees only the host, never the topic / path', state?.configured && !JSON.stringify(state).includes(SECRET_TOPIC) && !JSON.stringify(state).includes('private-base') && !(await evaluate(`document.body.innerHTML.includes(${JSON.stringify(SECRET_TOPIC)})`)), JSON.stringify(state))
      const file = fs.readFileSync(path.join(DATA, 'phone.json'), 'utf8')
      check('phone.json keeps the topic sealed (not plain text)', !file.includes(SECRET_TOPIC) && !file.includes('private-base'))
      await click('[data-phone-test]')
      await waitFor(`!!document.querySelector('[data-phone-note]')`, 15000, 'test note')
      const hit = phoneHits.at(-1)
      let body = {}
      try { body = JSON.parse(hit.body) } catch {}
      check('Send test reaches the receiver as ntfy JSON', hit?.method === 'POST' && body.topic === SECRET_TOPIC && /Orrery/.test(body.message ?? '') && !(await evaluate(`document.querySelector('[data-phone-note]').classList.contains('text-st-error')`)), hit?.body)
      check('after Save: topic field empty, QR gone, guide folded', await evaluate(`document.querySelector('[data-phone-topic]').value === '' && !document.querySelector('[data-phone-qr]') && !document.querySelector('[data-phone-guide]').open`))
      check('test OK → ntfy "did your phone get it" hint', /ntfy app/i.test(await text('[data-phone-test-hint]')), await text('[data-phone-test-hint]'))
      await shot('v76-10-phone')
      await radio('[data-phone-channel]', 1)
      await waitFor(`document.querySelector('[data-phone-guide]')?.dataset.phoneGuideChannel === 'discord'`, 5000, 'discord guide')
      const dg = await evaluate(`({ steps: [...document.querySelectorAll('[data-phone-guide-step]')].map((s) => s.textContent.trim()), stores: document.querySelectorAll('[data-phone-store]').length, qr: !!document.querySelector('[data-phone-qr]'), hint: !!document.querySelector('[data-phone-test-hint]') })`)
      check('Discord guide: 5 steps incl. Integrations › Webhooks, no store buttons / QR, old hint cleared', dg.steps.length === 5 && dg.steps.some((s) => /Integrations.*Webhooks/.test(s)) && dg.stores === 0 && !dg.qr && !dg.hint, JSON.stringify(dg))
      await radio('[data-phone-channel]', 0)
      await waitFor(`document.querySelector('[data-phone-guide]')?.dataset.phoneGuideChannel === 'ntfy' && /ntfy\\.example\\.org/.test(document.querySelector('[data-phone-status]')?.textContent ?? '')`, 5000, 'back to ntfy')

      await evaluate(`document.querySelector('[data-phone-enable] [role="switch"]').click()`)
      await waitFor(`document.querySelector('[data-phone-enable] [role="switch"]').getAttribute('aria-checked') === 'true'`, 5000, 'enabled')
      await evaluate(`${UI}.settingsOpen = false`)
      const n = phoneHits.length
      setStatus('b', 'waiting')
      const end = Date.now() + 20000
      while (phoneHits.length === n && Date.now() < end) await sleep(250)
      if (phoneHits.length === n) console.log('  diag: ' + (await evaluate(`JSON.stringify({ t: Object.values(${TERMS}.byId).map((t) => [t.cwd, t.status, t.statusSince]), p: null })`)) + ' ' + JSON.stringify(await evaluate(`window.ccmDesktop.phoneState()`)))
      const ep = phoneHits[n]
      let eb = {}
      try { eb = JSON.parse(ep?.body ?? '{}') } catch {}
      check('session waiting + machine idle → one phone message', !!ep && /approval|waiting|input/i.test(`${eb.message}`) && /busy-app|busy-session/.test(`${eb.title}`), ep?.body)
      check('payload has no paths, prompts or commands', !!ep && !ep.body.includes(FAKE.replace(/\\/g, '\\\\')) && !ep.body.includes(FAKE) && !/hello|git push|\.env/.test(ep.body), ep?.body)

      phoneDown = true
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-phone-test]')`, 5000, 'test button')
      await click('[data-phone-test]')
      await waitFor(`!!document.querySelector('[data-phone-note].text-st-error')`, 15000, 'fail note')
      await sleep(400)
      await click('[data-phone-test]')
      await sleep(1500)
      const fails = await evaluate(`window.__phoneEv.filter((e) => 'failed' in e).length`)
      check('receiver down → error note, failure notice raised once for two failures', fails === 1, `failed events ${fails}`)
      await evaluate(`${UI}.settingsOpen = false`)
      await waitFor(`!!document.querySelector('[data-phone-fail]')`, 5000, 'fail toast')
      check('in-app failure notice shown', true)
      await shot('v76-11-phone-fail')
      phoneDown = false
      await evaluate(`window.ccmDesktop.phoneSet({ enabled: false })`)
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await shot('v76-99-error').catch(() => {})
  } finally {
    app.stop()
    server.close()
    for (const c of sleepers) try { c.kill() } catch {}
    fs.writeFileSync(path.join(OUT, 'results-v76.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    try { fs.rmSync(FAKE, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
