// v74 against fakes: in-app update from a loopback release feed (wrong digest → error + file removed, then a good digest →
// progress → verified → "Restart to update", never clicked), config backup export / preview (CCM_E2E_BACKUP_FILE stands in
// for the file dialogs), Android emulators over a fake SDK (emulator + adb), Claude Code hooks in a fake CLAUDE_CONFIG_DIR,
// strings table over strings.xml / ARB fixtures and library update check against a loopback registry.
// Native confirms (wipe, hook toggle / test, backup apply) are answered by patching dialog.showMessageBox in the main
// process through its Node inspector (--inspect); the backup import is answered "Cancel" so the app never relaunches.
const { execFileSync } = require('node:child_process')
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
const UPD = `${S}.get('update')`
const WIN = process.platform === 'win32'
const VERSION = require('../package.json').version
const INSPECT = Number(process.env.CCM_E2E_INSPECT) || (Number(process.env.CCM_E2E_DBG) || 9333) + 7
const DATA = path.join(OUT, 'run', 'data')
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v74-')))
const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v74fake-')))
const CONFIG = path.join(FAKE, 'claude-config')
const SDK = path.join(FAKE, 'android-sdk')
const AVD_HOME = path.join(FAKE, 'avd')
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const BACKUP = path.join(FAKE, 'backup.json')
const NEW_VERSION = '99.0.0'
const ASSET = WIN ? `Orrery-Setup-${NEW_VERSION}.exe` : `Orrery-${NEW_VERSION}-${process.arch}.dmg`
const PAYLOAD = crypto.randomBytes(320 * 1024)
const SHA = crypto.createHash('sha256').update(PAYLOAD).digest('hex')
const GHP = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'

const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

function fakeTools() {
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  for (const f of ['adb.js', 'emulator.js']) fs.copyFileSync(path.join(__dirname, 'fixtures', 'run-fakes', f), path.join(TOOLS, f))
  const adb = path.join(SDK, 'platform-tools', WIN ? 'adb.exe' : 'adb')
  const emu = path.join(SDK, 'emulator', WIN ? 'emulator.exe' : 'emulator')
  if (!WIN) {
    for (const [exe, js] of [[adb, 'adb.js'], [emu, 'emulator.js']]) {
      write(exe, `#!/bin/sh\nexec "${process.execPath}" "${path.join(TOOLS, js)}" "$@"\n`)
      fs.chmodSync(exe, 0o755)
    }
    return
  }
  const cs = path.join(FAKE, 'launcher.cs')
  fs.writeFileSync(cs, fs.readFileSync(path.join(__dirname, 'fixtures', 'run-fakes', 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  for (const exe of [adb, emu]) {
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, cs], { stdio: 'pipe' })
  }
}

function seedAvds() {
  write(path.join(AVD_HOME, 'Pixel_7_API_34.ini'), `avd.ini.encoding=UTF-8\npath=${path.join(AVD_HOME, 'Pixel_7_API_34.avd')}\ntarget=android-34\n`)
  write(path.join(AVD_HOME, 'Pixel_7_API_34.avd', 'config.ini'), 'avd.ini.displayname=Pixel 7 API 34\nabi.type=x86_64\nhw.device.name=pixel_7\nimage.sysdir.1=system-images\\android-34\\google_apis\\x86_64\\\ntag.id=google_apis\n')
  write(path.join(AVD_HOME, 'Tablet_API_30.ini'), 'avd.ini.encoding=UTF-8\ntarget=android-30\n')
  write(path.join(AVD_HOME, 'Tablet_API_30.avd', 'config.ini'), 'abi.type=arm64-v8a\nhw.device.name=pixel_tablet\n')
}

const HOOK_CMD = 'echo hook-out; echo hook-err >&2; exit 3'
const BRIDGE_CMD = 'node "C:/fake/hook-bridge.mjs" stop'
const PLUGIN_ROOT = () => path.join(CONFIG, 'plugins', 'cache', 'market', 'demo', '1.0.0')
function seedHooks() {
  write(
    path.join(CONFIG, 'settings.json'),
    JSON.stringify({ theme: 'dark', hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_CMD, timeout: 5 }] }], Stop: [{ hooks: [{ type: 'command', command: BRIDGE_CMD }] }] } }, null, 2) + '\n',
  )
  write(path.join(CONFIG, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'demo@market': [{ scope: 'user', installPath: PLUGIN_ROOT(), version: '1.0.0' }] } }))
  write(path.join(PLUGIN_ROOT(), 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo plugin-hook' }] }] } }))
}

const STRINGS_BASE = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- shown on the launcher -->
    <string name="app_name">Demo</string>
    <string name="hello">Hello %1$s</string>
    <string name="bye">Goodbye</string>
</resources>
`
const STRINGS_VI = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- vi -->
    <string name="app_name">Demo</string>
    <string name="hello">Xin chào</string>
</resources>
`
const PUBSPEC = `name: demo
dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.0
  path: ^1.8.0
  collection: ^1.18.0
dev_dependencies:
  lints: 4.0.0
`
const PACKAGE = JSON.stringify({ name: 'demo', dependencies: { vue: '^3.4.0' }, devDependencies: { vitest: '^2.0.0' } }, null, 2) + '\n'
const TOML = `[versions]
coreKtx = "1.13.1"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
okhttp = "com.squareup.okhttp3:okhttp:4.12.0"
`
function seedProject() {
  write(path.join(DIR, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), STRINGS_BASE)
  write(path.join(DIR, 'app', 'src', 'main', 'res', 'values-vi', 'strings.xml'), STRINGS_VI)
  write(path.join(DIR, 'lib', 'l10n', 'app_en.arb'), JSON.stringify({ '@@locale': 'en', title: 'Hi {name}', '@title': { placeholders: { name: {} } }, count: 'Count' }, null, 2) + '\n')
  write(path.join(DIR, 'lib', 'l10n', 'app_vi.arb'), JSON.stringify({ '@@locale': 'vi', title: 'Chào' }, null, 2) + '\n')
  write(path.join(DIR, 'l10n.yaml'), 'arb-dir: lib/l10n\ntemplate-arb-file: app_en.arb\n')
  write(path.join(DIR, 'pubspec.yaml'), PUBSPEC)
  write(path.join(DIR, 'package.json'), PACKAGE)
  write(path.join(DIR, 'gradle', 'libs.versions.toml'), TOML)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: DIR, stdio: 'pipe' })
}

