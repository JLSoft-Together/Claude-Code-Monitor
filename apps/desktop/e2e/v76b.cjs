// v76 R7 "Agent data" against fakes only: CLAUDE_CONFIG_DIR / CODEX_HOME are temp folders named .claude / .codex,
// CCM_E2E_AGENT_TARGET / CCM_E2E_AGENT_BACKUP replace the folder dialogs, CCM_E2E_AGENT_PROCS replaces the process
// table (so this machine's real claude.exe does not block the move). Native confirms are answered by patching
// dialog.showMessageBox over the main inspector, as in v76.cjs. The real ~/.claude and ~/.codex are never touched.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT, REPO } = require('./cdp.cjs')
const WS = require(path.join(REPO, 'node_modules/ws'))
const INSPECT = Number(process.env.CCM_E2E_INSPECT) || (Number(process.env.CCM_E2E_DBG) || 9333) + 8
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const UI = `${S}.get('ui')`
const TERMS = `${S}.get('terminals')`
const VERSION = require('../package.json').version
const DATA = path.join(OUT, 'run', 'data')
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v76b-')))
const HOME = path.join(FAKE, 'home')
const CONFIG = path.join(HOME, '.claude')
const CODEX = path.join(HOME, '.codex')
const TARGET = path.join(FAKE, 'drive-L')
const MOVED = path.join(TARGET, '.claude')
const BACKUP = path.join(FAKE, 'backup')
const OUTSIDE = path.join(FAKE, 'outside-skill')
const PROCS = path.join(FAKE, 'agent-procs.json')
const PROJECT = path.join(FAKE, 'proj')
const DAY = 86_400_000
const B64 = 'iVBORw0KGgo'.padEnd(6000, 'Q')

const write = (file, data, ageMs = 0) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(file, t, t) }
}
const line = (o) => `${JSON.stringify(o)}\n`
const slug = (cwd) => path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
const linkOf = (p) => { try { return fs.lstatSync(p).isSymbolicLink() ? fs.realpathSync(p) : null } catch { return null } }
const procs = (list) => fs.writeFileSync(PROCS, JSON.stringify(list))

const sleepers = []
let live = null
function seed() {
  const OLD = 'aaaaaaaa-1111-4222-8333-444444444444'
  write(path.join(CONFIG, 'projects', slug(PROJECT), `${OLD}.jsonl`),
    line({ type: 'user', sessionId: OLD, cwd: PROJECT, timestamp: new Date(Date.now() - 40 * DAY).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: B64 } }] } }) +
    line({ type: 'assistant', sessionId: OLD, message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'x.png' } }] } }) +
    line({ type: 'user', sessionId: OLD, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: B64 } }] }] }, toolUseResult: { type: 'image', file: { base64: B64, type: 'image/jpeg', originalSize: 4500 } } }),
    40 * DAY)
  write(path.join(CONFIG, 'settings.json'), '{"model":"opus"}')
  write(path.join(CONFIG, '.credentials.json'), '{"fake":true}')
  write(path.join(CONFIG, 'debug', 'old.log'), 'x'.repeat(5000), 40 * DAY)
  write(path.join(CONFIG, 'debug', 'new.log'), 'y', 60 * 60 * 1000)
  write(path.join(CONFIG, '.caveman-active.1'), '1')
  write(path.join(OUTSIDE, 'SKILL.md'), '# outside')
  fs.mkdirSync(path.join(CONFIG, 'skills'), { recursive: true })
  fs.symlinkSync(OUTSIDE, path.join(CONFIG, 'skills', 'linked'), 'junction')
  write(path.join(CODEX, 'sessions', '2026', '10', '01', 'rollout-2026-10-01T00-00-00-x.jsonl'), '{}\n')
  write(path.join(CODEX, 'auth.json'), '{"fake":true}')
  write(path.join(CODEX, 'cache', 'c.json'), '{}', 40 * DAY)
  // One live session (an idle node process) so the collector has something to read through the link after the move.
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { stdio: 'ignore' })
  sleepers.push(child)
  const sid = require('node:crypto').randomUUID()
  fs.mkdirSync(PROJECT, { recursive: true })
  live = { pid: child.pid, sid }
  write(path.join(CONFIG, 'projects', slug(PROJECT), `${sid}.jsonl`), line({ type: 'user', timestamp: new Date().toISOString(), cwd: PROJECT, sessionId: sid, message: { role: 'user', content: 'hello' } }))
  registry('idle')
  fs.mkdirSync(TARGET, { recursive: true })
  procs([])
}
function registry(status) {
  const now = Date.now()
  write(path.join(CONFIG, 'sessions', `${live.pid}.json`), JSON.stringify({ pid: live.pid, sessionId: live.sid, cwd: PROJECT, startedAt: now - 60_000, version: '2.1.294', kind: 'interactive', entrypoint: 'cli', name: 'agentdata-e2e', nameSource: 'derived', status, waitingFor: status === 'waiting' ? 'permission prompt' : undefined, updatedAt: now, statusUpdatedAt: now }))
}

