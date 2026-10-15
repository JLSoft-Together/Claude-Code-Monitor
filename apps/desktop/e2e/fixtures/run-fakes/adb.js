// Fake `adb` for e2e/run-pane.cjs: one emulator, install/launch succeed, logcat streams until killed.
const fs = require('node:fs')
const path = require('node:path')

const STATE = path.join(__dirname, '..', 'state')
let args = process.argv.slice(2)
fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify({ tool: 'adb', argv: args }) + '\n')
if (args[0] === '-s') args = args.slice(2)

const LIST = 'emulator-5554          device product:sdk_gphone64_x86_64 model:Pixel_7 device:emu64x transport_id:1\n'
const PKG = 'com.example.demo'
const out = (s) => process.stdout.write(s)
const has = (...words) => words.every((w) => args.includes(w))

if (args[0] === 'track-devices') {
  out(LIST.length.toString(16).padStart(4, '0') + LIST)
  setInterval(() => undefined, 60_000)
} else if (args[0] === 'devices') {
  out(`List of devices attached\n${LIST}\n`)
} else if (args[0] === 'install') {
  out('Performing Streamed Install\nSuccess\n')
} else if (args[0] === 'uninstall') {
  out('Success\n')
} else if (args[0] === 'logcat') {
  const at = () => {
    const d = new Date()
    const p = (n, w = 2) => String(n).padStart(w, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  }
  out('--------- beginning of main\n')
  out(`${at()}  4242  4242 I DemoApp : Hello from logcat\n`)
  out(`${at()}  4242  4260 W DemoApp : Fake warning line\n`)
  setInterval(() => out(`${at()}  4242  4242 D DemoApp : tick\n`), 2000)
} else if (args[0] === 'shell' && has('resolve-activity')) {
  out(`priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${PKG}/.MainActivity\n`)
} else if (args[0] === 'shell' && has('am', 'start')) {
  out(`Starting: Intent { cmp=${PKG}/.MainActivity }\n`)
} else if (args[0] === 'shell' && has('pidof')) {
  out('4242\n')
} else if (args[0] === 'shell' && has('force-stop')) {
  // nothing printed by the real tool either
} else if (args[0] === 'shell' && has('getprop')) {
  out('1\n')
} else {
  process.stderr.write(`fake adb: unsupported ${args.join(' ')}\n`)
  process.exitCode = 1
}
