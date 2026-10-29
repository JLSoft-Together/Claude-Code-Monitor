// Fake `flutter` for e2e/run-pane.cjs: the subset of the CLI the Run pane drives. State lives in ../state.
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')

const STATE = path.join(__dirname, '..', 'state')
const args = process.argv.slice(2)
const log = (entry) => fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify({ tool: 'flutter', ...entry }) + '\n')
const send = (msg) => process.stdout.write(JSON.stringify([msg]) + '\n')
const mode = () => {
  try {
    return fs.readFileSync(path.join(STATE, 'flutter-mode'), 'utf8').trim()
  } catch {
    return 'ok'
  }
}
const DEVICE = { id: 'emulator-5554', name: 'sdk gphone64 x86 64', platform: 'android-x64', targetPlatform: 'android-x64', emulator: true, category: 'mobile', platformType: 'android', ephemeral: true, isSupported: true }
const EMULATOR = { id: 'Pixel_7_API_34', name: 'Pixel 7 API 34', category: 'mobile', platformType: 'android' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

log({ argv: args })

function onRequests(handler) {
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const t = line.trim()
    if (!t.startsWith('[')) return
    let msg
    try {
      msg = JSON.parse(t)[0]
    } catch {
      return
    }
    log({ request: msg.method, params: msg.params })
    handler(msg)
  })
  rl.on('close', () => process.exit(0))
}

function daemon() {
  send({ event: 'daemon.connected', params: { version: '0.6.1', pid: process.pid } })
  onRequests((msg) => {
    if (msg.method === 'device.getDevices') send({ id: msg.id, result: [DEVICE] })
    else if (msg.method === 'emulator.getEmulators') send({ id: msg.id, result: [EMULATOR] })
    else if (msg.method === 'daemon.shutdown') {
      send({ id: msg.id, result: null })
      process.exit(0)
    } else {
      send({ id: msg.id, result: null })
      if (msg.method === 'device.enable') send({ event: 'device.added', params: DEVICE })
    }
  })
}

async function run() {
  const appId = 'fake-app-1'
  const deviceId = args[args.indexOf('-d') + 1]
  send({ event: 'daemon.connected', params: { version: '0.6.1', pid: process.pid } })
  send({ event: 'app.start', params: { appId, deviceId, directory: process.cwd(), supportsRestart: true, launchMode: 'run', mode: 'debug' } })
  send({ event: 'app.progress', params: { appId, id: '1', progressId: null, message: "Running Gradle task 'assembleDebug'..." } })
  if (mode() === 'fail') {
    await sleep(800)
    process.stdout.write("lib/main.dart:5:3: Error: Expected ';' after this.\n")
    process.stdout.write('  runApp(const DemoApp())\n')
    send({ event: 'app.progress', params: { appId, id: '1', finished: true } })
    send({ event: 'app.stop', params: { appId, error: "Gradle task assembleDebug failed with exit code 1" } })
    process.exitCode = 1
    return
  }
  onRequests((msg) => {
    if (msg.method === 'app.restart') {
      const full = msg.params?.fullRestart === true
      send({ event: 'app.progress', params: { appId, id: '2', progressId: full ? 'hot.restart' : 'hot.reload', message: full ? 'Performing hot restart...' : 'Performing hot reload...' } })
      send({ event: 'app.progress', params: { appId, id: '2', finished: true } })
      send({ id: msg.id, result: { code: 0, message: '' } })
      send({ event: 'app.log', params: { appId, log: full ? 'flutter: restarted from fake' : 'flutter: reloaded from fake' } })
    } else if (msg.method === 'app.stop') {
      send({ id: msg.id, result: true })
      send({ event: 'app.stop', params: { appId } })
      setTimeout(() => process.exit(0), 50)
    } else send({ id: msg.id, error: `unknown method ${msg.method}` })
  })
  await sleep(1500)
  send({ event: 'app.progress', params: { appId, id: '1', finished: true } })
  process.stdout.write('Built build\\app\\outputs\\flutter-apk\\app-debug.apk\n')
  send({ event: 'app.debugPort', params: { appId, port: 50123, wsUri: 'ws://127.0.0.1:50123/fakeToken=/ws' } })
  send({ event: 'app.started', params: { appId } })
  send({ event: 'app.log', params: { appId, log: 'flutter: Hello from the fake app' } })
  // Masking: the home folder and a token-looking value must not reach the page.
  send({ event: 'app.log', params: { appId, log: `flutter: secret at ${require('node:os').homedir()} ghp_abcdefghijklmnopqrstuvwxyz123456` } })
  // v72 crash chip: an unhandled Dart exception whose top frame is in the project's lib/main.dart.
  if (mode() === 'crash') {
    for (const log of [
      'E/flutter ( 4242): [ERROR:flutter/runtime/dart_vm_initializer.cc(41)] Unhandled Exception: Bad state: e2e crash',
      'E/flutter ( 4242): #0      main (package:flutter_demo/main.dart:5:3)',
      'E/flutter ( 4242): #1      _runMain (dart:ui/hooks.dart:301:3)',
      'E/flutter ( 4242): <asynchronous suspension>',
      'flutter: after the crash',
    ]) send({ event: 'app.log', params: { appId, log } })
  }
}

if (args[0] === '--version') {
  process.stdout.write(JSON.stringify({ frameworkVersion: '3.35.0', channel: 'stable', repositoryUrl: 'https://github.com/flutter/flutter.git', dartSdkVersion: '3.9.0', devToolsVersion: '2.48.0' }) + '\n')
} else if (args[0] === 'devices') {
  process.stdout.write(JSON.stringify([DEVICE]) + '\n')
} else if (args[0] === 'emulators') {
  process.stdout.write(args.includes('--machine') ? JSON.stringify([EMULATOR]) + '\n' : `1 available emulator:\n\n${EMULATOR.id} • ${EMULATOR.name} • Google • android\n`)
} else if (args[0] === 'daemon') {
  daemon()
} else if (args[0] === 'run' && args.includes('--machine')) {
  void run()
} else if (args[0] === 'pub') {
  process.stdout.write('Got dependencies!\n')
  fs.writeFileSync(path.join(process.cwd(), 'pubspec.lock'), 'packages: {}\n')
} else if (args[0] === 'doctor' && args.includes('--machine')) {
  const doctor = [
    { name: 'Flutter', type: 'installed', statusInfo: 'Channel stable, 3.35.0', messages: [{ message: 'Flutter version 3.35.0', type: 'information' }] },
    { name: 'Android toolchain', type: 'partial', statusInfo: 'Android SDK version 35', messages: [{ message: 'Some Android licenses not accepted.', type: 'hint' }] },
    { name: 'Chrome - develop for the web', type: 'missing', statusInfo: '', messages: [{ message: 'Cannot find Chrome executable', type: 'error' }] },
  ]
  process.stdout.write(JSON.stringify(doctor) + '\n')
  process.exitCode = 1
} else {
  process.stderr.write(`fake flutter: unsupported ${args.join(' ')}\n`)
  process.exitCode = 64
}