const maven = (versions) => `<?xml version="1.0" encoding="UTF-8"?><metadata><versioning><release>${versions.at(-1)}</release><versions>${versions.map((v) => `<version>${v}</version>`).join('')}</versions></versioning></metadata>`
const REGISTRY = {
  '/google/androidx/core/core-ktx/maven-metadata.xml': maven(['1.12.0', '1.13.1', '1.15.0']),
  '/central/com/squareup/okhttp3/okhttp/maven-metadata.xml': maven(['4.11.0', '4.12.0', '5.0.0']),
  '/pub/http': JSON.stringify({ versions: [{ version: '1.2.0' }, { version: '1.2.2' }] }),
  '/pub/path': JSON.stringify({ versions: [{ version: '1.8.0' }, { version: '1.9.1' }] }),
  '/pub/collection': JSON.stringify({ versions: [{ version: '1.17.0' }, { version: '1.18.0' }] }),
  '/pub/lints': JSON.stringify({ versions: [{ version: '4.0.0' }, { version: '5.1.0' }] }),
  '/npm/vue': JSON.stringify({ versions: { '3.4.0': {}, '3.5.13': {}, '4.0.0-beta.1': {} } }),
  '/npm/vitest': JSON.stringify({ versions: { '2.0.0': {}, '2.1.9': {}, '3.2.4': {} } }),
}
const hits = []
let feedDigest = '0'.repeat(64)
function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]
    hits.push(url)
    const base = `http://127.0.0.1:${server.address().port}`
    if (url === '/feed.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(
        JSON.stringify({
          tag_name: `v${NEW_VERSION}`,
          name: `Orrery ${NEW_VERSION}`,
          html_url: `${base}/release`,
          draft: false,
          prerelease: false,
          published_at: '2026-10-29T08:00:00Z',
          body: "## What's new\n\n- Faster **v74 e2e** things\n- [Link](https://example.com)\n",
          assets: [{ name: ASSET, size: PAYLOAD.length, browser_download_url: `${base}/dl/${ASSET}`, digest: `sha256:${feedDigest}` }],
        }),
      )
    }
    if (url === `/dl/${ASSET}`) {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': PAYLOAD.length })
      // Slow on purpose: about 3 s, so the progress bar is seen.
      let at = 0
      const step = 10 * 1024
      const timer = setInterval(() => {
        if (at >= PAYLOAD.length) {
          clearInterval(timer)
          return res.end()
        }
        res.write(PAYLOAD.subarray(at, at + step))
        at += step
      }, 90)
      req.on('close', () => clearInterval(timer))
      return
    }
    const body = REGISTRY[url]
    if (body) {
      res.writeHead(200, { 'content-type': url.endsWith('.xml') ? 'application/xml' : 'application/json' })
      return res.end(body)
    }
    res.writeHead(404)
    res.end('not found')
  })
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)))
}

