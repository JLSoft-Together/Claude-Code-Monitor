// v61 Devices tab against the fake adb (e2e/fixtures/run-fakes/adb.js): found through ANDROID_HOME, so no SDK or phone is needed.
// USB/emulator row → Connect 192.168.1.5:5555 → Wi-Fi row → Disconnect → offline remembered row; screenshots at the default
// and at the 420 px minimum width. Forget is not driven: its native confirm has no e2e auto-answer (no test-only bypass in production).
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { launch, OUT } = require('./cdp.cjs')
const S = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s`
const results = []
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); console.log(results.at(-1)) }

const WIN = process.platform === 'win32'
const FAKE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-e2e-devfake-')))
const SDK = path.join(FAKE, 'android-sdk')
const TOOLS = path.join(FAKE, 'tools')
const STATE = path.join(FAKE, 'state')
const USB = 'emulator-5554'
const WIFI = '192.168.1.5:5555'

function fakes() {
  const src = path.join(__dirname, 'fixtures', 'run-fakes')
  fs.mkdirSync(TOOLS, { recursive: true })
  fs.mkdirSync(STATE, { recursive: true })
  fs.copyFileSync(path.join(src, 'adb.js'), path.join(TOOLS, 'adb.js'))
  const file = path.join(SDK, 'platform-tools', WIN ? 'adb.exe' : 'adb')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!WIN) {
    fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${path.join(TOOLS, 'adb.js')}" "$@"\n`)
    fs.chmodSync(file, 0o755)
    return
  }
  const cs = path.join(FAKE, 'launcher.cs')
  fs.writeFileSync(cs, fs.readFileSync(path.join(src, 'launcher.cs'), 'utf8').replace('__NODE__', process.execPath).replace('__TOOLS__', TOOLS))
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${file}`, cs], { stdio: 'pipe' })
}

async function run(app) {
  const { evaluate, waitFor, shot, sleep, cmd, type } = app
  const row = (id) => `document.querySelector('[data-dev-row="${id}"]')`
  const rowText = (id) => evaluate(`${row(id)}?.textContent.replace(/\\s+/g, ' ').trim() ?? ''`)

  await waitFor(`!!window.ccmDesktop && !!${S}.get('ui')`, 30000, 'app ready')
  await evaluate(`localStorage.setItem('ccm.tourDone','1'); localStorage.setItem('ccm.setupDone','1'); localStorage.setItem('ccm.tourWorkspaceDone','1'); localStorage.setItem('ccm.theme','dark')`)
  await cmd('Page.reload')
  await sleep(1500)
  await waitFor(`!!${S}.get('ui')`, 30000, 'reloaded')

  check('preload exposes the devices bridge', await evaluate(`typeof window.ccmDesktop.devSnapshot === 'function' && typeof window.ccmDesktop.onDevEvent === 'function'`))
  await evaluate(`${S}.get('ui').view = 'devices'`)
  await waitFor(`!!document.querySelector('[data-devices]')`, 15000, 'devices view')
  await waitFor(`!!${row(USB)}`, 20000, 'usb row').catch(() => {})
  const usb = await rowText(USB)
  check('fake device row shows Ready', usb.includes('Ready'), usb)
  check('adb was found through ANDROID_HOME (no missing-adb banner)', await evaluate(`!document.querySelector('[data-dev-noadb]')`))
  await shot('devices-01-ready')

  await evaluate(`document.querySelector('[data-dev-address]').focus()`)
  await type(WIFI)
  await waitFor(`!document.querySelector('[data-dev-connect]').disabled`, 5000, 'connect enabled')
  await evaluate(`document.querySelector('[data-dev-connect]').click()`)
  await waitFor(`!!${row(WIFI)}`, 20000, 'wifi row').catch(() => {})
  const wifi = await rowText(WIFI)
  check('Connect adds the Wi-Fi row, Ready', wifi.includes('Ready') && wifi.includes('Wi-Fi'), wifi)
  await shot('devices-02-wifi')

  await evaluate(`${row(WIFI)}.click()`)
  await waitFor(`${row(WIFI)}?.hasAttribute('data-selected')`, 5000, 'selected').catch(() => {})
  await evaluate(`${row(WIFI)}.querySelector('[data-dev-action=disconnect]').click()`)
  await waitFor(`!!${row(WIFI)} && ${row(WIFI)}.textContent.includes('Offline')`, 20000, 'offline row').catch(() => {})
  const off = await rowText(WIFI)
  check('Disconnect leaves an offline remembered row with Forget', off.includes('Offline') && (await evaluate(`!!${row(WIFI)}.querySelector('[data-dev-action=forget]')`)), off)
  check('the USB row is untouched', (await rowText(USB)).includes('Ready'))
  await shot('devices-03-offline')

  // Narrow: the 6 header tabs and the list must not scroll the page sideways. Prefer a real window resize, else a 420 px viewport.
  let real = false
  try {
    const w = await cmd('Browser.getWindowForTarget')
    const id = w.result?.windowId
    if (id) {
      await cmd('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'normal', width: 420, height: 800 } })
      real = true
    }
  } catch {}
  if (!real) await cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(800)
  const m = await evaluate(`JSON.stringify({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: innerWidth })`)
  const { sw, cw, iw } = JSON.parse(m)
  check('window at the 420 px minimum', iw <= 440, `${m} ${real ? 'window bounds' : 'viewport override'}`)
  check('no horizontal overflow at 420 px (6 header tabs + devices list)', sw <= cw, m)
  await shot('devices-04-narrow')
  if (!real) await cmd('Emulation.clearDeviceMetricsOverride')
}

;(async () => {
  try {
    fakes()
  } catch (e) {
    check('fake tools', false, e.message)
    process.exit(0)
  }
  const env = { ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK }
  const app = await launch(process.argv[2] ? { exe: process.argv[2], env } : { env })
  try {
    await run(app)
  } catch (e) {
    check('run', false, e.message)
    await app.shot('devices-99-error').catch(() => {})
  } finally {
    app.stop()
    fs.writeFileSync(path.join(OUT, 'results-devices.txt'), results.join('\n'))
    await new Promise((r) => setTimeout(r, 1000))
    try { fs.rmSync(FAKE, { recursive: true, force: true }) } catch {}
    process.exit(0)
  }
})()
