// Fake Android `emulator` for e2e/v74.cjs: `-list-avds` prints two AVDs after an INFO line; `-avd X` registers the next free
// emulator-55xx serial in STATE/emu.json (seen by the fake adb) and runs until `adb emu kill` removes it.
const fs = require('node:fs')
const path = require('node:path')

const STATE = path.join(__dirname, '..', 'state')
const EMU = path.join(STATE, 'emu.json')
const args = process.argv.slice(2)
fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify({ tool: 'emulator', argv: args }) + '\n')
const emus = () => {
  try {
    return JSON.parse(fs.readFileSync(EMU, 'utf8'))
  } catch {
    return {}
  }
}

if (args[0] === '-list-avds') {
  process.stdout.write('INFO    | Storing crashdata in: C:\\fake\\crashes\nPixel_7_API_34\nTablet_API_30\n')
} else if (args[0] === '-avd' && args[1]) {
  let port = 5556
  while (emus()[`emulator-${port}`]) port += 2
  const serial = `emulator-${port}`
  fs.writeFileSync(EMU, JSON.stringify({ ...emus(), [serial]: args[1] }))
  const started = Date.now()
  setInterval(() => {
    let parentAlive = true
    try {
      process.kill(process.ppid, 0)
    } catch {
      parentAlive = false
    }
    if (!emus()[serial] || !parentAlive || Date.now() - started > 600_000) {
      const { [serial]: _, ...rest } = emus()
      fs.writeFileSync(EMU, JSON.stringify(rest))
      process.exit(0)
    }
  }, 300)
} else {
  process.stderr.write(`fake emulator: unsupported ${args.join(' ')}\n`)
  process.exitCode = 1
}
