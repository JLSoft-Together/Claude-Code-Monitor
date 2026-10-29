// v75 against fakes: OSV advisories on the library update check (loopback CCM_OSV_URL), CLAUDE.md / memory doctor over a
// fake CLAUDE_CONFIG_DIR, release check on fixtures/release-check (fake JDK + apksigner.jar whose java.js prints the
// certificate written in the APK), prompt search in History over `demo-fixture --history=4`, and on the fake adb device:
// accessibility panel, screen recording (CCM_E2E_RECORD_FILE), performance snapshot and the file browser
// (CCM_E2E_PULL_DIR / CCM_E2E_PUSH_FILE). Native confirms are answered by patching dialog.showMessageBox in the main
// process over its Node inspector, as in v74.
const { execFileSync, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT, REPO } = require('./cdp.cjs')
const WS = require(path.join(REPO, 'node_modules/ws'))
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const UI = `${S}.get('ui')`
const WIN = process.platform === 'win32'
const VERSION = require('../package.json').version
const INSPECT = Number(process.env.CCM_E2E_INSPECT) || (Number(process.env.CCM_E2E_DBG) || 9333) + 7
const DATA = path.join(OUT, 'run', 'data')
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v75-')))
const REL = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v75rel-')))
const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v75fake-')))
const CONFIG = path.join(FAKE, 'claude-config')
const SDK = path.join(FAKE, 'android-sdk')
const JDK = path.join(FAKE, 'jdk')
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const SDCARD = path.join(STATE, 'sdcard')
const REC_FILE = path.join(FAKE, 'saved-rec.mp4')
const PULL_DIR = path.join(FAKE, 'pulled')
const PUSH_FILE = path.join(FAKE, 'upload.bin')
const SIGNED = path.join(FAKE, 'signed-release.apk')
const SERIAL = 'emulator-5554'
const PKG = 'com.example.demo'
const SHA_A = 'a1'.repeat(32)
const SHA_B = 'b2'.repeat(32)
const SHA_DEBUG = 'dd'.repeat(32)

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}
const calls = () => (fs.existsSync(path.join(STATE, 'calls.log')) ? fs.readFileSync(path.join(STATE, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const recLeft = () => (fs.existsSync(SDCARD) ? fs.readdirSync(SDCARD).filter((n) => n.startsWith('orrery-rec-')) : [])

// java -version for findJdk; `java -jar apksigner.jar verify --print-certs <apk>` prints "DN|sha" written in the APK.
const JAVA_JS = `const fs = require('node:fs')
const a = process.argv.slice(2)
if (a[0] === '-version') { process.stderr.write('openjdk version "17.0.9" 2023-10-17\\n'); process.exit(0) }
const body = fs.readFileSync(a[a.length - 1], 'utf8').trim()
if (body === 'UNSIGNED') { process.stdout.write('DOES NOT VERIFY\\n'); process.exit(1) }
const [dn, sha] = body.split('|')
process.stdout.write('Verifies\\nVerified using v2 scheme (APK Signature Scheme v2): true\\nSigner #1 certificate DN: ' + dn + '\\nSigner #1 certificate SHA-256 digest: ' + sha + '\\n')
`

function fakeTools() {
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'run-fakes', 'adb.js'), path.join(TOOLS, 'adb.js'))
  fs.writeFileSync(path.join(TOOLS, 'java.js'), JAVA_JS)
  write(path.join(SDK, 'build-tools', '35.0.0', 'lib', 'apksigner.jar'), 'fake jar')
  const adb = path.join(SDK, 'platform-tools', WIN ? 'adb.exe' : 'adb')
  const java = path.join(JDK, 'bin', WIN ? 'java.exe' : 'java')
  if (!WIN) {
    for (const [exe, js] of [[adb, 'adb.js'], [java, 'java.js']]) {
      write(exe, `#!/bin/sh\nexec "${process.execPath}" "${path.join(TOOLS, js)}" "$@"\n`)
      fs.chmodSync(exe, 0o755)
    }
    return
  }
  const cs = path.join(FAKE, 'launcher.cs')
  fs.writeFileSync(cs, fs.readFileSync(path.join(__dirname, 'fixtures', 'run-fakes', 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  for (const exe of [adb, java]) {
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, cs], { stdio: 'pipe' })
  }
}

const PUBSPEC = `name: demo
dependencies:
  flutter:
    sdk: flutter
  http: 1.2.0
  path: 1.8.0
`
const slug = (cwd) => path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
function seedProject() {
  write(path.join(DIR, 'pubspec.yaml'), PUBSPEC)
  write(path.join(DIR, 'src', 'real.ts'), 'export {}\n')
  write(path.join(DIR, 'CLAUDE.md'), '# Demo\n\nRead @docs/missing-guide.md first.\n\nThe entry point is `src/real.ts`, helpers live in `src/gone-helper.ts`.\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DIR, stdio: 'pipe' })
  const mem = path.join(CONFIG, 'projects', slug(DIR), 'memory')
  write(path.join(mem, 'MEMORY.md'), '- [Alpha](alpha.md) — first note\n- [Gone](gone-note.md) — deleted note\n')
  write(path.join(mem, 'alpha.md'), '---\nname: alpha\ntype: project\n---\n\nSee [[no-such-note]] for details.\n')
  write(path.join(mem, 'beta.md'), '---\nname: beta\ndescription: not in the index\ntype: feedback\n---\n\nBody.\n')
}

function seedRelease() {
  fs.cpSync(path.join(__dirname, 'fixtures', 'release-check'), REL, { recursive: true })
  write(path.join(REL, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), `CN=Android Debug, O=Android, C=US|${SHA_DEBUG}`)
  write(SIGNED, `CN=Shop Release, O=Example, C=VN|${SHA_A}`)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: REL, stdio: 'pipe' })
}

function seedDevice() {
  write(path.join(SDCARD, 'Download', 'hello.txt'), 'hello from the device\n')
  write(path.join(SDCARD, 'notes.txt'), 'device notes\n')
  write(PUSH_FILE, crypto.randomBytes(300 * 1024))
  fs.mkdirSync(PULL_DIR, { recursive: true })
}

function seedHistory() {
  const res = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'demo-fixture.mjs'), `--root=${CONFIG}`, '--sessions=0', '--history=4', '--duration=1'], { encoding: 'utf8', timeout: 20000 })
  if (!fs.existsSync(path.join(CONFIG, 'projects'))) throw new Error('demo-fixture: ' + (res.stderr || res.stdout))
}

