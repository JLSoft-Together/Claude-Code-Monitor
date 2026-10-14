#!/usr/bin/env node
// Manual smoke test: node smoke.mjs [layoutlibDir] [layout.xml]
// Needs `./gradlew assemble` first (daemon jar + build/layoutlib-dist) and JDK 17+ in JAVA_HOME.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libDir = process.argv[2] ?? join(here, 'build', 'layoutlib-dist')
const xmlPath = process.argv[3]
const jar = join(here, 'build', 'libs', 'layout-daemon.jar')
const layoutlibJar = readdirSync(libDir).find((f) => /^layoutlib-.*\.jar$/.test(f))
const javaHome = process.env.JAVA_HOME ?? 'C:\\Program Files\\Android\\Android Studio\\jbr'
const java = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
if (!existsSync(jar) || !layoutlibJar || !existsSync(java)) {
  console.error('missing jar / layoutlib / java', { jar, libDir, java })
  process.exit(1)
}

const sample = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="24dp">
    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Layout daemon smoke"
        android:textSize="22sp" />
    <Button
        android:id="@+id/save"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Save" />
</LinearLayout>
`
const xmlContent = xmlPath ? readFileSync(xmlPath, 'utf8') : sample

const t0 = Date.now()
const child = spawn(java, [
  '-Xmx1g', '-XX:+EnableDynamicAgentLoading', '-Djdk.attach.allowAttachSelf=true',
  '-cp', [jar, join(libDir, layoutlibJar)].join(delimiter),
  'dev.ccm.layoutdaemon.MainKt', '--layoutlib', libDir,
], { stdio: ['pipe', 'pipe', 'inherit'] })

const pending = new Map()
let buf = Buffer.alloc(0)
let logs = 0
child.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const sep = buf.indexOf('\r\n\r\n')
    if (sep < 0) return
    const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'))?.[1])
    if (buf.length < sep + 4 + len) return
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString('utf8'))
    buf = buf.subarray(sep + 4 + len)
    if (msg.method === 'log') { logs++; if (process.env.SMOKE_LOGS) console.log('[log]', msg.params.level, msg.params.message); continue }
    pending.get(msg.id)?.(msg)
    pending.delete(msg.id)
  }
})

let nextId = 1
function call(method, params) {
  const id = nextId++
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8')
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
  child.stdin.write(body)
  return new Promise((resolve) => pending.set(id, resolve))
}

const init = await call('initialize', { protocolVersion: 1, cacheDir: join(tmpdir(), 'ccm-layout-smoke') })
console.log('initialize', init.result ?? init.error, `cold start ${Date.now() - t0} ms`)

const device = { width: 1080, height: 2340, density: 440 }
for (let i = 1; i <= 5; i++) {
  const t = Date.now()
  const res = await call('render', {
    requestId: `smoke-${i}`, layoutPath: xmlPath ?? 'sample.xml', xmlContent, device,
    theme: 'android:Theme.Material.Light.NoActionBar', night: false, locale: 'en',
  })
  if (res.error) { console.log('render error', res.error); break }
  const r = res.result
  console.log(`render #${i}: renderMs=${r.renderMs} rtt=${Date.now() - t} ms timings=${JSON.stringify(r.timings)} png=${r.png} diagnostics=${r.diagnostics.length}`)
  if (i === 1) console.log('viewTree', JSON.stringify(r.viewTree))
}

await call('shutdown', {})
child.on('exit', (code) => console.log(`daemon exited ${code}; log notifications: ${logs}`))