async function mainInspector() {
  let list = null
  for (let i = 0; i < 40 && !list; i++) {
    list = await new Promise((r) => http.get(`http://127.0.0.1:${INSPECT}/json/list`, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { r(JSON.parse(b)) } catch { r(null) } }) }).on('error', () => r(null)))
    if (!list) await new Promise((r) => setTimeout(r, 250))
  }
  if (!list?.[0]) throw new Error('no main inspector')
  const ws = new WS(list[0].webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j) })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  const evaluate = (expression) => new Promise((r) => { const i = ++id; pending.set(i, (m) => r(m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description ?? null)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, returnByValue: true, awaitPromise: true } })) })
  const ok = await evaluate(`(() => { const req = typeof require === 'function' ? require : process.mainModule.require; const { dialog } = req('electron'); globalThis.__e2eAnswer = 0; globalThis.__e2eAsked = []; dialog.showMessageBox = async (...a) => { const o = a.find((x) => x && typeof x === 'object' && 'message' in x) || {}; globalThis.__e2eAsked.push(String(o.message) + ' ' + String(o.detail ?? '') + ' [' + (o.buttons ?? []).join('|') + ']'); return { response: globalThis.__e2eAnswer, checkboxChecked: false } }; return 'patched' })()`)
  if (ok !== 'patched') throw new Error('patch failed: ' + ok)
  return { answer: (n) => evaluate(`globalThis.__e2eAnswer = ${n}`), asked: () => evaluate(`globalThis.__e2eAsked.slice()`), close: () => ws.close() }
}

const env = () => ({
  CLAUDE_CONFIG_DIR: CONFIG,
  CODEX_HOME: CODEX,
  CCM_CODEX: '0',
  CCM_VERIFY_PROCESSES: '0',
  CCM_E2E_AGENT_PROCS: PROCS,
  CCM_E2E_AGENT_TARGET: TARGET,
  CCM_E2E_AGENT_BACKUP: BACKUP,
})

async function session(app, keep) {
  const { evaluate, waitFor, cmd } = app
  await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
  if (!keep) {
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
  }
  await evaluate(`${UI}.settingsOpen = true`)
  await waitFor(`!!document.querySelector('[data-agentdata] [data-agentdata-measure]')`, 15000, 'agent data section')
  const insp = await mainInspector()
  return insp
}

