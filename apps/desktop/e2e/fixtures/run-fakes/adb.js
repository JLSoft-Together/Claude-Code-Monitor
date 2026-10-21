// Fake `adb` for e2e/run-pane.cjs and e2e/devices.cjs: one emulator, install/launch succeed, logcat streams until killed.
// v61 Devices: connect / disconnect / pair / tcpip / mdns / shell ip. Wi-Fi ids connected so far persist in STATE/wifi.json
// (one process per adb call), and track-devices re-emits its frame when that file changes.
const fs = require('node:fs')
const path = require('node:path')

const STATE = path.join(__dirname, '..', 'state')
let args = process.argv.slice(2)
fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify({ tool: 'adb', argv: args }) + '\n')
if (args[0] === '-s') args = args.slice(2)

const BASE = 'emulator-5554          device product:sdk_gphone64_x86_64 model:Pixel_7 device:emu64x transport_id:1\n'
const WIFI = path.join(STATE, 'wifi.json')
const wifi = () => {
  try {
    return JSON.parse(fs.readFileSync(WIFI, 'utf8'))
  } catch {
    return []
  }
}
const list = () => BASE + wifi().map((id, i) => `${id.padEnd(22)} device product:sunfish model:Pixel_4a device:sunfish transport_id:${i + 4}\n`).join('')
const PKG = 'com.example.demo'
const out = (s) => process.stdout.write(s)
const has = (...words) => words.every((w) => args.includes(w))

if (args[0] === 'track-devices') {
  let last = ''
  const emit = () => {
    const now = list()
    if (now === last) return
    last = now
    out(now.length.toString(16).padStart(4, '0') + now)
  }
  emit()
  setInterval(emit, 300)
} else if (args[0] === 'devices') {
  out(`List of devices attached\n${list()}\n`)
} else if (args[0] === 'connect') {
  const id = args[1]
  if (!wifi().includes(id)) fs.writeFileSync(WIFI, JSON.stringify([...wifi(), id]))
  out(`connected to ${id}\n`)
} else if (args[0] === 'disconnect') {
  const id = args[1]
  if (wifi().includes(id)) {
    fs.writeFileSync(WIFI, JSON.stringify(wifi().filter((x) => x !== id)))
    out(`disconnected ${id}\n`)
  } else {
    out(`error: no such device '${id}'\n`)
  }
} else if (args[0] === 'pair') {
  out(`Successfully paired to ${args[1]} [guid=adb-FAKE-AbCdEf]\n`)
} else if (args[0] === 'tcpip') {
  out(`restarting in TCP mode port: ${args[1]}\n`)
} else if (args[0] === 'mdns' && args[1] === 'check') {
  out('mdns daemon version [Openscreen discovery 0.0.0]\n')
} else if (args[0] === 'mdns' && args[1] === 'services') {
  out('List of discovered mdns services\n')
} else if (args[0] === 'shell' && has('ip', 'wlan0')) {
  out('    inet 192.168.1.5/24 brd 192.168.1.255 scope global wlan0\n')
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