/** Node inspector of the Electron main process: replaces dialog.showMessageBox with a fixed answer (`globalThis.__e2eAnswer`). */
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
    seedAvds()
    seedHooks()
    seedProject()
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
    ANDROID_AVD_HOME: AVD_HOME,
    CLAUDE_CONFIG_DIR: CONFIG,
    CCM_VERIFY_PROCESSES: '0',
    CCM_CODEX: '0',
    CCM_UPDATE_FEED: `${base}/feed.json`,
    CCM_LIBS_REGISTRY: base,
    CCM_E2E_BACKUP_FILE: BACKUP,
  }
  const app = await launch({ env, args: [`--inspect=${INSPECT}`] })
  const { evaluate, waitFor, shot, sleep, cmd, key } = app
  const esc = () => key('Escape', 'Escape', 27)
  let main = null
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v74-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
      await esc().catch(() => {})
    }
  }
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    main = await mainInspector()
    check('main-process confirm stub installed over the inspector', true)
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark')`)
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await sleep(500)

    const updatesFiles = () => { try { return fs.readdirSync(path.join(DATA, 'updates')).filter((n) => n !== 'pending.json') } catch { return [] } }
    await step('updater', async () => {
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-update-settings] [data-update-check]')`, 10000, 'updates section')
      check('no header chip before a check', !(await evaluate(`!!document.querySelector('[data-update-pill]')`)))
      await evaluate(`document.querySelector('[data-update-check]').click()`)
      await waitFor(`!!document.querySelector('[data-update-dialog]')`, 15000, 'dialog after check')
      const sub = await evaluate(`document.querySelector('[data-update-dialog]').textContent.replace(/\\s+/g, ' ')`)
      check('manual check → dialog with version + current', sub.includes(NEW_VERSION) && sub.includes(VERSION), sub.slice(0, 200))
      check('release notes rendered (markdown)', await evaluate(`!!document.querySelector('[data-update-notes] strong') && document.querySelector('[data-update-notes]').textContent.includes('Faster v74 e2e things')`))
      check('header chip + Settings dot', await evaluate(`!!document.querySelector('[data-update-pill]') && !!document.querySelector('[data-update-dot]')`))
      const primary = `document.querySelector('[data-update-primary]')`
      check('primary = Download and install', (await evaluate(`${primary}.textContent.trim()`)).length > 0 && (await evaluate(`${UPD}.state.canDownload && !${UPD}.state.error`)))
      await shot('v74-01-update-dialog')
      await evaluate(`${primary}.click()`)
      await waitFor(`!!document.querySelector('[data-update-progress]')`, 5000, 'progress (wrong digest)').catch(() => {})
      await waitFor(`!!document.querySelector('[data-update-error]')`, 20000, 'digest error')
      const errText = await evaluate(`document.querySelector('[data-update-error]').textContent.trim()`)
      check('wrong sha256 digest → error shown', (await evaluate(`${UPD}.state.error`)) === 'digest', errText)
      check('…and no file left in updates/ (no .part, no installer)', updatesFiles().length === 0, JSON.stringify(updatesFiles()))
      await shot('v74-02-update-digest')
      feedDigest = SHA
      await evaluate(`${UI}.settingsOpen = true`)
      await sleep(200)
      await evaluate(`${UPD}.check()`)
      await waitFor(`${UPD}.state.phase === 'available' && !${UPD}.state.error`, 10000, 're-check')
      await waitFor(`!!${primary}`, 5000, 'primary again')
      await evaluate(`${UI}.settingsOpen = false`)
      await evaluate(`${primary}.click()`)
      await waitFor(`!!document.querySelector('[data-update-progress]')`, 5000, 'progress')
      await sleep(1200)
      const pct = await evaluate(`Number(document.querySelector('[data-update-progress] [role=progressbar]')?.getAttribute('aria-valuenow') ?? -1)`)
      check('download shows progress', pct > 0 && pct < 100, String(pct))
      await shot('v74-03-update-progress')
      await waitFor(`!!document.querySelector('[data-update-ready]')`, 20000, 'verified')
      const label = await evaluate(`${primary}.textContent.trim()`)
      check('verified → "Restart to update" (not clicked)', label === 'Restart to update', label)
      const file = path.join(DATA, 'updates', ASSET)
      check('installer saved with the feed SHA-256', fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === SHA && updatesFiles().length === 1, JSON.stringify(updatesFiles()))
      await shot('v74-04-update-ready')
      await evaluate(`${UPD}.dialogOpen = false`)
    })

    await step('backup', async () => {
      await evaluate(`localStorage.setItem('ccm.github.token', '${GHP}'); localStorage.setItem('ccm.e2eNote', 'kept ${GHP} here'); localStorage.setItem('ccm.workspace.e2eTabs', JSON.stringify([{ cwd: ${JSON.stringify(DIR)} }, { cwd: 'C:\\\\nope-orrery-e2e\\\\gone' }]))`)
      await evaluate(`${UI}.settingsOpen = true`)
      await waitFor(`!!document.querySelector('[data-backup-settings] [data-backup-export]')`, 10000, 'backup section')
      await evaluate(`document.querySelector('[data-backup-export]').scrollIntoView(); document.querySelector('[data-backup-export]').click()`)
      await waitFor(`!!document.querySelector('[data-backup-exported]') || !!document.querySelector('[data-backup-error]')`, 15000, 'exported')
      check('Export → done message with the file', await evaluate(`document.querySelector('[data-backup-exported]')?.textContent.includes(${JSON.stringify(BACKUP)}) ?? false`), await evaluate(`document.querySelector('[data-backup-error]')?.textContent ?? ''`))
      const text = fs.existsSync(BACKUP) ? fs.readFileSync(BACKUP, 'utf8') : ''
      let doc = null
      try { doc = JSON.parse(text) } catch {}
      check('backup file written (orrery-backup v1)', doc?.format === 'orrery-backup' && doc.version === 1, text.slice(0, 120))
      const keys = Object.keys(doc?.local ?? {})
      check('whitelisted ccm.* keys only (theme, locale, workspace tabs kept)', keys.length > 0 && keys.every((k) => k.startsWith('ccm.')) && doc.local['ccm.theme'] === 'dark' && doc.local['ccm.locale'] === 'en' && 'ccm.workspace.e2eTabs' in doc.local && !keys.some((k) => /whatsNew/.test(k)), JSON.stringify(keys))
      check('no token: secret-named key dropped, token-shaped value redacted, no ghp_ anywhere', !keys.includes('ccm.github.token') && doc.local['ccm.e2eNote'] === 'kept [removed] here' && !text.includes('ghp_') && !/github_pat_|sk-ant-/.test(text), doc?.local?.['ccm.e2eNote'])
      await evaluate(`document.querySelector('[data-backup-import]').click()`)
      await waitFor(`!!document.querySelector('[data-backup-preview]')`, 15000, 'preview')
      const sections = await evaluate(`[...document.querySelectorAll('[data-backup-section]')].map((s) => s.dataset.backupSection)`)
      check('Import → preview per section (appearance, workspace, settings)', ['appearance', 'workspace', 'settings'].every((s) => sections.includes(s)), JSON.stringify(sections))
      const missing = await evaluate(`document.querySelector('[data-backup-section="workspace"] [data-backup-missing]')?.textContent ?? ''`)
      check('a folder missing on this machine is flagged', missing.includes('nope-orrery-e2e'), missing.trim().replace(/\s+/g, ' '))
      await shot('v74-05-backup-preview')
      await main.answer(1)
      await evaluate(`document.querySelector('[data-backup-apply]').click()`)
      await sleep(1500)
      const asked = await main.asked()
      check('Apply asks a native confirm first (answered Cancel → no restart, preview kept)', asked.some((m) => /Import \d+ sections? and restart/.test(m)) && (await evaluate(`!document.querySelector('[data-backup-restart]') && !!document.querySelector('[data-backup-preview]')`)) && !fs.existsSync(path.join(DATA, 'backups', 'pending-import.json')), JSON.stringify(asked))
      await main.answer(0)
      await evaluate(`${UI}.settingsOpen = false`)
    })

    await step('emulators', async () => {
      await evaluate(`${UI}.setView('devices')`)
      const row = (n) => `document.querySelector('[data-avd-row="${n}"]')`
      await waitFor(`!!${row('Pixel_7_API_34')} && !!${row('Tablet_API_30')}`, 20000, 'avd rows')
      const pixel = await evaluate(`${row('Pixel_7_API_34')}.textContent.replace(/\\s+/g, ' ')`)
      check('AVDs listed from -list-avds (INFO line skipped) with display name, API, ABI, device', pixel.includes('Pixel 7 API 34') && pixel.includes('API 34') && pixel.includes('x86_64') && pixel.includes('pixel_7') && (await evaluate(`document.querySelectorAll('[data-avd-row]').length`)) === 2, pixel)
      const tablet = await evaluate(`${row('Tablet_API_30')}.textContent.replace(/\\s+/g, ' ')`)
      check('AVD without path= falls back to <avd home>/<name>.avd (API 30, arm64-v8a)', tablet.includes('Tablet API 30') && tablet.includes('API 30') && tablet.includes('arm64-v8a'), tablet)
      check('both stopped, no error', (await evaluate(`[...document.querySelectorAll('[data-avd-row]')].every((r) => r.dataset.avdState === 'stopped')`)) && !(await evaluate(`!!document.querySelector('[data-avd-error]')`)))
      await shot('v74-06-avd-list')
      await evaluate(`${row('Pixel_7_API_34')}.querySelector('[data-avd-action=start]').click()`)
      await waitFor(`${row('Pixel_7_API_34')}?.dataset.avdState === 'starting'`, 3000, 'starting').catch(() => {})
      await waitFor(`${row('Pixel_7_API_34')}?.dataset.avdState === 'running'`, 25000, 'running')
      const serial = await evaluate(`${row('Pixel_7_API_34')}.textContent.match(/emulator-\\d+/)?.[0] ?? ''`)
      check('Start → emulator -avd, joins adb, row running with its serial (emu avd name)', serial === 'emulator-5556', serial)
      check('running emulator in the device list', await waitFor(`!!document.querySelector('[data-dev-row="emulator-5556"]')`, 10000, 'dev row').catch(() => false))
      await shot('v74-07-avd-running')
      await evaluate(`${row('Pixel_7_API_34')}.querySelector('[data-avd-action=stop]').click()`)
      await waitFor(`${row('Pixel_7_API_34')}?.dataset.avdState === 'stopped'`, 20000, 'stopped').catch(() => {})
      check('Stop → adb emu kill → stopped', (await evaluate(`${row('Pixel_7_API_34')}.dataset.avdState`)) === 'stopped')
      await evaluate(`${row('Tablet_API_30')}.querySelector('[data-avd-action=wipe]').click()`)
      const wiped = await waitFor(`${row('Tablet_API_30')}?.dataset.avdState === 'running'`, 25000, 'wiped running').catch(() => false)
      check('wiped AVD comes up running', !!wiped, `${await evaluate(`${row('Tablet_API_30')}.dataset.avdState`)} emu=${fs.existsSync(path.join(STATE, 'emu.json')) ? fs.readFileSync(path.join(STATE, 'emu.json'), 'utf8') : '-'} devs=${JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-dev-row]')].map((r) => r.dataset.devRow)`))} err=${await evaluate(`document.querySelector('[data-avd-error]')?.textContent ?? ''`)}`)
      const calls = fs.readFileSync(path.join(STATE, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.tool === 'emulator' && c.argv[0] === '-avd')
      const asked = await main.asked()
      check('Wipe data asks first (native confirm), then -wipe-data', asked.some((m) => m.includes('Tablet_API_30')) && calls.some((c) => c.argv.join(' ') === '-avd Tablet_API_30 -wipe-data') && calls.some((c) => c.argv.join(' ') === '-avd Pixel_7_API_34'), JSON.stringify(calls.map((c) => c.argv.join(' '))))
      // Running shows up through the adb tracker while the start call is still in its 3 s grace (buttons disabled).
      await waitFor(`${row('Tablet_API_30')}.querySelector('[data-avd-action=stop]')?.disabled === false`, 10000, 'stop enabled').catch(() => {})
      await evaluate(`${row('Tablet_API_30')}.querySelector('[data-avd-action=stop]')?.click()`)
      await waitFor(`${row('Tablet_API_30')}?.dataset.avdState === 'stopped'`, 20000, 'tablet stopped').catch(() => {})
      await evaluate(`document.querySelector('[data-avd-refresh]').click()`)
      await sleep(1500)
      const states = await evaluate(`[...document.querySelectorAll('[data-avd-row]')].map((r) => r.dataset.avdRow + ':' + r.dataset.avdState)`)
      check('Refresh keeps the list, both stopped', states.length === 2 && states.every((s) => s.endsWith(':stopped')), JSON.stringify(states))
    })

    await step('hooks', async () => {
      await evaluate(`${UI}.setView('extensions')`)
      await waitFor(`!!document.querySelector('[data-ext-section]')`, 15000, 'section switch')
      await evaluate(`[...document.querySelectorAll('[data-ext-section] [role=radio]')].find((b) => b.textContent.trim() === 'Hooks').click()`)
      await waitFor(`!!document.querySelector('[data-hook-row]')`, 15000, 'hook rows')
      const rowBy = (text) => `[...document.querySelectorAll('[data-hook-row]')].find((r) => r.querySelector('[data-hook-command]')?.textContent.includes(${JSON.stringify(text)}))`
      const events = await evaluate(`[...document.querySelectorAll('[data-hooks-event]')].map((e) => e.dataset.hooksEvent)`)
      check('hooks grouped by event (PostToolUse, Stop, SessionStart from the plugin)', ['PostToolUse', 'Stop', 'SessionStart'].every((e) => events.includes(e)), JSON.stringify(events))
      check('user hook: source user, on, toggleable', await evaluate(`(() => { const r = ${rowBy('hook-out')}; return !!r && r.dataset.hookSource === 'user' && r.dataset.hookEnabled === 'true' && !!r.querySelector('[data-hook-toggle]') })()`))
      check('hook-bridge hook badged Orrery, no toggle, no test', await evaluate(`(() => { const r = ${rowBy('hook-bridge')}; return !!r && !!r.querySelector('[data-hook-orrery]') && !r.querySelector('[data-hook-toggle]') && !r.querySelector('[data-hook-test]') })()`))
      check('plugin hook read-only (source plugin, no toggle)', await evaluate(`(() => { const r = ${rowBy('plugin-hook')}; return !!r && r.dataset.hookSource === 'plugin' && !r.querySelector('[data-hook-toggle]') && r.textContent.includes('demo@market') })()`))
      await shot('v74-08-hooks')
      await evaluate(`${rowBy('hook-out')}.querySelector('[data-hook-test]').click()`)
      await waitFor(`!!${rowBy('hook-out')}?.querySelector('[data-hook-result], [data-hook-error]')`, 20000, 'test result')
      const exit = await evaluate(`${rowBy('hook-out')}.querySelector('[data-hook-exit]')?.textContent.trim() ?? ${rowBy('hook-out')}.querySelector('[data-hook-error]')?.textContent`)
      const out = await evaluate(`${rowBy('hook-out')}.querySelector('[data-hook-out=stdout]')?.textContent ?? ''`)
      const err = await evaluate(`${rowBy('hook-out')}.querySelector('[data-hook-out=stderr]')?.textContent ?? ''`)
      check('Test run (after native confirm) → exit code 3, stdout and stderr', exit.includes('3') && out.includes('hook-out') && err.includes('hook-err'), `${exit} | ${out.trim()} | ${err.trim()}`)
      await shot('v74-09-hooks-test')
      const settingsFile = path.join(CONFIG, 'settings.json')
      await evaluate(`${rowBy('hook-out')}.querySelector('[data-hook-toggle]').click()`)
      await waitFor(`${rowBy('hook-out')}?.dataset.hookEnabled === 'false'`, 15000, 'off')
      const offJson = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
      const stash = fs.existsSync(path.join(DATA, 'hooks-disabled.json')) ? fs.readFileSync(path.join(DATA, 'hooks-disabled.json'), 'utf8') : ''
      check('Turn off → removed from settings.json, kept in the data dir stash, .ccm-backup written', !JSON.stringify(offJson).includes('hook-out') && offJson.theme === 'dark' && JSON.stringify(offJson.hooks?.Stop ?? []).includes('hook-bridge') && stash.includes('hook-out') && fs.existsSync(settingsFile + '.ccm-backup'), JSON.stringify(offJson.hooks))
      check('off row stays listed (struck through)', await evaluate(`${rowBy('hook-out')}?.querySelector('[data-hook-command]').classList.contains('line-through')`))
      await evaluate(`${rowBy('hook-out')}.querySelector('[data-hook-toggle]').click()`)
      await waitFor(`${rowBy('hook-out')}?.dataset.hookEnabled === 'true'`, 15000, 'on again')
      const onJson = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
      const restored = onJson.hooks?.PostToolUse?.[0]
      check('Turn on → restored under the same matcher, stash emptied', restored?.matcher === 'Bash' && restored.hooks?.[0]?.command === HOOK_CMD && restored.hooks[0].timeout === 5 && !fs.readFileSync(path.join(DATA, 'hooks-disabled.json'), 'utf8').includes('hook-out'), JSON.stringify(onJson.hooks))
      const asked = await main.asked()
      check('toggle and test each asked a native confirm', asked.filter((m) => /hook/.test(m)).length >= 3, JSON.stringify(asked.filter((m) => /hook/.test(m))))
      await evaluate(`(() => { const i = document.querySelector('[data-hooks-filter]'); i.value = 'plugin-hook'; i.dispatchEvent(new Event('input')) })()`)
      await sleep(200)
      check('filter narrows to the plugin hook', (await evaluate(`document.querySelectorAll('[data-hook-row]').length`)) === 1)
    })

    await evaluate(`${UI}.setView('workspace')`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes.some((p) => p.state === 'running')`, 20000, 'shell running')
    const rowSel = (name) => `[...document.querySelectorAll('[data-explorer-tree] [role=treeitem]')].find((r) => r.querySelector('[data-row-name]')?.textContent.trim() === ${JSON.stringify(name)})`
    const menuOn = async (name, id) => {
      await evaluate(`if (!document.querySelector('[data-explorer-tree]')) document.querySelector('[data-explorer-toggle]').click()`)
      await waitFor(`!!(${rowSel(name)})`, 10000, `${name} row`)
      await evaluate(`(() => { const el = ${rowSel(name)}; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
      await waitFor(`!!document.querySelector('[data-context-menu] [data-menu-id="${id}"]')`, 3000, `${id} menu item`)
      await evaluate(`document.querySelector('[data-context-menu] [data-menu-id="${id}"]').click()`)
    }

    const viFile = path.join(DIR, 'app', 'src', 'main', 'res', 'values-vi', 'strings.xml')
    await step('strings table', async () => {
      await menuOn('l10n.yaml', 'strings')
      await waitFor(`!!document.querySelector('[data-strings-table] [data-strings-col]')`, 15000, 'strings grid')
      const options = await evaluate(`[...document.querySelectorAll('[data-strings-set] option')].map((o) => o.textContent.trim())`)
      check('Explorer menu on l10n.yaml → strings table; Android + ARB sets found', options.length >= 2 && options.some((o) => o.includes('res')) && options.some((o) => o.includes('l10n')), JSON.stringify(options))
      const cols = () => evaluate(`[...document.querySelectorAll('[data-strings-col]')].map((c) => c.dataset.stringsCol)`)
      check('opened on the ARB set (focus = l10n.yaml)', (await evaluate(`document.querySelector('[data-strings-set]').selectedOptions[0].textContent.includes('l10n')`)) && (await cols()).length === 2, JSON.stringify(await cols()))
      const arbCount = await evaluate(`document.querySelector('[data-strings-row="count"] td:nth-of-type(2)')?.dataset.stringsCell`)
      const arbTitle = await evaluate(`document.querySelector('[data-strings-row="title"] td:nth-of-type(2)')?.hasAttribute('data-strings-mismatch')`)
      check('ARB: count missing in vi, {name} placeholder mismatch on title', arbCount === 'missing' && arbTitle === true, `${arbCount} ${arbTitle}`)
      await evaluate(`(() => { const s = document.querySelector('[data-strings-set]'); const i = [...s.options].findIndex((o) => o.textContent.includes('res')); s.value = String(i); s.dispatchEvent(new Event('change')) })()`)
      await waitFor(`!!document.querySelector('[data-strings-row="bye"]')`, 10000, 'android set')
      const c = await cols()
      check('Android set: base + vi columns', c.length === 2 && c[1] === 'vi', JSON.stringify(c))
      const cell = (k) => `document.querySelector('[data-strings-row="${k}"] td:nth-of-type(2)')`
      check('bye missing in vi (icon + text), hello %1$s mismatch, app_name ok', (await evaluate(`${cell('bye')}.dataset.stringsCell`)) === 'missing' && (await evaluate(`${cell('bye')}.textContent.trim()`)) === 'Missing' && (await evaluate(`${cell('hello')}.hasAttribute('data-strings-mismatch')`)) && (await evaluate(`${cell('app_name')}.dataset.stringsCell`)) === 'ok', await evaluate(`${cell('bye')}.textContent.trim()`))
      check('total missing count shown', (await evaluate(`document.querySelector('[data-strings-total]')?.textContent ?? ''`)).includes('1'))
      check('no read-only column on plain files', !(await evaluate(`!!document.querySelector('[data-strings-readonly]')`)))
      await evaluate(`document.querySelector('[data-strings-missing-only]').click()`)
      await sleep(200)
      const warnRows = await evaluate(`[...document.querySelectorAll('[data-strings-row]')].map((r) => r.dataset.stringsRow).sort()`)
      check('Missing only → rows that need work (bye missing, hello mismatch), not app_name', JSON.stringify(warnRows) === '["bye","hello"]', JSON.stringify(warnRows))
      await evaluate(`document.querySelector('[data-strings-missing-only]').click()`)
      await evaluate(`(() => { const i = document.querySelector('[data-strings-search]'); i.value = 'hello'; i.dispatchEvent(new Event('input')) })()`)
      await sleep(200)
      check('search filters rows', JSON.stringify(await evaluate(`[...document.querySelectorAll('[data-strings-row]')].map((r) => r.dataset.stringsRow)`)) === '["hello"]')
      await evaluate(`(() => { const i = document.querySelector('[data-strings-search]'); i.value = ''; i.dispatchEvent(new Event('input')) })()`)
      await sleep(200)
      await shot('v74-10-strings')
      await evaluate(`${cell('bye')}.querySelector('[data-strings-edit]').click()`)
      await waitFor(`!!document.querySelector('[data-strings-editor]')`, 3000, 'editor')
      await evaluate(`(() => { const t = document.querySelector('[data-strings-editor]'); t.value = 'Tạm biệt'; t.dispatchEvent(new Event('input')) })()`)
      await sleep(100)
      await evaluate(`document.querySelector('[data-strings-save]').click()`)
      await waitFor(`!!document.querySelector('[data-compare-primary]')`, 5000, 'diff dialog')
      check('Save → diff dialog with "Write file"', (await evaluate(`document.querySelector('[data-compare-primary]').textContent.trim()`)) === 'Write file')
      check('file untouched until Write', fs.readFileSync(viFile, 'utf8') === STRINGS_VI)
      await shot('v74-11-strings-diff')
      await evaluate(`document.querySelector('[data-compare-primary]').click()`)
      await waitFor(`!document.querySelector('[data-compare-primary]') && !!document.querySelector('[data-strings-notice]')`, 10000, 'written')
      const after = fs.readFileSync(viFile, 'utf8')
      const before = STRINGS_VI.split('\n')
      const now = after.split('\n')
      check('vi strings.xml gets bye, every other line untouched and in order', now.length === before.length + 1 && now.some((l) => l.trim() === '<string name="bye">Tạm biệt</string>') && now.filter((l) => !l.includes('"bye"')).join('\n') === STRINGS_VI, JSON.stringify(after))
      check('cell now ok + notice', (await evaluate(`${cell('bye')}.dataset.stringsCell`)) === 'ok' && (await evaluate(`document.querySelector('[data-strings-notice]').textContent`)).includes('bye'))
      check('base strings.xml untouched', fs.readFileSync(path.join(DIR, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8') === STRINGS_BASE)
      await shot('v74-12-strings-saved')
      await esc()
      check('Esc closes the table after a write', await waitFor(`!document.querySelector('[data-strings-table]')`, 5000, 'closed').catch(() => false))
      await evaluate(`document.querySelector('[data-strings-table] [aria-label="Close"]')?.click()`)
    })

    await step('strings palette', async () => {
      await waitFor(`!document.querySelector('[data-strings-table]')`, 3000, 'table closed before the palette')
      await cmd('Page.bringToFront')
      await evaluate(`document.activeElement?.blur?.(); document.body.focus()`)
      await key('k', 'KeyK', 75, process.platform === 'darwin' ? 4 : 2)
      await waitFor(`${UI}.paletteOpen`, 5000, 'palette open').catch(() => evaluate(`${UI}.paletteOpen = true`))
      await sleep(300)
      await app.type('Strings table')
      await sleep(400)
      const hit = await evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find((r) => r.textContent.includes('Strings table')); o?.click(); return !!o })()`)
      await waitFor(`!!document.querySelector('[data-strings-table] [data-strings-col]')`, 10000, 'strings from palette').catch(() => {})
      check('Ctrl+K "Strings table" opens it for the active project', hit && (await evaluate(`!!document.querySelector('[data-strings-table] [data-strings-col]')`)))
      await esc()
      await waitFor(`!document.querySelector('[data-strings-table]')`, 5000, 'closed').catch(() => {})
    })

    await step('library updates', async () => {
      const libRow = (n) => `document.querySelector('[data-lib-row="${n}"]')`
      const rowOf = (n) => evaluate(`(() => { const r = ${libRow(n)}; return r ? { status: r.dataset.libStatus, bump: r.dataset.libBump ?? null, text: r.textContent.replace(/\\s+/g, ' ').trim() } : null })()`)
      await menuOn('pubspec.yaml', 'lib-updates')
      await waitFor(`!!document.querySelector('[data-lib-updates]') && !!${libRow('http')}?.dataset.libStatus && ${libRow('http')}.dataset.libStatus !== 'unknown'`, 15000, 'pub rows')
      const http_ = await rowOf('http')
      const path_ = await rowOf('path')
      const coll = await rowOf('collection')
      const lints = await rowOf('lints')
      check('pub: http 1.2.0 → 1.2.2 patch', http_?.status === 'outdated' && http_.bump === 'patch' && http_.text.includes('1.2.2'), JSON.stringify(http_))
      check('pub: path 1.8.0 → 1.9.1 minor', path_?.status === 'outdated' && path_.bump === 'minor', JSON.stringify(path_))
      check('pub: lints 4.0.0 → 5.1.0 major (amber, warning text)', lints?.status === 'outdated' && lints.bump === 'major' && lints.text.includes('Major'), JSON.stringify(lints))
      check('pub: collection current', coll?.status === 'current', JSON.stringify(coll))
      check('summary counts 3 outdated, all pre-picked', (await evaluate(`document.querySelector('[data-libs-summary]')?.textContent ?? ''`)).includes('3') && (await evaluate(`document.querySelectorAll('[data-lib-pick]:checked').length`)) === 3)
      await evaluate(`document.querySelector('[data-libs-outdated-only]')?.click()`)
      await sleep(200)
      check('Outdated only hides the current row', !(await evaluate(`!!${libRow('collection')}`)) && (await evaluate(`document.querySelectorAll('[data-lib-row]').length`)) === 3)
      await shot('v74-13-libs-pub')
      const pubHits = hits.filter((h) => h.startsWith('/pub/')).length
      await evaluate(`document.querySelector('[data-libs-recheck]').click()`)
      await sleep(1500)
      check('Check again asks the registry again (fresh)', hits.filter((h) => h.startsWith('/pub/')).length > pubHits, `${pubHits} → ${hits.filter((h) => h.startsWith('/pub/')).length}`)
      await esc()
      await waitFor(`!document.querySelector('[data-lib-updates]')`, 5000, 'closed')

      await menuOn('package.json', 'lib-updates')
      await waitFor(`!!${libRow('vue')}?.dataset.libStatus && ${libRow('vue')}.dataset.libStatus !== 'unknown'`, 15000, 'npm rows')
      const vue = await rowOf('vue')
      const vitest = await rowOf('vitest')
      check('npm: vue ^3.4.0 → 3.5.13 minor (4.0.0-beta ignored as latest stable)', vue?.status === 'outdated' && vue.bump === 'minor' && vue.text.includes('3.5.13'), JSON.stringify(vue))
      check('npm: vitest ^2.0.0 → 3.2.4 major', vitest?.status === 'outdated' && vitest.bump === 'major', JSON.stringify(vitest))
      await esc()
      await waitFor(`!document.querySelector('[data-lib-updates]')`, 5000, 'closed')

      await evaluate(`${UI}.libUpdates = { path: ${JSON.stringify(path.join(DIR, 'gradle', 'libs.versions.toml'))}, root: ${JSON.stringify(DIR)} }`)
      await waitFor(`!!${libRow('com.squareup.okhttp3:okhttp')}?.dataset.libStatus && ${libRow('com.squareup.okhttp3:okhttp')}.dataset.libStatus !== 'unknown'`, 15000, 'maven rows')
      const ktx = await rowOf('androidx.core:core-ktx')
      const ok = await rowOf('com.squareup.okhttp3:okhttp')
      check('Google Maven: androidx core-ktx 1.13.1 → 1.15.0 minor', ktx?.status === 'outdated' && ktx.bump === 'minor', JSON.stringify(ktx))
      check('Maven Central: okhttp 4.12.0 → 5.0.0 major', ok?.status === 'outdated' && ok.bump === 'major', JSON.stringify(ok))
      check('only the loopback registry was asked (google/central paths)', hits.includes('/google/androidx/core/core-ktx/maven-metadata.xml') && hits.includes('/central/com/squareup/okhttp3/okhttp/maven-metadata.xml'))
      await shot('v74-14-libs-maven')
      await esc()
      check('dependency files never edited', fs.readFileSync(path.join(DIR, 'pubspec.yaml'), 'utf8') === PUBSPEC && fs.readFileSync(path.join(DIR, 'package.json'), 'utf8') === PACKAGE && fs.readFileSync(path.join(DIR, 'gradle', 'libs.versions.toml'), 'utf8') === TOML)
      check('cache kept in the data dir', fs.existsSync(path.join(DATA, 'lib-versions-cache.json')))
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await shot('v74-99-error').catch(() => {})
  } finally {
    main?.close()
    app.stop()
    server.close()
    fs.writeFileSync(path.join(OUT, 'results-v74.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    for (const d of [DIR, FAKE]) try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