async function main() {
  try {
    seed()
  } catch (e) {
    check('fixtures', false, e.message)
    return
  }
  let app = await launch({ env: env(), args: [`--inspect=${INSPECT}`] })
  let insp = null
  const ctx = () => {
    const { evaluate, waitFor, shot, sleep } = app
    const click = (sel) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.scrollIntoView({ block: 'center' }); b.click() })()`)
    const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
    const idle = () => waitFor(`!document.querySelector('[data-agentdata-progress]') && !document.querySelector('[data-agentdata-measure]').disabled`, 90000, 'task done')
    const note = async () => { await idle(); return { kind: await evaluate(`document.querySelector('[data-agentdata-note]')?.dataset.agentdataNote ?? null`), text: await text('[data-agentdata-note]') } }
    return { evaluate, waitFor, shot, sleep, click, text, idle, note }
  }
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await app.shot(`v76b-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
    }
  }
  try {
    insp = await session(app, false)
    const { evaluate, waitFor, shot, sleep, click, text, idle, note } = ctx()
    await waitFor(`Object.values(${TERMS}.byId).some((t) => t.cwd && t.cwd.toLowerCase() === ${JSON.stringify(PROJECT.toLowerCase())})`, 20000, 'fake session listed')
    check('fake live session listed before the move', true)

    await step('measure', async () => {
      check('Claude desktop app row hidden in E2E (real %APPDATA% not scanned)', !(await evaluate(`!!document.querySelector('[data-agentdata-agent="claudeApp"]')`)))
      await click('[data-agentdata-measure]')
      await idle()
      await waitFor(`!!document.querySelector('[data-agentdata-agent="claude"] [data-agentdata-group="transcripts"]')`, 15000, 'groups')
      const kinds = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-agentdata-group]')].map((g) => [g.closest('[data-agentdata-agent]').dataset.agentdataAgent + ':' + g.dataset.agentdataGroup, g.dataset.kind + (g.querySelector('[data-agentdata-pick]') ? '+pick' : '')]))`)
      check('groups classified: transcripts history, credentials config, debug logs cleanable, unknown not cleanable',
        kinds['claude:transcripts'] === 'history' && kinds['claude:credentials'] === 'config' && kinds['claude:debugLogs'] === 'cache+pick' && kinds['claude:unknown'] === 'unknown' && kinds['claude:extensions'] === 'config', JSON.stringify(kinds))
      check('codex groups: rollouts history, sign-in config, cache cleanable', kinds['codex:rollouts'] === 'history' && kinds['codex:codexCredentials'] === 'config' && kinds['codex:codexCache'] === 'cache+pick', JSON.stringify(kinds))
      check('nested junction shown as a link, not walked', await evaluate(`!!document.querySelector('[data-agentdata-agent="claude"] [data-agentdata-group="extensions"] svg')`))
      check('totals shown', /KB|MB/.test(await text('[data-agentdata-agent="claude"] [data-agentdata-total]')), await text('[data-agentdata-agent="claude"] [data-agentdata-total]'))
      await shot('v76b-01-measured')
    })

    await step('clean', async () => {
      await click('[data-agentdata-agent="claude"] [data-agentdata-group="debugLogs"] [data-agentdata-pick]')
      await insp.answer(1)
      await click('[data-agentdata-agent="claude"] [data-agentdata-clean]')
      const n1 = await note()
      check('clean cancelled at the confirm → nothing deleted', n1.kind === 'error' && fs.existsSync(path.join(CONFIG, 'debug', 'old.log')), JSON.stringify(n1))
      await insp.answer(0)
      await click('[data-agentdata-agent="claude"] [data-agentdata-clean]')
      const n2 = await note()
      const asked = (await insp.asked()).at(-1) ?? ''
      check('clean deletes the 40-day log, keeps the 1-hour one', n2.kind === 'ok' && !fs.existsSync(path.join(CONFIG, 'debug', 'old.log')) && fs.existsSync(path.join(CONFIG, 'debug', 'new.log')), JSON.stringify(n2))
      check('clean confirm names the group and the 24 h rule', /Debug logs/.test(asked) && /24 hours/.test(asked), asked)
      check('transcripts / settings untouched by clean', fs.existsSync(path.join(CONFIG, 'settings.json')) && fs.readdirSync(path.join(CONFIG, 'projects', slug(PROJECT))).length === 2)
    })

    await step('strip', async () => {
      const file = path.join(CONFIG, 'projects', slug(PROJECT), 'aaaaaaaa-1111-4222-8333-444444444444.jsonl')
      const mtime = fs.statSync(file).mtimeMs
      await evaluate(`document.querySelector('[data-agentdata-strip]').open = true`)
      await insp.answer(0)
      await click('[data-agentdata-strip-run]')
      const n = await note()
      const asked = (await insp.asked()).at(-1) ?? ''
      const now = fs.readFileSync(file, 'utf8')
      const lines = now.trim().split('\n')
      const backups = fs.existsSync(BACKUP) ? fs.readdirSync(BACKUP) : []
      const orig = backups[0] ? fs.readFileSync(path.join(BACKUP, backups[0], slug(PROJECT), 'aaaaaaaa-1111-4222-8333-444444444444.jsonl'), 'utf8') : ''
      check('strip: images replaced, every line still JSON, 3 lines', n.kind === 'ok' && !now.includes(B64) && lines.length === 3 && lines.every((l) => { try { JSON.parse(l); return true } catch { return false } }), JSON.stringify(n))
      check('strip: original copied to the backup folder first', orig.includes(B64), backups.join(','))
      check('strip: live session transcript not touched; mtime kept', fs.readFileSync(path.join(CONFIG, 'projects', slug(PROJECT), `${live.sid}.jsonl`), 'utf8').includes('hello') && Math.abs(fs.statSync(file).mtimeMs - mtime) < 2000)
      check('strip confirm warns that resume loses the images', /no longer sees the removed images/.test(asked), asked)
    })

    await step('move refused while claude runs', async () => {
      procs([{ pid: 4242, name: 'claude.exe' }])
      await click('[data-agentdata-agent="claude"] [data-agentdata-move]')
      const n = await note()
      check('move refused, naming the running process', n.kind === 'error' && /claude\.exe \(4242\)/.test(n.text) && !linkOf(CONFIG) && !fs.existsSync(MOVED), n.text)
      procs([])
    })

    await step('move', async () => {
      await insp.answer(0)
      await click('[data-agentdata-agent="claude"] [data-agentdata-move]')
      const n = await note()
      await waitFor(`!!document.querySelector('[data-agentdata-agent="claude"] [data-agentdata-moved]')`, 20000, 'moved row')
      const moved = fs.readdirSync(HOME).find((x) => x.startsWith('.claude.orrery-moved-'))
      check('move: old path is now a link to the new place', n.kind === 'ok' && linkOf(CONFIG) === fs.realpathSync(MOVED), JSON.stringify(n))
      check('move: original kept as .claude.orrery-moved-<ts>', !!moved && fs.existsSync(path.join(HOME, moved, 'settings.json')), moved)
      check('move: nested junction copied as a link, its target untouched', linkOf(path.join(MOVED, 'skills', 'linked')) === fs.realpathSync(OUTSIDE) && fs.existsSync(path.join(OUTSIDE, 'SKILL.md')))
      check('move: data readable through the old path', fs.readFileSync(path.join(CONFIG, 'settings.json'), 'utf8') === '{"model":"opus"}')
      const asked = (await insp.asked()).at(-1) ?? ''
      check('move confirm explains copy, check, link, keep original', /checked/.test(asked) && /orrery-moved-/.test(asked) && /Delete original/.test(asked), asked.slice(0, 200))
      await waitFor(`${S}.get('connection').state === 'connected'`, 30000, 'collector back')
      registry('waiting')
      await waitFor(`Object.values(${TERMS}.byId).some((t) => t.cwd && t.cwd.toLowerCase() === ${JSON.stringify(PROJECT.toLowerCase())} && t.status === 'waiting')`, 30000, 'status through link')
      check('collector restarted and reads the session through the link', true)
      await shot('v76b-02-moved')
    })

    await step('undo with copy back', async () => {
      write(path.join(CONFIG, 'after-move.txt'), 'new')
      await insp.answer(0)
      await click('[data-agentdata-agent="claude"] [data-agentdata-undo]')
      const n = await note()
      const asked = (await insp.asked()).at(-1) ?? ''
      check('undo: link gone, original back, file written after the move copied back', n.kind === 'ok' && !linkOf(CONFIG) && fs.readFileSync(path.join(CONFIG, 'after-move.txt'), 'utf8') === 'new' && !fs.readdirSync(HOME).some((x) => x.includes('orrery-moved')), JSON.stringify(n))
      check('undo confirm offers copying back the new files', /copy back/i.test(asked), asked.slice(-120))
      check('undo keeps the copy at the new place', fs.existsSync(path.join(MOVED, 'settings.json')))
    })

    await step('target exists, then move + delete original + undo', async () => {
      await insp.answer(0)
      await click('[data-agentdata-agent="claude"] [data-agentdata-move]')
      const e = await note()
      check('move refused when the target folder already exists', e.kind === 'error' && /already exists/.test(e.text) && !linkOf(CONFIG), e.text)
      fs.rmSync(MOVED, { recursive: true, force: true })
      check('outside junction target survived removing the copy', fs.existsSync(path.join(OUTSIDE, 'SKILL.md')))
      await click('[data-agentdata-agent="claude"] [data-agentdata-move]')
      const m = await note()
      check('second move ok', m.kind === 'ok' && !!linkOf(CONFIG), m.text)
      await click('[data-agentdata-agent="claude"] [data-agentdata-delete]')
      const d = await note()
      check('delete original removes .claude.orrery-moved-*', d.kind === 'ok' && !fs.readdirSync(HOME).some((x) => x.includes('orrery-moved')) && fs.existsSync(path.join(OUTSIDE, 'SKILL.md')), d.text)
      check('after delete: row says original deleted, no delete button', /Original deleted/.test(await text('[data-agentdata-agent="claude"]')) && !(await evaluate(`!!document.querySelector('[data-agentdata-delete]')`)))
      await click('[data-agentdata-agent="claude"] [data-agentdata-undo]')
      const u = await note()
      check('undo after delete copies everything back', u.kind === 'ok' && !linkOf(CONFIG) && fs.existsSync(path.join(CONFIG, 'projects', slug(PROJECT), `${live.sid}.jsonl`)) && linkOf(path.join(CONFIG, 'skills', 'linked')) === fs.realpathSync(OUTSIDE), u.text)
      await shot('v76b-03-undone')
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await app.shot('v76b-99-error').catch(() => {})
  } finally {
    insp?.close()
    app.stop()
  }

  // A crash between rename and link: the next start puts the original back before the collector runs.
  try {
    await new Promise((r) => setTimeout(r, 1500))
    fs.rmSync(MOVED, { recursive: true, force: true })
    const backup = path.join(HOME, '.claude.orrery-moved-123')
    fs.renameSync(CONFIG, backup)
    write(path.join(DATA, 'agent-data-move.json'), JSON.stringify({ version: 1, moves: [{ agent: 'claude', source: CONFIG, target: MOVED, backup, at: 123, phase: 'switching', originalDeleted: false }] }))
    write(path.join(MOVED, 'partial.txt'), 'half')
    app = await launch({ env: env(), args: [`--inspect=${INSPECT}`], keep: true })
    insp = await session(app, true)
    const { evaluate, waitFor, click, note, shot } = ctx()
    check('interrupted move rolled back at start', fs.existsSync(path.join(CONFIG, 'settings.json')) && !fs.existsSync(backup) && !linkOf(CONFIG))
    await waitFor(`!!document.querySelector('[data-agentdata-recovered]') && !!document.querySelector('[data-agentdata-interrupted]')`, 10000, 'recovered notice')
    check('page shows the rollback and the partial copy', true)
    await shot('v76b-04-recovered')
    await insp.answer(0)
    await click('[data-agentdata-discard]')
    const n = await note()
    check('discard deletes only the partial copy', n.kind === 'ok' && !fs.existsSync(MOVED) && fs.existsSync(path.join(CONFIG, 'settings.json')) && !(await evaluate(`!!document.querySelector('[data-agentdata-interrupted]')`)), n.text)
  } catch (e) {
    check('recovery', false, e.message)
    await app.shot('v76b-98-error').catch(() => {})
  } finally {
    insp?.close()
    app.stop()
    for (const c of sleepers) try { c.kill() } catch {}
    fs.writeFileSync(path.join(OUT, 'results-v76b.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    try { fs.rmSync(FAKE, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
