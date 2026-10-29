// v72 device and agent tools against fakes: background context (CLAUDE.md sizes), permission prompts advisor (seeded
// bridge log, tick only — Add opens a native confirm with the diff, never clicked), Run pane crash chip (fake flutter
// emits an unhandled Dart exception), device screenshot + view inspector and UI test panel (fake adb), What's new 2.4.0.
// The real phone, if one is plugged in, is never seen: adb comes from the fake ANDROID_HOME. No prompt is ever sent.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const UI = `${S}.get('ui')`
const R = `${S}.get('run')`
const MOD = process.platform === 'darwin' ? 4 : 2
const WIN = process.platform === 'win32'
const VERSION = require('../package.json').version
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v72-')))
const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-v72fake-')))
const CONFIG = path.join(FAKE, 'claude-config')
const FLUTTER_DIR = path.join(DIR, 'flutter_demo')
const SDK = { flutterSdk: path.join(FAKE, 'flutter'), androidSdk: path.join(FAKE, 'android-sdk'), jdk: path.join(FAKE, 'jdk') }
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const DEVICE = 'emulator-5554'
const DATA = path.join(OUT, 'run', 'data')

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

function wrapper(file, name, kind) {
  const script = path.join(TOOLS, `${name}.js`)
  if (!WIN) {
    write(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
    return fs.chmodSync(file, 0o755)
  }
  if (kind === 'bat') return write(file, `@echo off\r\n"${process.execPath}" "${script}" %*\r\nexit /b %errorlevel%\r\n`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(path.join(FAKE, 'launcher.exe'), file)
}

function fakes() {
  const src = path.join(__dirname, 'fixtures', 'run-fakes')
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  for (const f of ['flutter.js', 'adb.js', 'java.js']) fs.copyFileSync(path.join(src, f), path.join(TOOLS, f))
  if (WIN) {
    const cs = path.join(FAKE, 'launcher.cs')
    fs.writeFileSync(cs, fs.readFileSync(path.join(src, 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
    const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${path.join(FAKE, 'launcher.exe')}`, cs], { stdio: 'pipe' })
  }
  wrapper(path.join(SDK.flutterSdk, 'bin', WIN ? 'flutter.bat' : 'flutter'), 'flutter', 'bat')
  wrapper(path.join(SDK.androidSdk, 'platform-tools', WIN ? 'adb.exe' : 'adb'), 'adb', 'exe')
  wrapper(path.join(SDK.jdk, 'bin', WIN ? 'java.exe' : 'java'), 'java', 'exe')
  fs.writeFileSync(path.join(STATE, 'flutter-mode'), 'crash')
}

function fixture() {
  write(path.join(DIR, 'CLAUDE.md'), '# E2E project memory\n\n' + 'Keep answers short.\n'.repeat(120))
  write(path.join(DIR, '.claude', 'settings.local.json'), '{\n  "permissions": {\n    "allow": ["Bash(git status:*)"]\n  }\n}\n')
  write(path.join(CONFIG, 'CLAUDE.md'), '# E2E user memory\n\nBe polite.\n')
  write(path.join(DIR, 'app', 'build.gradle'), "plugins {\n    id 'com.android.application'\n}\nandroid {\n    namespace 'com.example.demo'\n    defaultConfig {\n        applicationId 'com.example.demo'\n    }\n}\n")
  write(
    path.join(DIR, 'app', 'src', 'main', 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application>\n    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n      <intent-filter>\n        <action android:name="android.intent.action.VIEW" />\n        <category android:name="android.intent.category.DEFAULT" />\n        <category android:name="android.intent.category.BROWSABLE" />\n        <data android:scheme="demo" android:host="shop" android:pathPrefix="/cart" />\n      </intent-filter>\n    </activity>\n  </application>\n</manifest>\n',
  )
  write(path.join(DIR, 'app', 'src', 'main', 'res', 'values-vi', 'strings.xml'), '<resources>\n    <string name="hello">Xin chào</string>\n</resources>\n')
  write(path.join(FLUTTER_DIR, 'pubspec.yaml'), 'name: flutter_demo\nenvironment:\n  sdk: ^3.9.0\ndependencies:\n  flutter:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n')
  write(path.join(FLUTTER_DIR, 'lib', 'main.dart'), "import 'package:flutter/material.dart';\n\nvoid main() {\n  // entry\n  runApp(const DemoApp())\n}\n")
  fs.mkdirSync(path.join(FLUTTER_DIR, 'android'), { recursive: true })
  write(path.join(FLUTTER_DIR, '.dart_tool', 'package_config.json'), '{"configVersion":2,"packages":[]}\n')
  write(path.join(FLUTTER_DIR, 'pubspec.lock'), 'packages: {}\n')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(path.join(FLUTTER_DIR, 'pubspec.lock'), later, later)
  execFileSync('git', ['-c', 'user.name=e2e', '-c', 'user.email=e2e@local', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', 'main'], { cwd: DIR, stdio: 'pipe' })
}

/** Bridge log lines as scripts/hook-bridge.mjs writes them; one is older than the advisor's window. */
function seedAsks() {
  const at = (minAgo) => new Date(Date.now() - minAgo * 60_000).toISOString()
  const rows = [
    ...[5, 4, 3].map((m) => ({ at: at(m), cwd: DIR, tool: 'Bash', rules: [], prefix: 'npm test' })),
    ...[9, 8].map((m) => ({ at: at(m), cwd: path.join(DIR, 'app'), tool: 'WebFetch', rules: ['WebFetch(domain:example.com)'] })),
    { at: at(7), cwd: DIR, tool: 'Bash', rules: [], prefix: 'git status' },
    { at: at(6), cwd: DIR, tool: 'Bash', rules: [], prefix: 'rm -rf' },
    { at: at(60 * 24 * 30), cwd: DIR, tool: 'Bash', rules: [], prefix: 'npm run old' },
    { at: at(2), cwd: path.join(os.tmpdir(), 'elsewhere'), tool: 'Bash', rules: [], prefix: 'npm run other' },
  ]
  write(path.join(DATA, 'hooks', 'permission-asks.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

async function main() {
  fixture()
  try {
    fakes()
  } catch (e) {
    check('fake tools', false, e.message)
    return
  }
  const env = { FLUTTER_ROOT: SDK.flutterSdk, ANDROID_HOME: SDK.androidSdk, ANDROID_SDK_ROOT: SDK.androidSdk, JAVA_HOME: SDK.jdk, CLAUDE_CONFIG_DIR: CONFIG }
  const app = await launch(process.argv[2] ? { exe: process.argv[2], env } : { env })
  const { evaluate, waitFor, shot, sleep, cmd, key, type } = app
  const esc = () => key('Escape', 'Escape', 27)
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      check(name, false, e.message)
      await shot(`v72-err-${name.replace(/\W+/g, '-')}`).catch(() => {})
      await esc().catch(() => {})
    }
  }
  const palette = async (label) => {
    await cmd('Page.bringToFront')
    await evaluate(`document.activeElement?.blur?.(); document.body.focus()`)
    await key('k', 'KeyK', 75, MOD)
    await waitFor(`${UI}.paletteOpen`, 5000, 'palette open').catch(() => evaluate(`${UI}.paletteOpen = true`))
    await sleep(300)
    await type(label)
    await sleep(400)
    return evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find((r) => r.textContent.includes(${JSON.stringify(label)})); o?.click(); return !!o })()`)
  }
  const shellKey = () => evaluate(`${W}.panes.find((p) => (p.kind ?? 'term') === 'term')?.key`)
  try {
    await waitFor(`!!window.ccmDesktop && !!${UI}`, 30000, 'app ready')
    await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.whatsNew.seen','${VERSION}'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.locale','en'); localStorage.setItem('ccm.theme','dark')`)
    seedAsks()
    await cmd('Page.reload')
    await waitFor(`!!${UI}`, 15000, 'reloaded')
    await evaluate(`${UI}.view = 'workspace'`)
    await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
    await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
    await waitFor(`${W}.panes.some((p) => p.state === 'running')`, 20000, 'shell running')

    await step("what's new", async () => {
      check("What's new is in Ctrl+K", await palette("What's new"))
      await waitFor(`!!document.querySelector('[data-whats-new]')`, 5000, 'whats new dialog')
      const items = await evaluate(`document.getElementById('whats-new-h-${VERSION}')?.nextElementSibling?.textContent ?? ''`)
      const want = ['Device screenshot', 'Inspect views', 'Test UI on a device', 'deep links', 'catches Android and Flutter crashes', 'Fill a crash into the agent', 'Permission prompts per project', 'settings.local.json', 'Background context']
      const missing = want.filter((w) => !items.includes(w))
      check(`${VERSION} lists the v72 bullets`, VERSION === '2.4.0' && !missing.length, missing.join(', ') || VERSION)
      await shot('v72-01-whats-new')
      await esc()
      await waitFor(`!document.querySelector('[data-whats-new]')`, 5000, 'closed').catch(() => {})
    })

    await step('background context', async () => {
      await evaluate(`${W}.activate('${await shellKey()}')`)
      check('Background context is in Ctrl+K', await palette('Background context'))
      await waitFor(`!!document.querySelector('[data-ctx-sources] [data-ctx-total]')`, 10000, 'context dialog')
      await waitFor(`document.querySelectorAll('[data-ctx-sources] [data-ctx-file]').length >= 2`, 5000, 'files').catch(() => {})
      const rows = await evaluate(`[...document.querySelectorAll('[data-ctx-sources] [data-ctx-file]')].map((r) => ({ file: r.querySelector('button').textContent.trim(), text: r.textContent.replace(/\\s+/g, ' ').trim() }))`)
      const project = rows.find((r) => r.file === 'CLAUDE.md')
      check('lists the project CLAUDE.md with lines and KB size', !!project && /122 lines/.test(project.text) && /\d+\.\d KB/.test(project.text), JSON.stringify(rows))
      check('lists the user CLAUDE.md from CLAUDE_CONFIG_DIR', rows.some((r) => r.file.endsWith('claude-config/CLAUDE.md') && r.text.startsWith('user')), JSON.stringify(rows))
      const note = await evaluate(`document.querySelector('[data-ctx-sources]').textContent`)
      check('says KB is file size, not tokens', note.includes('KB is the file size on disk, not tokens.'))
      check('total for the start of a session', /KB/.test(await evaluate(`document.querySelector('[data-ctx-total]').textContent`)))
      check('shell pane: no measured tokens are invented', !(await evaluate(`!!document.querySelector('[data-ctx-first]')`)))
      check('no file text reaches the page', !note.includes('Keep answers short'))
      await shot('v72-02-context')
      await evaluate(`[...document.querySelectorAll('[data-ctx-sources] [data-ctx-file] button')].find((b) => b.textContent.trim() === 'CLAUDE.md')?.click()`)
      await waitFor(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('CLAUDE.md'))`, 8000, 'opened').catch(() => {})
      check('a row opens the file and closes the dialog', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('CLAUDE.md')) && !document.querySelector('[data-ctx-sources]')`))
    })

    await step('permission advisor', async () => {
      await evaluate(`${W}.activate('${await shellKey()}')`)
      check('Permission prompts is in Ctrl+K', await palette('Permission prompts'))
      await waitFor(`!!document.querySelector('[data-perm-advisor] [data-perm-file]')`, 10000, 'perm dialog')
      const rows = await evaluate(`[...document.querySelectorAll('[data-perm-row]')].map((r) => ({ rule: r.querySelector('[data-perm-rule]')?.value ?? r.textContent.replace(/\\s+/g, ' ').trim(), tick: !!r.querySelector('[data-perm-tick]'), text: r.textContent.replace(/\\s+/g, ' ').trim() }))`)
      check('four grouped suggestions from the seeded log (old and other-project asks left out)', rows.length === 4, JSON.stringify(rows))
      check('most frequent first: Bash(npm test:*) × 3, tickable', rows[0]?.rule === 'Bash(npm test:*)' && rows[0].tick && /3/.test(rows[0].text), JSON.stringify(rows[0]))
      check("Claude's own suggestion from a subfolder: WebFetch(domain:example.com)", rows.some((r) => r.rule === 'WebFetch(domain:example.com)' && r.tick))
      check('rule already in settings.local.json is marked, not tickable', rows.some((r) => r.text.includes('Bash(git status:*)') && !r.tick))
      check('risky rm prefix is a warning only', rows.some((r) => r.text.includes('Bash(rm -rf:*)') && !r.tick))
      check('local file rules listed', (await evaluate(`document.querySelector('[data-perm-file="local"]').textContent`)).includes('Bash(git status:*)'))
      check('Add is disabled with nothing ticked', await evaluate(`document.querySelector('[data-perm-add]').disabled`))
      await evaluate(`document.querySelector('[data-perm-tick]').click()`)
      await sleep(200)
      check('ticking one enables Add (1)', await evaluate(`!document.querySelector('[data-perm-add]').disabled && /1/.test(document.querySelector('[data-perm-add]').textContent)`))
      const ruleInput = `document.querySelector('[data-perm-rule]')`
      await evaluate(`(() => { const el = ${ruleInput}; el.value = 'Bash(rm -rf:*)'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
      await sleep(200)
      check('editing a tick into a risky rule blocks Add', await evaluate(`document.querySelector('[data-perm-add]').disabled && ${ruleInput}.getAttribute('aria-invalid') === 'true'`))
      await evaluate(`(() => { const el = ${ruleInput}; el.value = 'Bash(npm test:*)'; el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
      await sleep(200)
      check('settings.local.json untouched (Add not clicked: its diff lives in a native confirm)', fs.readFileSync(path.join(DIR, '.claude', 'settings.local.json'), 'utf8').includes('"Bash(git status:*)"') && !fs.readFileSync(path.join(DIR, '.claude', 'settings.local.json'), 'utf8').includes('npm test'))
      await shot('v72-03-perms')
      await esc()
      await waitFor(`!document.querySelector('[data-perm-advisor]')`, 5000, 'closed').catch(() => {})
      check('Esc closes the advisor', await evaluate(`!document.querySelector('[data-perm-advisor]') && !${UI}.permAdvisor`))
    })

    await step('run crash', async () => {
      await evaluate(`${R}.updateSettings(${JSON.stringify(SDK)})`)
      await evaluate(`${W}.openRun(${JSON.stringify(DIR)})`)
      await waitFor(`!!document.querySelector('[data-run-pane] [data-run-start]')`, 15000, 'run pane')
      await waitFor(`${R}.selectedConfig(${JSON.stringify(DIR)})?.type === 'flutter'`, 15000, 'flutter config')
      await waitFor(`${R}.devicesFor(${R}.selectedConfig(${JSON.stringify(DIR)})).some((d) => d.id === '${DEVICE}')`, 30000, 'device')
      await evaluate(`document.querySelector('[data-run-menu-button=device]').click()`)
      await waitFor(`!!document.querySelector('[data-run-menu] [role=menuitemradio]')`, 10000, 'device menu')
      await evaluate(`[...document.querySelectorAll('[data-run-menu] [role=menuitemradio]')].find((b) => b.title === '${DEVICE}')?.click()`)
      await sleep(300)
      await waitFor(`!!document.querySelector('[data-run-pane] [data-run-capture]')`, 5000, 'camera').catch(() => {})
      check('Run pane shows the screenshot button for the Android device', await evaluate(`!!document.querySelector('[data-run-pane] [data-run-capture]')`))
      await waitFor(`!document.querySelector('[data-run-start]').disabled`, 10000, 'run enabled')
      await evaluate(`document.querySelector('[data-run-start]').click()`)
      await waitFor(`!!document.querySelector('[data-run-pane] [data-run-crash]')`, 30000, 'crash chip').catch(() => {})
      check('crash chip appears from the unhandled exception', await evaluate(`!!document.querySelector('[data-run-pane] [data-run-crash]')`), await evaluate(`document.querySelector('[data-run-pane] [role=log]')?.textContent.slice(-300) ?? ''`))
      await evaluate(`document.querySelector('[data-run-crash]').click()`)
      await waitFor(`!!document.querySelector('[data-run-crash-panel]')`, 5000, 'crash panel')
      const detail = await evaluate(`document.querySelector('[data-run-crash-detail]').textContent`)
      check('panel shows the Dart exception and message', detail.includes('Bad state') && detail.includes('e2e crash'), detail.slice(0, 200))
      await waitFor(`!!document.querySelector('[data-run-crash-frame]')`, 10000, 'own frame').catch(() => {})
      const frames = await evaluate(`[...document.querySelectorAll('[data-run-crash-frame]')].map((b) => b.textContent.trim())`)
      check('only the project frame (main.dart) is a link', frames.length === 1 && frames[0].includes('main.dart'), JSON.stringify(frames))
      await shot('v72-04-crash')
      await evaluate(`document.querySelector('[data-run-crash-frame]')?.click()`)
      await waitFor(`${W}.panes.some((p) => p.kind === 'file' && p.path.endsWith('main.dart'))`, 8000, 'main.dart').catch(() => {})
      check('frame opens lib/main.dart', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path.replace(/\\\\/g, '/').endsWith('flutter_demo/lib/main.dart'))`))
      await evaluate(`${W}.openRun(${JSON.stringify(DIR)})`)
      await waitFor(`!document.querySelector('[data-run-stop]')?.disabled`, 5000, 'stop').catch(() => {})
      await evaluate(`document.querySelector('[data-run-stop]')?.click()`)
      await waitFor(`${R}.focusedSession(${JSON.stringify(DIR)})?.state === 'stopped'`, 15000, 'stopped').catch(() => {})
    })

    const row = `document.querySelector('[data-dev-row="${DEVICE}"]')`
    await step('device capture', async () => {
      await evaluate(`${UI}.view = 'devices'`)
      await waitFor(`!!${row}?.querySelector('[data-dev-action=capture]')`, 20000, 'device row')
      await evaluate(`${row}.querySelector('[data-dev-action=capture]').click()`)
      await waitFor(`!!document.querySelector('[data-device-capture] img')?.naturalWidth`, 15000, 'screenshot').catch(() => {})
      check('screenshot decodes (4 × 8 fake PNG)', (await evaluate(`document.querySelector('[data-device-capture] img')?.naturalWidth`)) === 4, await evaluate(`document.querySelector('[data-capture-error]')?.textContent ?? ''`))
      await evaluate(`document.querySelector('[data-capture-inspect]').click()`)
      await waitFor(`!!document.querySelector('[data-capture-overlay]')`, 10000, 'overlay')
      check('view dump: both nodes counted', (await evaluate(`document.querySelector('[data-capture-panel]').textContent`)).includes('2'))
      await evaluate(`(() => { const s = document.querySelector('[data-capture-overlay]'); const r = s.getBoundingClientRect(); s.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.8 })) })()`)
      await waitFor(`!!document.querySelector('[data-capture-node]')`, 5000, 'node').catch(() => {})
      const node = await evaluate(`document.querySelector('[data-capture-node]')?.textContent ?? ''`)
      check('clicking the lower half selects the Button (id + text)', node.includes('android.widget.Button') && node.includes('buy_button') && node.includes('Buy now'), node)
      check('Find in files is offered for the id', await evaluate(`!document.querySelector('[data-capture-find]').disabled`))
      await shot('v72-05-capture')
      await esc()
      await waitFor(`!document.querySelector('[data-device-capture]')`, 5000, 'closed').catch(() => {})
      check('Esc closes the capture dialog', await evaluate(`!document.querySelector('[data-device-capture]')`))
    })

    await step('device ui test', async () => {
      await evaluate(`${row}.querySelector('[data-dev-action=uiTest]').click()`)
      await waitFor(`!!document.querySelector('[data-device-uitest] [data-uitest-display]')`, 15000, 'ui test state')
      check('project from the workspace tab is picked', (await evaluate(`document.querySelector('[data-uitest-root]').value`)) === DIR)
      check('package from the manifest / Gradle', (await evaluate(`document.querySelector('[data-uitest-pkg]').value`)) === 'com.example.demo')
      const launches = await evaluate(`document.querySelector('[data-uitest-rows]')?.textContent.replace(/\\s+/g, ' ') ?? ''`)
      check('deep link and exported activity listed', launches.includes('demo://shop/cart') && launches.includes('MainActivity'), launches)
      check('SDK read from the device', (await evaluate(`document.querySelector('[data-device-uitest]').textContent`)).includes('34'))
      check('nothing changed yet', await evaluate(`!document.querySelector('[data-uitest-changed]') && document.querySelector('[data-uitest-restore]').disabled`))
      await evaluate(`(document.querySelector('[data-uitest-dark] [role=switch]') ?? document.querySelector('[data-uitest-dark] input') ?? document.querySelector('[data-uitest-dark]')).click()`)
      await waitFor(`!!document.querySelector('[data-uitest-changed]')`, 8000, 'changed chip').catch(() => {})
      const night = () => { try { return JSON.parse(fs.readFileSync(path.join(STATE, 'ui.json'), 'utf8')).night } catch { return null } }
      check('dark mode → cmd uimode night yes on the (fake) device, 1 changed', night() === 'yes' && /1/.test(await evaluate(`document.querySelector('[data-uitest-changed]')?.textContent ?? ''`)), String(night()))
      await shot('v72-06-uitest')
      await evaluate(`document.querySelector('[data-uitest-restore]').click()`)
      await waitFor(`!document.querySelector('[data-uitest-changed]')`, 8000, 'restored').catch(() => {})
      check('Restore all puts night mode back', night() === 'no' && (await evaluate(`!document.querySelector('[data-uitest-changed]')`)), String(night()))
      await esc()
      await waitFor(`!document.querySelector('[data-device-uitest]')`, 5000, 'closed').catch(() => {})
      check('Esc closes the UI test panel', await evaluate(`!document.querySelector('[data-device-uitest]')`))
    })

    check('no horizontal page scroll', await evaluate(`document.documentElement.scrollWidth <= innerWidth`))
  } catch (e) {
    check('run', false, e.message)
    await shot('v72-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-v72.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    for (const d of [DIR, FAKE]) try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
  }
}
main().then(() => process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0))
