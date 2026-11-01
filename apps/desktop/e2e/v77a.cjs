// v77 R8 "Clean build output" and R9 "Low disk" against fakes only: projects are temp folders (one git repo, one plain),
// CCM_E2E_DISK replaces statfs with a JSON file `{ free, total }`, native confirms are answered by patching
// dialog.showMessageBox over the main inspector (as in v76b.cjs). No real folder of this machine is measured for deletion.
const { spawn, spawnSync } = require('node:child_process')
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
const GB = 1024 ** 3
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v77a-')))
const CONFIG = path.join(FAKE, 'home', '.claude')
const CODEX = path.join(FAKE, 'home', '.codex')
const GIT = path.join(FAKE, 'gitproj')
const PLAIN = path.join(FAKE, 'plainproj')
const OUTSIDE = path.join(FAKE, 'outside')
const DISK = path.join(FAKE, 'disk.json')

const write = (file, data = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data) }
const line = (o) => `${JSON.stringify(o)}\n`
const slug = (cwd) => path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
const disk = (freeGb) => fs.writeFileSync(DISK, JSON.stringify({ free: freeGb * GB, total: 500 * GB }))
const sleepers = []

function seed() {
  write(path.join(GIT, '.gitignore'), 'node_modules/\nbuild/\n')
  write(path.join(GIT, 'package.json'), '{}')
  write(path.join(GIT, 'node_modules', 'left-pad', 'index.js'), 'y'.repeat(300_000))
  write(path.join(GIT, 'app', 'build.gradle'), '')
  write(path.join(GIT, 'app', 'build', 'out.class'), 'z'.repeat(50_000))
  write(path.join(GIT, 'dist', 'app.js'), 'tracked build output')
  write(path.join(GIT, 'src', 'main.ts'), 'keep me')
  write(path.join(OUTSIDE, 'node_modules', 'keep.js'), 'outside')
  fs.symlinkSync(OUTSIDE, path.join(GIT, 'linked'), 'junction')
  const git = (...a) => spawnSync('git', ['-C', GIT, ...a], { encoding: 'utf8' })
  if (git('init', '-q').status !== 0) throw new Error('git init failed')
  git('add', '.gitignore', 'package.json', 'src', 'dist', 'app/build.gradle')
  write(path.join(PLAIN, 'package.json'), '{}')
  write(path.join(PLAIN, 'node_modules', 'a.js'), 'n'.repeat(20_000))
  write(path.join(PLAIN, 'out', 'bundle.js'), 'o'.repeat(10_000))
  write(path.join(PLAIN, 'target', 'not-cargo.txt'), 'no Cargo.toml: never offered')
  write(path.join(CONFIG, 'settings.json'), '{}')
  fs.mkdirSync(CODEX, { recursive: true })
  // A live session in the plain project: makes it a known project and blocks its clean.
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e9)'], { stdio: 'ignore' })
  sleepers.push(child)
  const sid = require('node:crypto').randomUUID()
  write(path.join(CONFIG, 'projects', slug(PLAIN), `${sid}.jsonl`), line({ type: 'user', timestamp: new Date().toISOString(), cwd: PLAIN, sessionId: sid, message: { role: 'user', content: 'hello' } }))
  const now = Date.now()
  write(path.join(CONFIG, 'sessions', `${child.pid}.json`), JSON.stringify({ pid: child.pid, sessionId: sid, cwd: PLAIN, startedAt: now - 60_000, version: '2.1.294', kind: 'interactive', entrypoint: 'cli', name: 'build-e2e', nameSource: 'derived', status: 'idle', updatedAt: now, statusUpdatedAt: now }))
  disk(5)
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