const osvHits = []
const OSV_RECORDS = {
  'GHSA-e2e7-http-0001': { id: 'GHSA-e2e7-http-0001', summary: 'Header injection in http', aliases: ['CVE-2026-0001'], database_specific: { severity: 'HIGH' }, affected: [{ package: { ecosystem: 'Pub', name: 'http' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '0' }, { fixed: '1.2.2' }] }] }] },
  'OSV-2026-77': { id: 'OSV-2026-77', summary: 'Slow parse in http', affected: [{ package: { ecosystem: 'Pub', name: 'http' }, database_specific: { severity: 'MODERATE' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '1.0.0' }, { fixed: '1.3.0' }] }] }] },
}
let osvDown = false
function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      osvHits.push({ url, body })
      if (osvDown) {
        res.writeHead(503)
        return res.end('down')
      }
      if (url === '/v1/querybatch' && req.method === 'POST') {
        const q = JSON.parse(body).queries
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ results: q.map((x) => (x.package.name === 'http' ? { vulns: [{ id: 'GHSA-e2e7-http-0001' }, { id: 'OSV-2026-77' }] } : {})) }))
      }
      const id = decodeURIComponent(url.replace('/v1/vulns/', ''))
      if (OSV_RECORDS[id]) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify(OSV_RECORDS[id]))
      }
      if (url === '/pub/http' || url === '/pub/path') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ versions: [{ version: '1.2.0' }, { version: '1.8.0' }, { version: '1.9.1' }] }))
      }
      res.writeHead(404)
      res.end('not found')
    })
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
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
  const ok = await evaluate(`(() => { const req = typeof require === 'function' ? require : process.mainModule.require; const { dialog } = req('electron'); globalThis.__e2eAnswer = 0; globalThis.__e2eAsked = []; dialog.showMessageBox = async (...a) => { const o = a.find((x) => x && typeof x === 'object' && 'message' in x) || {}; globalThis.__e2eAsked.push(String(o.message)); return { response: globalThis.__e2eAnswer, checkboxChecked: false } }; return 'patched' })()`)
  if (ok !== 'patched') throw new Error('patch failed: ' + ok)
  return { answer: (n) => evaluate(`globalThis.__e2eAnswer = ${n}`), asked: () => evaluate(`globalThis.__e2eAsked.slice()`), close: () => ws.close() }
}

