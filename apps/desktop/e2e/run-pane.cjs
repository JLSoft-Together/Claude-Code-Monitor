// v31 Run pane against fake tools: flutter (bin/flutter[.bat]), adb, java and gradlew live in temp dirs and are found
// through the Run SDK settings + FLUTTER_ROOT / ANDROID_HOME / JAVA_HOME, so no SDK, JDK or device is needed.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const W = `${S}.get('workspace')`
const R = `${S}.get('run')`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const WIN = process.platform === 'win32'
const DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-run-')))
const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-runfake-')))
const FLUTTER_DIR = path.join(DIR, 'flutter_demo')
const ANDROID_DIR = path.join(DIR, 'android_demo')
const SDK = { flutterSdk: path.join(FAKE, 'flutter'), androidSdk: path.join(FAKE, 'android-sdk'), jdk: path.join(FAKE, 'jdk') }
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const DEVICE = 'emulator-5554'

const write = (file, text, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  if (mode) fs.chmodSync(file, mode)
}

/** A command that runs `node <TOOLS>/<name>.js`: .bat for flutter/gradlew on Windows, a compiled .exe for adb/java (spawned without a shell), sh elsewhere. */
function wrapper(file, name, kind) {
  const script = path.join(TOOLS, `${name}.js`)
  if (!WIN) return write(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, 0o755)
  if (kind === 'bat') return write(file, `@echo off\r\n"${process.execPath}" "${script}" %*\r\nexit /b %errorlevel%\r\n`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(path.join(FAKE, 'launcher.exe'), file)
}

function fakes() {
  const src = path.join(__dirname, 'fixtures', 'run-fakes')
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  for (const f of ['flutter.js', 'adb.js', 'java.js', 'gradle.js']) fs.copyFileSync(path.join(src, f), path.join(TOOLS, f))
  if (WIN) {
    const cs = path.join(FAKE, 'launcher.cs')
    fs.writeFileSync(cs, fs.readFileSync(path.join(src, 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
    const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${path.join(FAKE, 'launcher.exe')}`, cs], { stdio: 'pipe' })
  }
  wrapper(path.join(SDK.flutterSdk, 'bin', WIN ? 'flutter.bat' : 'flutter'), 'flutter', 'bat')
  wrapper(path.join(SDK.androidSdk, 'platform-tools', WIN ? 'adb.exe' : 'adb'), 'adb', 'exe')
  wrapper(path.join(SDK.jdk, 'bin', WIN ? 'java.exe' : 'java'), 'java', 'exe')
  wrapper(path.join(ANDROID_DIR, WIN ? 'gradlew.bat' : 'gradlew'), 'gradle', 'bat')
}

function fixture() {
  write(path.join(FLUTTER_DIR, 'pubspec.yaml'), 'name: flutter_demo\nenvironment:\n  sdk: ^3.9.0\ndependencies:\n  flutter:\n    sdk: flutter\nflutter:\n  uses-material-design: true\n')
  write(path.join(FLUTTER_DIR, 'lib', 'main.dart'), "import 'package:flutter/material.dart';\n\nvoid main() {\n  // entry\n  runApp(const DemoApp())\n}\n")
  fs.mkdirSync(path.join(FLUTTER_DIR, 'android'), { recursive: true })
  write(path.join(FLUTTER_DIR, '.dart_tool', 'package_config.json'), '{"configVersion":2,"packages":[]}\n')
  write(path.join(FLUTTER_DIR, 'pubspec.lock'), 'packages: {}\n')
  const later = new Date(Date.now() + 5000)
  fs.utimesSync(path.join(FLUTTER_DIR, 'pubspec.lock'), later, later)

  write(path.join(ANDROID_DIR, 'settings.gradle'), "rootProject.name = 'android_demo'\ninclude ':app'\n")
  write(path.join(ANDROID_DIR, 'app', 'build.gradle'), "plugins {\n    id 'com.android.application'\n}\nandroid {\n    namespace 'com.example.demo'\n}\n")
  write(
    path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml'),
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application>\n    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter>\n        <action android:name="android.intent.action.MAIN" />\n        <category android:name="android.intent.category.LAUNCHER" />\n      </intent-filter>\n    </activity>\n  </application>\n</manifest>\n',
  )
}

const calls = () => {
  try {
    return fs.readFileSync(path.join(STATE, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((l) => ({ argv: [], ...JSON.parse(l) }))
  } catch {
    return []
  }
}
const called = (pred) => calls().some(pred)

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd } = app
  const until = async (pred, ms, label) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (pred()) return true
      await sleep(200)
    }
    throw new Error('timeout: ' + label)
  }
  const stateText = () => evaluate(`document.querySelector('[data-run-pane] [data-run-state]')?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)
  const logText = () => evaluate(`document.querySelector('[data-run-pane] [role=log]')?.textContent ?? ''`)
  const tab = (v) => evaluate(`document.querySelector('[data-run-pane] [data-run-tab=${v}]').click()`)
  const focused = `${R}.focusedSession(${JSON.stringify(DIR)})`
  const pickMenu = async (menu, match) => {
    await evaluate(`document.querySelector('[data-run-menu-button=${menu}]').click()`)
    await waitFor(`!!document.querySelector('[data-run-menu] [role=menuitemradio]')`, 10000, `${menu} menu`)
    return evaluate(`(() => { const b = [...document.querySelectorAll('[data-run-menu] [role=menuitemradio]')].find((b) => ${match}); b?.click(); return !!b })()`)
  }
  // Every state main broadcasts for the next session (a hot reload round trip is a few ms: sampling would miss it).
  const recordStates = () =>
    evaluate(`(() => { window.__runStates = []; window.__runSid = null; window.__runOff?.(); window.__runOff = window.ccmDesktop.onRunEvent((e) => {
      if (e.type !== 'session') return
      window.__runSid ??= e.session.id
      if (e.session.id === window.__runSid && window.__runStates.at(-1) !== e.session.state) window.__runStates.push(e.session.state)
    }) })()`)

  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.workspace.preset','shell'); localStorage.setItem('ccm.theme','dark'); localStorage.setItem('ccm.workspace.sidebar','1')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')
  await evaluate(`${S}.get('ui').view = 'workspace'`)
  await waitFor(`!!document.querySelector('[data-launch-row]')`, 15000, 'picker')
  await evaluate(`${W}.open('shell', ${JSON.stringify(DIR)})`)
  await waitFor(`${W}.panes[0]?.state === 'running'`, 20000, 'shell running')

  check('preload exposes the run bridge', await evaluate(`typeof window.ccmDesktop.runStart === 'function' && typeof window.ccmDesktop.onRunEvent === 'function'`))
  const saved = await evaluate(`${R}.updateSettings(${JSON.stringify(SDK)})`)
  check('SDK settings point at the fakes', Object.entries(SDK).every(([k, v]) => saved?.[k] === v), JSON.stringify(saved))

  await evaluate(`${W}.openRun(${JSON.stringify(DIR)})`)
  await waitFor(`!!document.querySelector('[data-run-pane] [data-run-start]')`, 15000, 'run pane')
  await waitFor(`${R}.configsFor(${JSON.stringify(DIR)}).length >= 2`, 15000, 'configs').catch(() => {})
  const cfgs = await evaluate(`${R}.configsFor(${JSON.stringify(DIR)}).map((c) => ({ id: c.id, type: c.type, name: c.name, cwd: c.cwd }))`)
  const flutterCfg = cfgs.find((c) => c.type === 'flutter')
  const androidCfg = cfgs.find((c) => c.type === 'android')
  check('detects the Flutter entrypoint and the Android app module', flutterCfg?.name === 'main.dart' && androidCfg?.name === 'app', JSON.stringify(cfgs))
  check('Flutter config is selected first', await evaluate(`${R}.selectedConfig(${JSON.stringify(DIR)})?.type === 'flutter'`))

  await waitFor(`${R}.envFor(${JSON.stringify(FLUTTER_DIR)}, 'flutter')?.version`, 30000, 'flutter env').catch(() => {})
  const fenv = await evaluate(`JSON.parse(JSON.stringify(${R}.envFor(${JSON.stringify(FLUTTER_DIR)}, 'flutter')))`)
  check('Flutter env from the SDK setting (fake --version --machine)', fenv?.version === '3.35.0' && fenv.source === 'setting' && !fenv.issues.length, JSON.stringify(fenv))
  check('toolbar shows the Flutter version, no env banner', await evaluate(`document.querySelector('[data-run-pane]').textContent.includes('Flutter 3.35.0') && !document.querySelector('[data-run-env]')`))
  check('no pub get banner (package_config + newer lock)', await evaluate(`!document.querySelector('[data-run-pubget]')`))

  await waitFor(`${R}.devicesFor(${R}.selectedConfig(${JSON.stringify(DIR)})).some((d) => d.id === '${DEVICE}')`, 30000, 'device').catch(() => {})
  check('fake device listed (flutter daemon ∪ adb)', await evaluate(`${R}.devices.filter((d) => d.id === '${DEVICE}').length === 1`), await evaluate(`JSON.stringify(${R}.devices)`))
  check('flutter daemon asked for devices', called((c) => c.tool === 'flutter' && c.request === 'device.getDevices'))
  check('adb tracks devices', called((c) => c.tool === 'adb' && c.argv[0] === 'track-devices'))
  check('picked the device from the menu', await pickMenu('device', `b.title === '${DEVICE}'`))
  await waitFor(`[...document.querySelectorAll('[data-run-emulator]')].some((b) => b.title === 'Pixel_7_API_34')`, 10000, 'emulators').catch(() => {})
  await evaluate(`document.querySelector('[data-run-menu-button=device]').click()`)
  await waitFor(`[...document.querySelectorAll('[data-run-emulator]')].some((b) => b.title === 'Pixel_7_API_34')`, 10000, 'emulators').catch(() => {})
  check('emulator listed under Launch', await evaluate(`[...document.querySelectorAll('[data-run-emulator]')].some((b) => b.title === 'Pixel_7_API_34')`))
  await app.key('Escape', 'Escape', 27)
  await sleep(200)
  check('device button shows the device', await evaluate(`document.querySelector('[data-run-menu-button=device]').textContent.includes('sdk gphone64')`))
  await shot('run-01-ready')

  // Explorer: Android / Flutter marks on the project folders (icon + sr-only text + tooltip).
  await app.key('E', 'KeyE', 69, 2 | 8)
  await waitFor(`!!document.querySelector('[data-explorer-tree] [data-run-mark=flutter]')`, 10000, 'explorer marks').catch(() => {})
  check('Explorer marks the Flutter project folder', await evaluate(`!!document.querySelector('[data-explorer-tree] [data-run-mark=flutter]')?.closest('[role=treeitem]')?.textContent.includes('flutter_demo')`))
  check('Explorer marks the Android project folder', await evaluate(`!!document.querySelector('[data-explorer-tree] [data-run-mark=android]')?.closest('[role=treeitem]')?.textContent.includes('android_demo')`))
  check('mark has a tooltip naming the framework', await evaluate(`(document.querySelector('[data-run-mark=flutter]')?.title ?? '').includes('Flutter app')`))

  // Project SDK & toolchain: flutter doctor --machine only on request.
  check('no flutter doctor before asking', !called((c) => c.tool === 'flutter' && c.argv[0] === 'doctor'))
  await evaluate(`document.querySelector('[data-run-menu-button=config]').click()`)
  await waitFor(`!!document.querySelector('[data-run-toolchain-open]')`, 5000, 'toolchain item').catch(() => {})
  await evaluate(`document.querySelector('[data-run-toolchain-open]')?.click()`)
  await waitFor(`!!document.querySelector('[data-run-toolchain] [data-toolchain-check]')`, 5000, 'toolchain dialog').catch(() => {})
  check('toolchain dialog shows the project SDK row', await evaluate(`!!document.querySelector('[data-run-toolchain] [data-run-project-sdk]')`))
  await evaluate(`document.querySelector('[data-toolchain-check]').click()`)
  await waitFor(`!!document.querySelector('[data-toolchain-results]')`, 30000, 'doctor results').catch(() => {})
  const rows = await evaluate(`[...document.querySelectorAll('[data-toolchain-row]')].map((r) => r.dataset.toolchainRow + ':' + r.textContent.replace(/\\s+/g, ' ').trim())`)
  check('flutter doctor --machine results: ok / warning / error rows with text', rows.length === 3 && rows[0].startsWith('ok:Flutter') && rows[1].startsWith('warning:') && rows[2].startsWith('error:') && rows[2].includes('Problem'), JSON.stringify(rows))
  check('doctor ran with --machine', called((c) => c.tool === 'flutter' && c.argv[0] === 'doctor' && c.argv.includes('--machine')))
  await shot('run-01b-toolchain')
  await app.key('Escape', 'Escape', 27)
  await sleep(300)
  // Back to the Projects rail: its header carries the RunBadge checked below.
  await evaluate(`document.querySelector('[data-side-view=projects]')?.click()`)
  await sleep(300)

  // pubspec.yaml edited → watcher re-detects → banner without any click.
  // pubspec newer than the lock, and the lock the fake pub get rewrites later is newer again.
  const past = new Date(Date.now() - 60000)
  fs.utimesSync(path.join(FLUTTER_DIR, 'pubspec.lock'), past, past)
  const now = new Date()
  fs.utimesSync(path.join(FLUTTER_DIR, 'pubspec.yaml'), now, now)
  await waitFor(`!!document.querySelector('[data-run-pubget]')`, 10000, 'pub get banner').catch(() => {})
  check('pub get banner appears after pubspec.yaml changes (watcher)', await evaluate(`!!document.querySelector('[data-run-pubget]')`))

  // Flutter: run → starting (progress) → running → hot reload → stop
  await recordStates()
  await waitFor(`!document.querySelector('[data-run-start]').disabled`, 10000, 'run enabled')
  await evaluate(`document.querySelector('[data-run-start]').click()`)
  await waitFor(`${focused}?.progress?.includes('assembleDebug')`, 15000, 'progress').catch(() => {})
  const busy = await stateText()
  check('Starting… with the progress text', busy.includes('Starting…') && busy.includes("Running Gradle task 'assembleDebug'"), busy)
  check('RunBadge shows Building', await evaluate(`!!document.querySelector('[data-run-badge=busy]')`))
  await waitFor(`${focused}?.state === 'running'`, 20000, 'flutter running')
  await sleep(300)
  check('Running state line', (await stateText()).includes('Running'), await stateText())
  check('RunBadge shows Running', await evaluate(`document.querySelector('[data-run-badge=running]')?.textContent.includes('Running') === true`))
  const order = calls().filter((c) => c.tool === 'flutter' && (c.argv[0] === 'pub' || c.argv[0] === 'run')).map((c) => c.argv[0])
  check('Run ran flutter pub get first (pubspec newer than the lock)', order.indexOf('pub') >= 0 && order.indexOf('pub') < order.lastIndexOf('run'), order.join(','))
  check('pub get shown as a build step', (await evaluate(`window.__runStates`)).includes('before-launch'))
  await waitFor(`!document.querySelector('[data-run-pubget]')`, 10000, 'banner gone').catch(() => {})
  check('pub get banner clears after the lock is rewritten', await evaluate(`!document.querySelector('[data-run-pubget]')`))
  check('run used the device and lib/main.dart', called((c) => c.tool === 'flutter' && c.argv[0] === 'run' && c.argv.includes('--machine') && c.argv.includes(DEVICE) && c.argv.includes('lib/main.dart')))
  check('vm service uri from app.debugPort', (await evaluate(`${focused}?.vmServiceUri`)) === 'ws://127.0.0.1:50123/fakeToken=/ws')
  await waitFor(`document.querySelector('[data-run-pane] [role=log]')?.textContent.includes('Hello from the fake app')`, 8000, 'app log').catch(() => {})
  check('Run log tab shows app.log lines', (await logText()).includes('flutter: Hello from the fake app'))
  await waitFor(`document.querySelector('[data-run-pane] [role=log]')?.textContent.includes('secret at')`, 5000, 'masked line').catch(() => {})
  const secret = (await logText()).split('\n').find((l) => l.includes('secret at')) ?? (await logText())
  check('run log is masked (home → ~, token → [masked])', secret.includes('secret at ~') && secret.includes('[masked]') && !secret.includes(os.homedir()) && !secret.includes('ghp_'), secret.slice(0, 200))
  await tab('build')
  await sleep(200)
  const build = await logText()
  check('Build tab shows the command, progress and plain output', build.includes('> flutter run') && build.includes("Running Gradle task 'assembleDebug'") && build.includes('app-debug.apk'), build.slice(0, 300))
  await tab('run')

  await waitFor(`!document.querySelector('[data-run-reload]').disabled`, 5000, 'reload enabled').catch(() => {})
  await evaluate(`document.querySelector('[data-run-reload]').click()`)
  await until(() => called((c) => c.request === 'app.restart' && c.params?.fullRestart === false), 8000, 'hot reload request').catch(() => {})
  check('Hot reload → app.restart (fullRestart false) reached the fake', called((c) => c.request === 'app.restart' && c.params?.fullRestart === false && c.params?.appId === 'fake-app-1'))
  await waitFor(`document.querySelector('[data-run-pane] [role=log]')?.textContent.includes('reloaded from fake')`, 8000, 'reload log').catch(() => {})
  check('reload output in the log, back to Running', (await logText()).includes('reloaded from fake') && (await evaluate(`${focused}?.state`)) === 'running')
  await waitFor(`!document.querySelector('[data-run-restart]').disabled`, 5000, 'restart enabled').catch(() => {})
  await evaluate(`document.querySelector('[data-run-restart]').click()`)
  await until(() => called((c) => c.request === 'app.restart' && c.params?.fullRestart === true), 8000, 'hot restart').catch(() => {})
  check('Hot restart → fullRestart true', called((c) => c.request === 'app.restart' && c.params?.fullRestart === true))
  await shot('run-02-flutter-running')

  await waitFor(`${focused}?.state === 'running' && !document.querySelector('[data-run-stop]').disabled`, 5000, 'stop enabled').catch(() => {})
  await evaluate(`document.querySelector('[data-run-stop]').click()`)
  await waitFor(`${focused}?.state === 'stopped'`, 15000, 'flutter stopped').catch(() => {})
  check('Stop → app.stop request, Stopped', called((c) => c.request === 'app.stop') && (await stateText()).includes('Stopped'), await stateText())
  check('no badge once stopped', await evaluate(`!document.querySelector('[data-run-badge]')`))
  const fstates = await evaluate(`window.__runStates`)
  check('flutter states starting → running → reloading → running → stopping → stopped', ['starting', 'running', 'reloading', 'stopped'].every((s) => fstates.includes(s)) && fstates.indexOf('starting') < fstates.indexOf('running'), fstates.join(' → '))

  // No ready device: Run opens the device menu (with emulators) instead of doing nothing.
  await evaluate(`${R}.devices = []`)
  await waitFor(`!!document.querySelector('[data-run-start][data-run-no-device]')`, 5000, 'no device').catch(() => {})
  check('Run stays enabled without a device', await evaluate(`!document.querySelector('[data-run-start]').disabled && document.querySelector('[data-run-start]').title.includes('choose a device')`))
  await evaluate(`document.querySelector('[data-run-start]').click()`)
  await waitFor(`!!document.querySelector('[data-run-menu]')`, 5000, 'device menu').catch(() => {})
  check('Run without a device opens the device menu with Launch emulator', await evaluate(`document.querySelector('[data-run-menu]')?.getAttribute('aria-label') === 'Device' && !!document.querySelector('[data-run-menu]').textContent.includes('Launch emulator')`))
  await app.key('Escape', 'Escape', 27)
  await evaluate(`${R}.refreshDevices()`)
  await waitFor(`!document.querySelector('[data-run-start][data-run-no-device]')`, 10000, 'device back').catch(() => {})

  // Android: gradlew → adb install → am start → logcat by pid → stop (force-stop)
  check('picked the Android config from the menu', await pickMenu('config', `b.textContent.trim() === 'app'`))
  await waitFor(`${R}.envFor(${JSON.stringify(ANDROID_DIR)}, 'android')?.jdkVersion === 17`, 20000, 'android env').catch(() => {})
  const aenv = await evaluate(`JSON.parse(JSON.stringify(${R}.envFor(${JSON.stringify(ANDROID_DIR)}, 'android')))`)
  check('Android env: fake SDK adb, JDK 17, gradlew', aenv?.sdk === SDK.androidSdk && aenv.jdk === SDK.jdk && aenv.jdkVersion === 17 && aenv.gradlew && !aenv.issues.length, JSON.stringify(aenv))
  await waitFor(`!document.querySelector('[data-run-env]') && !document.querySelector('[data-run-start]').disabled`, 10000, 'android runnable').catch(() => {})
  check('device kept for the Android config', await evaluate(`${R}.selectedDevice(${JSON.stringify(DIR)})?.id === '${DEVICE}'`))
  await recordStates()
  await evaluate(`document.querySelector('[data-run-start]').click()`)
  await waitFor(`${focused}?.type === 'android' && ${focused}?.state === 'running'`, 30000, 'android running').catch(() => {})
  const astates = await evaluate(`window.__runStates`)
  check('android states building → installing → launching → running', ['building', 'installing', 'launching', 'running'].every((s, i, a) => astates.indexOf(s) >= 0 && (i === 0 || astates.indexOf(a[i - 1]) < astates.indexOf(s))), astates.join(' → '))
  const gradle = calls().find((c) => c.tool === 'gradlew')
  check('gradlew :app:assembleDebug with JAVA_HOME / ANDROID_HOME', !!gradle && gradle.argv.includes(':app:assembleDebug') && gradle.javaHome === SDK.jdk && gradle.androidHome === SDK.androidSdk, JSON.stringify(gradle))
  check('adb install of the built APK', called((c) => c.tool === 'adb' && c.argv.includes('install') && c.argv.some((a) => a.endsWith('app-debug.apk'))))
  check('adb am start of the resolved launcher', called((c) => c.tool === 'adb' && c.argv.includes('start') && c.argv.includes('com.example.demo/.MainActivity')))
  await waitFor(`document.querySelector('[data-run-pane] [role=log]')?.textContent.includes('Hello from logcat')`, 15000, 'logcat').catch(() => {})
  const logcat = await logText()
  check('Logcat tab shows lines of the app pid with level/tag', logcat.includes('I/DemoApp: Hello from logcat') && logcat.includes('W/DemoApp: Fake warning line'), logcat.slice(0, 300))
  check('logcat attached by pid', called((c) => c.tool === 'adb' && c.argv.includes('logcat') && c.argv.includes('--pid=4242')))
  await tab('build')
  await sleep(200)
  const abuild = await logText()
  check('Build tab shows gradle + adb output', abuild.includes('> gradlew :app:assembleDebug') && abuild.includes('BUILD SUCCESSFUL') && abuild.includes('Success'), abuild.slice(0, 300))
  check('Android: hot reload disabled', await evaluate(`document.querySelector('[data-run-reload]').disabled`))
  await shot('run-03-android-running')
  await evaluate(`document.querySelector('[data-run-stop]').click()`)
  await waitFor(`${focused}?.state === 'stopped'`, 15000, 'android stopped').catch(() => {})
  check('Stop → am force-stop, Stopped', called((c) => c.tool === 'adb' && c.argv.includes('force-stop')) && (await stateText()).includes('Stopped'), await stateText())

  // Flutter build failure
  fs.writeFileSync(path.join(STATE, 'flutter-mode'), 'fail')
  check('picked the Flutter config again', await pickMenu('config', `b.textContent.trim() === 'main.dart'`))
  await waitFor(`!document.querySelector('[data-run-start]').disabled`, 10000, 'run enabled').catch(() => {})
  await evaluate(`document.querySelector('[data-run-start]').click()`)
  await waitFor(`${focused}?.type === 'flutter' && ${focused}?.state === 'failed'`, 20000, 'flutter failed').catch(() => {})
  await sleep(300)
  const failed = await stateText()
  check('state line: Failed + build failure text', failed.includes('Failed'), failed)
  await tab('build')
  await sleep(200)
  check('error lines highlighted inside the build log', await evaluate(`[...document.querySelectorAll('[data-run-pane] [data-run-error-line]')].some((l) => l.textContent.includes("Expected ';'"))`))
  check('RunBadge shows Run failed', await evaluate(`document.querySelector('[data-run-badge=failed]')?.textContent.includes('Run failed') === true`))
  const errs = await evaluate(`[...document.querySelectorAll('[data-run-errors] li')].map((li) => li.textContent.replace(/\\s+/g, ' ').trim())`)
  check('build error listed with file:line:col and message', errs.length === 1 && errs[0].includes('flutter_demo/lib/main.dart:5:3') && errs[0].includes("Expected ';' after this."), JSON.stringify(errs))
  check('Build tab selected with the error count', await evaluate(`document.querySelector('[data-run-tab=build]').getAttribute('aria-selected') === 'true' && document.querySelector('[data-run-tab=build]').textContent.includes('1')`))
  check('log keeps the app.stop error', (await logText()).includes('Gradle task assembleDebug failed with exit code 1'))
  await shot('run-04-failed')
  await evaluate(`document.querySelector('[data-run-errors] li button').click()`)
  const main = path.join(FLUTTER_DIR, 'lib', 'main.dart')
  await waitFor(`${W}.panes.some((p) => p.kind === 'file' && p.path?.toLowerCase() === ${JSON.stringify(main.toLowerCase())} && p.line === 5)`, 8000, 'file pane').catch(() => {})
  check('clicking the error opens lib/main.dart at line 5', await evaluate(`${W}.panes.some((p) => p.kind === 'file' && p.path?.toLowerCase() === ${JSON.stringify(main.toLowerCase())} && p.line === 5)`))

  await waitFor(`!!document.querySelector('[data-attention-chip]')`, 8000, 'attention chip').catch(() => {})
  check('needs-you chip counts the failed run', await evaluate(`!!document.querySelector('[data-attention-chip]')`))
  await evaluate(`document.querySelector('[data-attention-chip]')?.click()`)
  await waitFor(`!!document.querySelector('[data-attention-popover] [data-need]')`, 5000, 'needs list').catch(() => {})
  const needs = await evaluate(`[...document.querySelectorAll('[data-attention-popover] [data-need]')].map((n) => n.textContent.replace(/\\s+/g, ' ').trim())`)
  check('needs-you list has the failed run first', needs.length >= 1 && needs[0].includes('Run failed'), JSON.stringify(needs))
  await shot('run-05-needs-you')
  await app.key('Escape', 'Escape', 27)
  await sleep(200)

  check('no horizontal overflow', await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`))
  await evaluate(`window.__runOff?.()`)
}

;(async () => {
  fixture()
  try {
    fakes()
  } catch (e) {
    check('fake tools', false, e.message)
    process.exit(0)
  }
  const env = { FLUTTER_ROOT: SDK.flutterSdk, ANDROID_HOME: SDK.androidSdk, ANDROID_SDK_ROOT: SDK.androidSdk, JAVA_HOME: SDK.jdk }
  const app = await launch(process.argv[2] ? { exe: process.argv[2], env } : { env })
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('run-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-run-pane.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    for (const d of [DIR, FAKE]) try { fs.rmSync(d, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