async function main() {
  try {
    seed()
  } catch (e) {
    check('fixtures', false, e.message)
    return
  }
  const app = await launch({ env: { CLAUDE_CONFIG_DIR: CONFIG, CODEX_HOME: CODEX, CCM_CODEX: '0', CCM_VERIFY_PROCESSES: '0', CCM_E2E_DISK: DISK }, args: [`--inspect=${INSPECT}`] })
  let insp = null
  const { evaluate, waitFor, shot, cmd } = app
  const click = (sel) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.scrollIntoView({ block: 'center' }); b.click() })()`)
  const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  const idle = () => waitFor(`!document.querySelector('[data-build-progress]') && !document.querySelector('[data-build-measure]')?.disabled`, 60000, 'build task done')
  const note = async () => { await idle(); return { kind: await evaluate(`document.querySelector('[data-build-note]')?.dataset.buildNote ?? null`), text: await text('[data-build-note]') } }
  const rels = (proj) => evaluate(`[...document.querySelectorAll('[data-build-project=${JSON.stringify(proj)}] [data-build-dir]')].map((d) => d.dataset.buildDir + ':' + d.dataset.kind)`)
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v77a-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
    }
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    insp = await mainInspector()

    await step('disk badge', async () => {
      await waitFor(`!!document.querySelector('[data-disk-badge="warn"]')`, 20000, 'warn badge')
      check('low disk badge shows at start (5 GB free < 10 GB)', /low/.test(await evaluate(`document.querySelector('[data-disk-badge]').getAttribute('aria-label')`)))
      await click('[data-disk-badge]')
      await waitFor(`!!document.querySelector('[data-disk-popover] [data-disk-drive]')`, 5000, 'popover')
      const places = await text('[data-disk-popover] [data-disk-drive]')
      check('popover: drive with level, free / total and places', /Running low/.test(places) && /Claude Code/.test(places) && /Orrery data/.test(places), places)
      await shot('v77a-01-disk-popover')
      disk(1)
      await click('[data-disk-refresh]')
      await waitFor(`!!document.querySelector('[data-disk-badge="danger"]')`, 10000, 'danger badge')
      check('measure again: under 2 GB turns the badge critical', await evaluate(`document.querySelector('[data-disk-drive]').dataset.level === 'danger'`))
      await click('[data-disk-popover] [data-disk-clean]')
      await waitFor(`!!document.querySelector('[data-build-clean]')`, 10000, 'dialog from popover')
      check('"Clean build output…" opens the dialog', !(await evaluate(`!!document.querySelector('[data-disk-popover]')`)))
      await evaluate(`${UI}.buildClean = null`)
      disk(30)
      await evaluate(`${S}.get('disk').refresh()`)
      await waitFor(`!document.querySelector('[data-disk-badge]')`, 10000, 'badge gone')
      check('badge hidden once there is enough space again', true)
    })

    await step('disk threshold setting', async () => {
      disk(5)
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-disk-threshold]')`, 10000, 'threshold control')
      await evaluate(`[...document.querySelectorAll('[data-disk-threshold] button, [data-disk-threshold] [role=radio]')].find((b) => /Off/.test(b.textContent)).click()`)
      await waitFor(`${S}.get('disk').state?.warnGb === 0`, 5000, 'off saved')
      check('threshold Off: saved to disk.json, no badge', JSON.parse(fs.readFileSync(path.join(DATA, 'disk.json'), 'utf8')).warnGb === 0 && !(await evaluate(`!!document.querySelector('[data-disk-badge]')`)))
      await evaluate(`[...document.querySelectorAll('[data-disk-threshold] button, [data-disk-threshold] [role=radio]')].find((b) => /^\\s*20 GB/.test(b.textContent)).click()`)
      await waitFor(`!!document.querySelector('[data-disk-badge="warn"]')`, 10000, 'badge back')
      check('threshold 20 GB measures again and warns', JSON.parse(fs.readFileSync(path.join(DATA, 'disk.json'), 'utf8')).warnGb === 20)
      check('toast kind "disk" has its Settings label (kinds list is hidden while CCM_TOAST=0)', (await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$t('settings.toastKind.disk')`)) === 'Drive almost full')
    })

    await step('agent data row opens the dialog with known projects', async () => {
      await waitFor(`Object.values(${TERMS}.byId).some((t) => t.cwd && t.cwd.toLowerCase() === ${JSON.stringify(PLAIN.toLowerCase())})`, 20000, 'session listed')
      await waitFor(`!!document.querySelector('[data-agentdata-build-open]')`, 15000, 'agent data build row')
      await click('[data-agentdata-build-open]')
      await waitFor(`!!document.querySelector('[data-build-clean]')`, 10000, 'dialog')
      await evaluate(`${UI}.settingsOpen = false`)
      const known = await evaluate(`[...document.querySelectorAll('[data-build-known]')].map((r) => r.textContent)`)
      check('dialog lists the session project before measuring (nothing scanned yet)', known.some((k) => k.includes('plainproj')) && !(await evaluate(`!!document.querySelector('[data-build-dir]')`)), JSON.stringify(known))
      await click('[data-build-measure]')
      await idle()
      const found = (await rels('plainproj')).sort()
      check('plain project: node_modules + out offered, target without Cargo.toml not', JSON.stringify(found) === JSON.stringify(['node_modules:node', 'out:web']), JSON.stringify(found))
      await click('[data-build-project="plainproj"] [data-build-dir="out"] [data-build-pick]')
      await click('[data-build-clean-run]')
      const n = await note()
      check('clean refused while a session runs in the project, naming it', n.kind === 'error' && /build-e2e|plainproj|hello/.test(n.text) && fs.existsSync(path.join(PLAIN, 'out')), n.text)
      await shot('v77a-02-refused')
      await evaluate(`${UI}.buildClean = null`)
    })

    await step('git project via rail path', async () => {
      await evaluate(`${UI}.buildClean = { dir: ${JSON.stringify(GIT)} }`)
      await waitFor(`!!document.querySelector('[data-build-measure]')`, 10000, 'dialog')
      await click('[data-build-measure]')
      await idle()
      const found = (await rels('gitproj')).sort()
      check('git project: ignored node_modules + app/build (Gradle); tracked dist and the junction not offered', JSON.stringify(found) === JSON.stringify(['app/build:gradle', 'node_modules:node']), JSON.stringify(found))
      await click('[data-build-project="gitproj"] [data-build-dir="node_modules"] [data-build-pick]')
      await insp.answer(1)
      await click('[data-build-clean-run]')
      const c = await note()
      check('cancel at the confirm deletes nothing', c.kind === 'error' && fs.existsSync(path.join(GIT, 'node_modules', 'left-pad', 'index.js')), c.text)
      await insp.answer(0)
      await click('[data-build-clean-run]')
      const d = await note()
      const asked = (await insp.asked()).at(-1) ?? ''
      check('delete: node_modules gone, sources / tracked dist / junction target kept', d.kind === 'ok' && !fs.existsSync(path.join(GIT, 'node_modules')) && fs.existsSync(path.join(GIT, 'src', 'main.ts')) && fs.existsSync(path.join(GIT, 'dist', 'app.js')) && fs.existsSync(path.join(OUTSIDE, 'node_modules', 'keep.js')), d.text)
      check('confirm names size, folder and reinstall, deleted for good', /node_modules/.test(asked) && /installed again/.test(asked) && /for good/.test(asked) && /\[Delete\|Cancel\]/.test(asked), asked.slice(0, 240))
      check('row removed without a second measure', JSON.stringify(await rels('gitproj')) === JSON.stringify(['app/build:gradle']))
      await shot('v77a-03-cleaned')
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await app.shot('v77a-99-error').catch(() => {})
  } finally {
    insp?.close()
    app.stop()
    for (const c of sleepers) try { c.kill() } catch {}
    fs.writeFileSync(path.join(OUT, 'results-v77a.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    try { fs.rmSync(FAKE, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