async function main() {
  let server = null
  try {
    fakeTools()
    seedHistory()
    seedProject()
    seedRelease()
    seedDevice()
    server = await serve()
  } catch (e) {
    check('fixtures', false, e.message)
    server?.close()
    return
  }
  const base = `http://127.0.0.1:${server.address().port}`
  const env = {
    ANDROID_HOME: SDK,
    ANDROID_SDK_ROOT: SDK,
    JAVA_HOME: JDK,
    CLAUDE_CONFIG_DIR: CONFIG,
    CCM_VERIFY_PROCESSES: '0',
    CCM_CODEX: '0',
    CCM_LIBS_REGISTRY: base,
    CCM_OSV_URL: base,
    CCM_E2E_RECORD_FILE: REC_FILE,
    CCM_E2E_PULL_DIR: PULL_DIR,
    CCM_E2E_PUSH_FILE: PUSH_FILE,
    CCM_E2E_RELEASE_ARTIFACT: SIGNED,
  }
  const app = await launch({ env, args: [`--inspect=${INSPECT}`] })
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const esc = () => key('Escape', 'Escape', 27)
  const setInput = (sel, value) => evaluate(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  const click = (sel) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) throw new Error('no ' + ${JSON.stringify(sel)}); b.click() })()`)
  const text = (sel) => evaluate(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  const palette = async (label) => {
    await cmd('Page.bringToFront')
    await evaluate(`document.activeElement?.blur?.(); document.body.focus()`)
    await key('k', 'KeyK', 75, process.platform === 'darwin' ? 4 : 2)
    await waitFor(`${UI}.paletteOpen`, 5000, 'palette open').catch(() => evaluate(`${UI}.paletteOpen = true`))
    await sleep(300)
    await app.type(label)
    await sleep(400)
    return evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find((r) => r.textContent.includes(${JSON.stringify(label)})); o?.click(); return !!o })()`)
  }
  let main = null
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v75-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
      await esc().catch(() => {})
    }
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    main = await mainInspector()
    check('main-process confirm stub installed over the inspector', true)
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.devices.appDataPkg','${PKG}')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await sleep(500)

    await evaluate(`${UI}.setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes.some((p) => p.state === 'running')`, 20000, 'shell running')

    await step('osv', async () => {
      const row = (n) => `document.querySelector('[data-lib-row="${n}"]')`
      await evaluate(`${UI}.libUpdates = { path: ${JSON.stringify(path.join(DIR, 'pubspec.yaml'))}, root: ${JSON.stringify(DIR)} }`)
      await waitFor(`!!${row('http')}?.dataset.libStatus && ${row('http')}.dataset.libStatus !== 'unknown'`, 15000, 'pub rows')
      check('OSV not asked on open (only on click), no Security column yet', !osvHits.some((h) => h.url.startsWith('/v1/')) && !(await evaluate(`!!document.querySelector('[data-lib-vulns]')`)))
      await click('[data-libs-vulns]')
      await waitFor(`!!document.querySelector('[data-libs-vulns-summary]')`, 15000, 'vulns summary')
      const batch = osvHits.find((h) => h.url === '/v1/querybatch')
      let q = []
      try { q = JSON.parse(batch.body).queries } catch {}
      check('one querybatch with exact versions, Pub ecosystem, nothing else from the project', q.length === 2 && q.every((x) => x.package.ecosystem === 'Pub' && /^\d/.test(x.version)) && Object.keys(JSON.parse(batch.body)).join() === 'queries', batch?.body)
      check('advisory details fetched per id (2 GETs)', osvHits.filter((h) => h.url.startsWith('/v1/vulns/')).length === 2, JSON.stringify(osvHits.map((h) => h.url)))
      const httpCell = await evaluate(`${row('http')}.querySelector('[data-lib-vulns]')?.dataset.libVulns`)
      const pathCell = await evaluate(`${row('path')}.querySelector('[data-lib-vulns]')?.dataset.libVulns`)
      const httpText = await evaluate(`${row('http')}.querySelector('[data-lib-vulns]').textContent.replace(/\\s+/g, ' ')`)
      check('http: 2 advisories, worst High, fixed in 1.3.0 for all', httpCell === '2' && /High/i.test(httpText) && httpText.includes('1.3.0'), httpText)
      check('path: clean (shield, success colour)', pathCell === '0' && (await evaluate(`!!${row('path')}.querySelector('[data-lib-vulns] .text-success')`)), await evaluate(`${row('path')}.querySelector('[data-lib-vulns]').textContent.trim()`))
      check('summary counts 1 vulnerable lib', (await text('[data-libs-vulns-summary]')).includes('1'), await text('[data-libs-vulns-summary]'))
      await evaluate(`${row('http')}.querySelector('[data-lib-vulns-toggle]').click()`)
      await waitFor(`!!document.querySelector('[data-lib-advisories="http"]')`, 3000, 'advisories')
      const ids = await evaluate(`[...document.querySelectorAll('[data-lib-advisory]')].map((e) => e.dataset.libAdvisory)`)
      check('advisory list sorted worst first (GHSA high, then OSV moderate)', JSON.stringify(ids) === '["GHSA-e2e7-http-0001","OSV-2026-77"]', JSON.stringify(ids))
      await shot('v75-01-osv')
      await click('[data-libs-vulnerable-only]')
      await sleep(200)
      check('Vulnerable only → just http', JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-lib-row]')].map((r) => r.dataset.libRow)`)) === '["http"]')
      await click('[data-libs-vulnerable-only]')
      osvDown = true
      await click('[data-libs-vulns]')
      await waitFor(`!!document.querySelector('[data-libs-vulns-error]')`, 15000, 'osv error')
      check('OSV down → error strip, table still usable', (await evaluate(`document.querySelectorAll('[data-lib-row]').length`)) === 2 && (await text('[data-libs-vulns-error]')).length > 0, await text('[data-libs-vulns-error]'))
      osvDown = false
      check('pubspec never edited', fs.readFileSync(path.join(DIR, 'pubspec.yaml'), 'utf8') === PUBSPEC)
      await esc()
      await waitFor(`!document.querySelector('[data-lib-updates]')`, 5000, 'closed')
    })

    await step('memory doctor', async () => {
      await evaluate(`${UI}.contextSources = { cwd: ${JSON.stringify(DIR)}, terminalId: null }`)
      await waitFor(`!!document.querySelector('[data-ctx-sources] [data-mem-doctor-run]')`, 10000, 'doctor button')
      check('no findings section before the click (read-only, on demand)', !(await evaluate(`!!document.querySelector('[data-mem-doctor]')`)))
      await click('[data-mem-doctor-run]')
      await waitFor(`!!document.querySelector('[data-mem-doctor-summary], [data-mem-doctor-clean], [data-mem-doctor-error]')`, 15000, 'doctor result')
      const kinds = await evaluate(`[...document.querySelectorAll('[data-mem-finding]')].map((e) => e.dataset.memFinding)`)
      const all = await text('[data-mem-doctor]')
      check('missing @import flagged', kinds.includes('missing-import') && all.includes('missing-guide.md'), JSON.stringify(kinds))
      check('stale path src/gone-helper.ts flagged, existing src/real.ts not', kinds.includes('missing-path') && all.includes('src/gone-helper.ts') && !all.includes('src/real.ts'), all.slice(0, 300))
      check('MEMORY.md link to a missing file flagged', kinds.includes('index-missing-file') && all.includes('gone-note.md'))
      check('[[no-such-note]] broken link flagged', kinds.includes('broken-link') && all.includes('no-such-note'))
      check('memory file missing from the index flagged (beta.md)', kinds.includes('not-indexed') && all.includes('beta.md'))
      check('frontmatter without description flagged (alpha.md)', kinds.includes('frontmatter'))
      await shot('v75-02-memory-doctor')
      const before = fs.readFileSync(path.join(DIR, 'CLAUDE.md'), 'utf8')
      await click('[data-mem-doctor-fill]')
      await waitFor(`!!document.querySelector('[data-mem-doctor-notice]')`, 3000, 'notice')
      check('Fill with only a shell pane → "no agent" notice, nothing typed', (await evaluate(`document.querySelector('[data-mem-doctor-notice]').classList.contains('text-warning')`)) && fs.readFileSync(path.join(DIR, 'CLAUDE.md'), 'utf8') === before, await text('[data-mem-doctor-notice]'))
      await evaluate(`[...document.querySelectorAll('[data-mem-finding="missing-path"] button')][0]?.click()`)
      await waitFor(`!document.querySelector('[data-ctx-sources]')`, 5000, 'closed by open')
      await waitFor(`${W}.panes.some((p) => (p.path ?? p.file ?? '').toString().endsWith('CLAUDE.md'))`, 8000, 'editor').catch(() => {})
      check('clicking a finding opens the file (dialog closes, editor pane on CLAUDE.md)', await evaluate(`${W}.panes.some((p) => JSON.stringify(p).includes('CLAUDE.md'))`))
      check('files untouched by the doctor', fs.readFileSync(path.join(DIR, 'CLAUDE.md'), 'utf8') === before && fs.existsSync(path.join(CONFIG, 'projects', slug(DIR), 'memory', 'beta.md')))
    })

    await step('release check', async () => {
      await evaluate(`${W}.open('shell', ${JSON.stringify(REL)})`)
      await waitFor(`${W}.panes.filter((p) => p.state === 'running').length >= 2`, 20000, 'second shell')
      await sleep(400)
      const hit = await palette('Release check')
      await waitFor(`!!document.querySelector('[data-release-check] [data-release-rule]')`, 20000, 'findings')
      check('Ctrl+K "Release check" opens it for the focused project', hit)
      const list = () => evaluate(`[...document.querySelectorAll('[data-release-rule]')].map((e) => e.dataset.releaseRule + ':' + e.dataset.releaseStatus + ':' + e.dataset.releaseDetail)`)
      const first = await list()
      console.log('  findings: ' + JSON.stringify(first))
      const has = (l, s) => l.some((x) => x.startsWith(s))
      check('debuggable release build → fail', has(first, 'debuggable:fail'), JSON.stringify(first))
      check('release signed with the debug config → warn', has(first, 'signing:warn:debugKey'))
      check('targetSdk 33 below the Play floor → fail', has(first, 'target-sdk:fail'), JSON.stringify(first.filter((x) => /target/i.test(x))))
      check('manifest: cleartext, exported without filter, sensitive permission → warn', has(first, 'cleartext:warn') && has(first, 'exported:warn') && has(first, 'permission:warn'))
      check('AdMob test ids found (non-debug use flagged)', has(first, 'admob-test:fail:release') && has(first, 'admob-test:warn:guarded'), JSON.stringify(first.filter((x) => /admob/i.test(x))))
      check('certificate not verified yet', has(first, 'cert:unknown:notVerified'))
      check('summary shows fail + warn counts', await evaluate(`!!document.querySelector('[data-release-count="fail"]') && !!document.querySelector('[data-release-count="warn"]')`))
      check('findings link to file:line', (await evaluate(`document.querySelectorAll('[data-release-open]').length`)) > 3)
      await shot('v75-03-release')

      await click('[data-release-verify]')
      await waitFor(`!!document.querySelector('[data-release-notice]') || [...document.querySelectorAll('[data-release-rule="cert"]')].some((e) => e.dataset.releaseStatus !== 'unknown')`, 20000, 'verified')
      let cert = await evaluate(`document.querySelector('[data-release-rule="cert"]')?.dataset.releaseDetail`)
      check('Verify newest build/outputs APK (debug key) → cert fail debugKey, no Remember', cert === 'debugKey' && !(await evaluate(`!!document.querySelector('[data-release-remember]')`)), `${cert} ${await text('[data-release-notice]')}`)
      await click('[data-release-choose]')
      await waitFor(`document.querySelector('[data-release-rule="cert"]')?.dataset.releaseDetail === 'notRemembered'`, 20000, 'notRemembered')
      check('Choose signed APK → SHA shown, not remembered yet, Remember offered', (await text('[data-release-notice]')).toLowerCase().includes('a1:a1') && !!(await evaluate(`!!document.querySelector('[data-release-remember]')`)), await text('[data-release-notice]'))
      await click('[data-release-remember]')
      // main still holds the certificate it just read, so the fresh scan already compares it: match.
      await waitFor(`document.querySelector('[data-release-rule="cert"]')?.dataset.releaseDetail === 'match'`, 10000, 'remembered').catch(async (e) => {
        throw new Error(`${e.message}: ${await evaluate(`document.querySelector('[data-release-rule="cert"]')?.dataset.releaseDetail`)} | ${await text('[data-release-notice]')}`)
      })
      check('Remember → stored under the data dir', fs.readdirSync(path.join(DATA, 'release-check')).length > 0)
      await click('[data-release-choose]')
      await waitFor(`document.querySelector('[data-release-rule="cert"]')?.dataset.releaseDetail === 'match'`, 20000, 'match')
      check('same certificate again → ok match', (await evaluate(`document.querySelector('[data-release-rule="cert"]').dataset.releaseStatus`)) === 'ok')
      fs.writeFileSync(SIGNED, `CN=Someone Else, O=Other|${SHA_B}`)
      await click('[data-release-choose]')
      await waitFor(`document.querySelector('[data-release-rule="cert"]')?.dataset.releaseDetail === 'mismatch'`, 20000, 'mismatch')
      check('different certificate → fail mismatch', (await evaluate(`document.querySelector('[data-release-rule="cert"]').dataset.releaseStatus`)) === 'fail')
      await shot('v75-04-release-cert')

      const versionOf = async () => (await list()).filter((x) => /^version/i.test(x))
      const v0 = await versionOf()
      await click('[data-release-mark]')
      await waitFor(`!!document.querySelector('[data-release-notice]') && document.querySelector('[data-release-notice]').textContent.includes('7')`, 10000, 'marked')
      check('Mark released → released line shows code 7', (await text('[data-release-released]')).includes('7'), await text('[data-release-released]'))
      await click('[data-release-rerun]')
      await sleep(1500)
      const v1 = await versionOf()
      check('after marking, same versionCode 7 → version fail', v1.some((x) => x.includes(':fail')), `${JSON.stringify(v0)} → ${JSON.stringify(v1)}`)
      const gradle = path.join(REL, 'app', 'build.gradle.kts')
      fs.writeFileSync(gradle, fs.readFileSync(gradle, 'utf8').replace('versionCode = 7', 'versionCode = 8'))
      await click('[data-release-rerun]')
      await sleep(1500)
      const v2 = await versionOf()
      check('bump versionCode to 8 + re-run → version no longer fails', v2.length > 0 && !v2.some((x) => x.includes(':fail')), JSON.stringify(v2))
      await click('[data-release-fill]')
      await sleep(300)
      check('Fill with only shell panes → "no agent" notice (warn)', await evaluate(`document.querySelector('[data-release-notice]')?.classList.contains('text-warning') ?? false`), await text('[data-release-notice]'))
      check('fixture sources untouched except our gradle edit', fs.readFileSync(path.join(REL, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8') === fs.readFileSync(path.join(__dirname, 'fixtures', 'release-check', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8'))
      await esc()
      await waitFor(`!document.querySelector('[data-release-check]')`, 5000, 'closed')
    })

    await step('prompt search', async () => {
      await evaluate(`${UI}.setView('history')`)
      await waitFor(`!!document.querySelector('[data-prompt-search-input]')`, 15000, 'search card')
      await setInput('[data-prompt-search-input]', 'paywall')
      await click('[data-prompt-search-go]')
      await waitFor(`['done', 'capped'].includes(document.querySelector('[data-prompt-search-status]')?.dataset.state)`, 30000, 'search done')
      const hits = await evaluate(`[...document.querySelectorAll('[data-prompt-search-hit]')].map((h) => ({ id: h.dataset.sessionId, path: h.querySelector('.font-mono')?.getAttribute('title') ?? '', snippets: [...h.querySelectorAll('[data-prompt-search-snippet]')].map((s) => s.textContent), mark: !!h.querySelector('mark'), resume: h.querySelector('[data-prompt-search-resume]').disabled, open: h.querySelector('[data-prompt-search-open]').disabled }))`)
      check('"paywall" → 3 sessions (only typed prompts match)', hits.length === 3, JSON.stringify(hits.map((h) => h.path)))
      const snippets = hits.flatMap((h) => h.snippets)
      check('one snippet per session (tool output, meta, /compact, summary, notification, assistant, subagent excluded)', snippets.length === 3 && snippets.every((s) => !/tool output|meta|answer|subagent|continued|task-notification/i.test(s)), JSON.stringify(snippets))
      check('sk-ant-… key masked in snippets and page', !snippets.some((s) => s.includes('sk-ant-demo1234567890abcdef')) && !(await evaluate(`document.body.innerText.includes('demo1234567890abcdef')`)), JSON.stringify(snippets))
      check('matched term highlighted', hits.every((h) => h.mark))
      const gone = hits.find((h) => /history-1$/.test(h.path))
      const live = hits.filter((h) => !/history-1$/.test(h.path))
      check('history-1 (folder missing): Resume + Open folder disabled', !!gone && gone.resume && gone.open, JSON.stringify(gone))
      check('other sessions: Resume + Open folder enabled', live.length === 2 && live.every((h) => !h.resume && !h.open), JSON.stringify(live))
      await shot('v75-05-prompt-search')
      await setInput('[data-prompt-search-input]', 'subagent')
      await click('[data-prompt-search-go]')
      await waitFor(`['done', 'capped'].includes(document.querySelector('[data-prompt-search-status]')?.dataset.state) && !document.querySelector('[data-prompt-search-hit]')`, 30000, 'no hits').catch(() => {})
      check('sidechain-only word → no results', await evaluate(`!!document.querySelector('[data-prompt-search-empty]') && !document.querySelector('[data-prompt-search-hit]')`))
      await setInput('[data-prompt-search-input]', 'refactor settings')
      await click('[data-prompt-search-go]')
      await waitFor(`document.querySelectorAll('[data-prompt-search-hit]').length === 1`, 30000, 'one hit').catch(() => {})
      check('two words → only history-3', (await evaluate(`document.querySelectorAll('[data-prompt-search-hit]').length`)) === 1 && (await text('[data-prompt-search-hit]')).includes('history-3'), await text('[data-prompt-search-results]'))
      await evaluate(`${UI}.setView('workspace')`)
      await sleep(300)
      const hit = await palette('Find a past session')
      await waitFor(`${UI}.view === 'history' && document.activeElement?.matches('[data-prompt-search-input]')`, 5000, 'focused').catch(() => {})
      check('Ctrl+K "Find a past session" → History with the search box focused', hit && (await evaluate(`${UI}.view === 'history' && !!document.activeElement?.matches('[data-prompt-search-input]')`)))
    })

    const row = `document.querySelector('[data-dev-row="${SERIAL}"]')`
    await step('a11y', async () => {
      await evaluate(`${UI}.setView('devices')`)
      await waitFor(`!!${row}?.querySelector('[data-dev-action=capture]')`, 20000, 'device row')
      await evaluate(`${row}.querySelector('[data-dev-action=capture]').click()`)
      await waitFor(`!!document.querySelector('[data-device-capture] img')?.naturalWidth`, 15000, 'screenshot')
      await click('[data-capture-a11y]')
      await waitFor(`!!document.querySelector('[data-a11y-summary]')`, 15000, 'a11y report')
      const kinds = await evaluate(`[...document.querySelectorAll('[data-a11y-finding]')].map((e) => e.dataset.a11yFinding)`)
      check('Buy now (4 px at 420 dpi) → small target', kinds.includes('small-target'), JSON.stringify(kinds))
      check('density note from wm density (420)', (await text('[data-a11y-density]')).includes('420'), await text('[data-a11y-notes]'))
      check('flagged nodes framed on the screenshot', (await evaluate(`document.querySelectorAll('[data-a11y-frame]').length`)) >= 1)
      await evaluate(`document.querySelector('[data-a11y-finding="small-target"]').click()`)
      await sleep(200)
      check('picking a finding offers Find in files (by id)', await evaluate(`!!document.querySelector('[data-a11y-find]') && !document.querySelector('[data-a11y-find]').disabled`))
      await shot('v75-06-a11y')
      await click('[data-capture-inspect]')
      await sleep(300)
      check('View inspector and accessibility are exclusive', await evaluate(`!!document.querySelector('[data-capture-panel]') && !document.querySelector('[data-a11y-panel]')`))
      await click('[data-capture-inspect]')
    })

    await step('record', async () => {
      await click('[data-capture-record]')
      await waitFor(`document.querySelector('[data-capture-recording]')?.dataset.recPhase === 'recording'`, 15000, 'recording')
      const started = calls().find((c) => c.argv.includes('screenrecord'))
      check('screenrecord started with a 30 s limit into /sdcard/orrery-rec-*', !!started && started.argv.includes('30') && started.argv.some((a) => /\/sdcard\/orrery-rec-\d+\.mp4/.test(a)), JSON.stringify(started?.argv))
      check('Record disabled while recording', await evaluate(`document.querySelector('[data-capture-record]').disabled`))
      await sleep(3200)
      check('clock counts up (0:0x / 0:30)', /0:0[2-9].*0:30/.test(await text('[data-rec-elapsed]')), await text('[data-rec-elapsed]'))
      await shot('v75-07-recording')
      await click('[data-rec-stop]')
      await waitFor(`document.querySelector('[data-capture-recording]')?.dataset.recPhase === 'done' || !!document.querySelector('[data-capture-error]')`, 20000, 'done')
      const frames = await evaluate(`document.querySelectorAll('[data-rec-frame]').length`)
      check('Stop → result with duration + size, frames picked', (await evaluate(`document.querySelector('[data-capture-recording]')?.dataset.recPhase`)) === 'done' && frames >= 1 && frames <= 6, `${frames} ${await text('[data-capture-recording]')} ${await text('[data-capture-error]')}`)
      check('device file removed after pull (rm -f)', recLeft().length === 0, JSON.stringify(recLeft()))
      check('stopped with pkill -INT', calls().some((c) => c.argv.includes('pkill')))
      await click('[data-rec-save]')
      await waitFor(`!!document.querySelector('[data-capture-error]')`, 10000, 'saved note').catch(() => {})
      const saved = fs.existsSync(REC_FILE) ? fs.readFileSync(REC_FILE) : null
      check('Save as… writes the MP4 (ftyp + moov)', !!saved && saved.length === 36 && saved.subarray(4, 8).toString() === 'ftyp', await text('[data-capture-error]'))
      await shot('v75-08-recorded')
      await click('[data-rec-attach]')
      await sleep(400)
      check('Attach frames with no agent pane → warning, nothing sent', /Claude or Codex pane/i.test(await text('[data-capture-error]')), await text('[data-capture-error]'))
      await click('[data-rec-discard]')
      await waitFor(`!document.querySelector('[data-capture-recording]')`, 5000, 'idle')
      await click('[data-capture-record]')
      await waitFor(`document.querySelector('[data-capture-recording]')?.dataset.recPhase === 'recording'`, 15000, 'recording 2')
      await sleep(800)
      await click('[data-rec-cancel]')
      await waitFor(`!document.querySelector('[data-capture-recording]')`, 15000, 'cancelled')
      let left = recLeft()
      for (let i = 0; i < 20 && left.length; i++) { await sleep(300); left = recLeft() }
      check('Cancel → back to idle, recording removed from the device', left.length === 0, JSON.stringify(left))
      await esc()
      await waitFor(`!document.querySelector('[data-device-capture]')`, 5000, 'capture closed')
    })

    await step('perf', async () => {
      await evaluate(`${row}.querySelector('[data-dev-action=perf]').click()`)
      await waitFor(`!!document.querySelector('[data-device-perf]')`, 10000, 'perf dialog')
      check('package remembered from app data (com.example.demo)', (await evaluate(`document.querySelector('[data-perf-pkg]').value`)) === PKG)
      await click('[data-perf-reset]')
      await waitFor(`!!document.querySelector('[data-perf-message]')`, 10000, 'reset note')
      check('Reset → gfxinfo reset + note', calls().some((c) => c.argv.join(' ').includes('gfxinfo') && c.argv.join(' ').includes('reset')), await text('[data-perf-message]'))
      await click('[data-perf-measure]')
      await waitFor(`!!document.querySelector('[data-perf-metric="jankyPct"]')`, 15000, 'measured')
      const metric = (k) => text(`[data-perf-metric="${k}"]`)
      check('janky frames 2.5 %, p90 12 ms, PSS from meminfo', (await metric('jankyPct')).includes('2.5') && (await metric('p90')).includes('12') && !!(await metric('totalPss')), `${await metric('jankyPct')} | ${await metric('p90')} | ${await metric('totalPss')}`)
      check('measured since the reset', await evaluate(`!!document.querySelector('[data-perf-since="reset"]')`))
      await click('[data-perf-measure]')
      await waitFor(`document.querySelectorAll('[data-perf-sample]').length === 2`, 15000, 'second sample')
      check('second measure compared with the first: unchanged', await evaluate(`document.querySelector('[data-perf-metric="jankyPct"] [data-perf-trend]')?.dataset.perfTrend === 'same'`))
      await main.answer(1)
      await click('[data-perf-cold]')
      await sleep(1500)
      const asked = await main.asked()
      check('Cold start asks first (native confirm names the package); Cancel → app not restarted', asked.some((m) => m.includes(PKG)) && !calls().some((c) => c.argv.includes('-W') && c.argv.includes('-S')) && (await evaluate(`document.querySelectorAll('[data-perf-sample]').length`)) === 2, JSON.stringify(asked))
      await main.answer(0)
      await click('[data-perf-cold]')
      await waitFor(`!!document.querySelector('[data-perf-metric="coldTotal"]')`, 15000, 'cold')
      check('Cold start (confirmed) → am start -W -S, TotalTime 812 ms', (await metric('coldTotal')).includes('812') && calls().some((c) => c.argv.includes('-W') && c.argv.includes('-S')), await metric('coldTotal'))
      const file = path.join(DATA, 'perf', `${PKG}.json`)
      check('history saved per package in the data dir (3 samples)', fs.existsSync(file) && (await evaluate(`document.querySelectorAll('[data-perf-sample]').length`)) === 3)
      await shot('v75-09-perf')
      await setInput('[data-perf-pkg]', 'com.example.other')
      await click('[data-perf-measure]')
      await waitFor(`!!document.querySelector('[data-perf-message] .text-warning, [data-perf-message] svg')`, 15000, 'not running').catch(() => {})
      check('package not running → error, no sample', /not running|isn.t running|running/i.test(await text('[data-perf-message]')) && (await evaluate(`!document.querySelector('[data-perf-history]')`)), await text('[data-perf-message]'))
      await setInput('[data-perf-pkg]', 'bad pkg; rm -rf /')
      await sleep(150)
      check('invalid package name → buttons disabled', await evaluate(`document.querySelector('[data-perf-measure]').disabled && document.querySelector('[data-perf-cold]').disabled`))
      await setInput('[data-perf-pkg]', PKG)
      await click('[data-perf-load]')
      await waitFor(`!!document.querySelector('[data-perf-clear]')`, 10000, 'history back')
      await click('[data-perf-clear]')
      await waitFor(`!document.querySelector('[data-perf-history]')`, 10000, 'cleared')
      check('Clear history empties it', !fs.existsSync(file) || JSON.parse(fs.readFileSync(file, 'utf8')).length === 0 || JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8'))).length < 40, fs.existsSync(file) ? fs.readFileSync(file, 'utf8').slice(0, 80) : 'removed')
      await esc()
      await waitFor(`!document.querySelector('[data-device-perf]')`, 5000, 'perf closed')
    })

    await step('files', async () => {
      await evaluate(`${row}.querySelector('[data-dev-action=files]').click()`)
      await waitFor(`!!document.querySelector('[data-files-row="Download"]')`, 15000, 'sdcard listing')
      const rows = () => evaluate(`[...document.querySelectorAll('[data-files-row]')].map((r) => r.dataset.filesRow + ':' + r.dataset.filesKind)`)
      check('/sdcard listed: Download (dir) + notes.txt (file)', JSON.stringify(await rows()) === '["Download:dir","notes.txt:file"]', JSON.stringify(await rows()))
      await evaluate(`document.querySelector('[data-files-row="Download"] [data-files-enter]').click()`)
      await waitFor(`!!document.querySelector('[data-files-row="hello.txt"]')`, 10000, 'Download listing')
      check('enter folder → breadcrumb /sdcard/Download', await evaluate(`!!document.querySelector('[data-files-crumb="/sdcard/Download"]')`))
      await evaluate(`document.querySelector('[data-files-row="hello.txt"] [data-files-pull]').click()`)
      await waitFor(`!!document.querySelector('[data-files-open-pulled]') || !!document.querySelector('[data-files-message] .text-warning')`, 15000, 'pulled')
      const local = path.join(PULL_DIR, 'hello.txt')
      check('Pull → file in the picked folder with the same bytes, Open / Reveal offered', fs.existsSync(local) && fs.readFileSync(local, 'utf8') === 'hello from the device\n' && (await evaluate(`!!document.querySelector('[data-files-reveal-pulled]')`)), await text('[data-files-message]'))
      check('no partial file left', !fs.readdirSync(PULL_DIR).some((n) => n.includes('orrery-part')), JSON.stringify(fs.readdirSync(PULL_DIR)))
      await evaluate(`document.querySelector('[data-files-row="hello.txt"] [data-files-pull]').click()`)
      await waitFor(`(document.querySelector('[data-files-message]')?.textContent ?? '').includes('hello (1).txt')`, 15000, 'second pull').catch(() => {})
      check('pulling again keeps the first copy → "hello (1).txt"', fs.existsSync(path.join(PULL_DIR, 'hello (1).txt')), JSON.stringify(fs.readdirSync(PULL_DIR)))
      await click('[data-files-up]')
      await waitFor(`!!document.querySelector('[data-files-row="notes.txt"]')`, 10000, 'up')

      await click('[data-files-newfolder]')
      await waitFor(`!!document.querySelector('[data-files-newname]')`, 3000, 'name field')
      await setInput('[data-files-newname]', '../evil')
      await sleep(100)
      check('folder name with a slash / .. rejected (Create disabled)', await evaluate(`document.querySelector('[data-files-create]').disabled`))
      await setInput('[data-files-newname]', 'photos')
      await sleep(100)
      await click('[data-files-create]')
      await waitFor(`!!document.querySelector('[data-files-row="photos"]')`, 10000, 'mkdir')
      check('New folder → created on the device', fs.existsSync(path.join(SDCARD, 'photos')) && fs.statSync(path.join(SDCARD, 'photos')).isDirectory())

      await click('[data-files-push]')
      await waitFor(`!!document.querySelector('[data-files-row="upload.bin"]')`, 20000, 'pushed')
      const remote = path.join(SDCARD, 'upload.bin')
      check('Push → same 300 KB on the device, size verified', fs.existsSync(remote) && Buffer.compare(fs.readFileSync(remote), fs.readFileSync(PUSH_FILE)) === 0, await text('[data-files-message]'))
      fs.writeFileSync(PUSH_FILE, crypto.randomBytes(1024))
      await main.answer(1)
      await click('[data-files-push]')
      await waitFor(`!!document.querySelector('[data-files-message]') && !document.querySelector('[data-files-transfer]')`, 15000, 'replace asked')
      await sleep(300)
      const askedR = await main.asked()
      check('push over an existing file asks Replace (native); Cancel keeps the device file', askedR.some((m) => m.includes('upload.bin')) && fs.statSync(remote).size === 300 * 1024, `${await text('[data-files-message]')} | ${JSON.stringify(askedR.slice(-2))}`)
      await main.answer(0)
      await click('[data-files-push]')
      await waitFor(`!document.querySelector('[data-files-transfer]')`, 15000, 'replaced')
      await sleep(500)
      check('Replace confirmed → device file replaced', fs.statSync(remote).size === 1024)

      await main.answer(1)
      await evaluate(`document.querySelector('[data-files-row="notes.txt"] [data-files-delete]').click()`)
      await sleep(1200)
      check('Delete asks (native); Cancel keeps it', fs.existsSync(path.join(SDCARD, 'notes.txt')) && (await main.asked()).some((m) => m.includes('notes.txt')))
      await main.answer(0)
      await evaluate(`document.querySelector('[data-files-row="notes.txt"] [data-files-delete]').click()`)
      await waitFor(`!document.querySelector('[data-files-row="notes.txt"]')`, 10000, 'deleted')
      check('Delete confirmed → gone from the device and the list', !fs.existsSync(path.join(SDCARD, 'notes.txt')))
      await shot('v75-10-files')

      const trav = await evaluate(`window.ccmDesktop.devFsList(${JSON.stringify(SERIAL)}, { kind: 'sdcard' }, '/sdcard/../data')`)
      const outside = await evaluate(`window.ccmDesktop.devFsList(${JSON.stringify(SERIAL)}, { kind: 'sdcard' }, '/data/data')`)
      const quote = await evaluate(`window.ccmDesktop.devFsMkdir(${JSON.stringify(SERIAL)}, { kind: 'sdcard' }, '/sdcard', "x'; reboot; '")`)
      check('IPC: .. path and path outside the sdcard roots refused', trav?.ok === false && outside?.ok === false, JSON.stringify([trav, outside]))
      check("quote in a folder name stays one quoted word (literal dir, nothing else run)", quote?.ok === true && fs.existsSync(path.join(SDCARD, "x'; reboot; '")) && !calls().some((c) => c.argv.length && c.argv.at(-1) === 'reboot'), JSON.stringify(quote))

      await click('[data-files-scope="app"]')
      await waitFor(`!!document.querySelector('[data-files-pkg]')`, 3000, 'pkg field')
      await setInput('[data-files-pkg]', 'com.nope.release')
      await click('[data-files-pkg-open]')
      await waitFor(`!!document.querySelector('[data-files-message]')`, 10000, 'not debuggable')
      check('app folder of a non-debuggable package → error, no listing', !(await evaluate(`!!document.querySelector('[data-files-row]')`)) && (await text('[data-files-message]')).length > 0, await text('[data-files-message]'))
      const focus = await evaluate(`document.activeElement?.tagName + ':' + !!document.activeElement?.closest('[data-device-files]')`)
      await esc()
      await waitFor(`!document.querySelector('[data-device-files]')`, 5000, 'files closed').catch((e) => { throw new Error(`${e.message} (focus ${focus})`) })
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await shot('v75-99-error').catch(() => {})
  } finally {
    main?.close()
    app.stop()
    server.close()
    fs.writeFileSync(path.join(OUT, 'results-v75.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    for (const d of [DIR, REL, FAKE]) try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
