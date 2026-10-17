// Spike C: drive the SDK's own analysis server (legacy protocol) to list Widget subclasses + constructor params.
// Usage: node as_probe.mjs <projectRoot> [dart.exe]
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const root = path.resolve(process.argv[2])
const dart = process.argv[3] ?? 'D:/DEV/flutter/bin/cache/dart-sdk/bin/dart.exe'
const t0 = Date.now()
const child = spawn(dart, ['language-server', '--protocol=analyzer', '--client-id=ccm-spike', '--suppress-analytics'], { stdio: ['pipe', 'pipe', 'inherit'] })
let id = 0
const pending = new Map()
const listeners = []
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.event) for (const l of [...listeners]) l(msg)
})
const req = (method, params) => new Promise((res) => {
  const k = String(++id)
  pending.set(k, res)
  child.stdin.write(JSON.stringify({ id: k, method, params }) + '\n')
})
const once = (pred) => new Promise((res) => {
  const l = (m) => {
    if (pred(m)) {
      listeners.splice(listeners.indexOf(l), 1)
      res(m)
    }
  }
  listeners.push(l)
})
const rssMB = () => {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).WorkingSet64`]).toString().trim()
    return Math.round(Number(out) / 1048576)
  } catch {
    return -1
  }
}

await once((m) => m.event === 'server.connected')
const tConnected = Date.now() - t0
const keepAlive = setInterval(() => undefined, 1000)
await req('server.setSubscriptions', { subscriptions: ['STATUS'] })
const done = once((m) => m.event === 'server.status' && m.params.analysis && m.params.analysis.isAnalyzing === false)
await req('analysis.setAnalysisRoots', { included: [root], excluded: [] })
await done
const tAnalyzed = Date.now() - t0

// framework.dart of the flutter package this project resolves.
const cfg = JSON.parse(fs.readFileSync(path.join(root, '.dart_tool', 'package_config.json'), 'utf8'))
const flutter = cfg.packages.find((p) => p.name === 'flutter')
const flutterRoot = new URL(flutter.rootUri.startsWith('file:') ? flutter.rootUri : flutter.rootUri, 'file:///' + path.join(root, '.dart_tool').replace(/\\/g, '/') + '/')
const framework = path.join(decodeURIComponent(flutterRoot.pathname).replace(/^\/([A-Za-z]:)/, '$1'), flutter.packageUri ?? 'lib/', 'src', 'widgets', 'framework.dart')
const src = fs.readFileSync(framework, 'utf8')
const offset = src.indexOf('abstract class Widget ') + 'abstract class '.length
const th = await req('search.getTypeHierarchy', { file: framework, offset })
const tHierarchy = Date.now() - t0
const items = th.result?.hierarchyItems ?? []
const lib = path.join(root, 'lib')
const inLib = items.filter((it) => it.classElement.location && path.resolve(it.classElement.location.file).toLowerCase().startsWith(lib.toLowerCase()))

// Constructors + parameter types from the outline of each file.
const files = [...new Set(inLib.map((it) => it.classElement.location.file))]
const outlines = new Map()
const gotAll = new Promise((res) => {
  listeners.push((m) => {
    if (m.event === 'analysis.outline') {
      outlines.set(m.params.file, m.params.outline)
      if (outlines.size === files.length) res()
    }
  })
})
await req('analysis.setSubscriptions', { subscriptions: { OUTLINE: files } })
await Promise.race([gotAll, new Promise((r) => setTimeout(r, 20000))])
const tOutline = Date.now() - t0
let ctorWithTypes = 0
let ctorFieldFormalUntyped = 0
const sample = []
for (const it of inLib) {
  const o = outlines.get(it.classElement.location.file)
  const cls = o?.children?.find((c) => c.element.kind === 'CLASS' && c.element.name === it.classElement.name)
  for (const c of cls?.children ?? []) {
    if (c.element.kind !== 'CONSTRUCTOR') continue
    const params = c.element.parameters ?? ''
    if (/\bthis\./.test(params)) ctorFieldFormalUntyped++
    else ctorWithTypes++
    if (sample.length < 4) sample.push(`${c.element.name} ${params}`)
  }
}
const rss = rssMB()
console.log(JSON.stringify({ project: path.basename(root), widgetsInLib: inLib.length, ms: { connected: tConnected, analyzed: tAnalyzed, hierarchy: tHierarchy - tAnalyzed, outline: tOutline - tHierarchy }, rssMB: rss, ctorWithTypes, ctorFieldFormalUntyped, sample }, null, 2))
await req('server.shutdown', {})
clearInterval(keepAlive)
child.kill()
