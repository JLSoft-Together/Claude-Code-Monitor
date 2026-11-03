// Bundle sizes of the web build and, with --startup, time to mount / first snapshot of the dev desktop build.
//   node scripts/measure.mjs [--no-build] [--startup] [--runs=3] [--label=v80]
// Writes docs/perf/<version>[-<label>].json. --startup needs apps/desktop/stage (npm run desktop builds it) and no other app on CCM_E2E_PORT.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'apps', 'web', 'dist')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null
}
const kb = (n) => `${(n / 1024).toFixed(1)} KB`

function build() {
  const r = spawnSync('npx', ['vite', 'build'], { cwd: path.join(ROOT, 'apps', 'web'), stdio: 'inherit', shell: true })
  if (r.status !== 0) throw new Error('vite build failed')
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
}

function bundle() {
  const files = walk(path.join(DIST, 'assets')).filter((f) => /\.(js|css)$/.test(f))
  const chunks = files
    .map((f) => {
      const buf = readFileSync(f)
      return { file: path.relative(DIST, f).replaceAll('\\', '/'), type: path.extname(f).slice(1), bytes: buf.length, gzip: gzipSync(buf).length }
    })
    .sort((a, b) => b.bytes - a.bytes)
  const sum = (type, key) => chunks.filter((c) => !type || c.type === type).reduce((n, c) => n + c[key], 0)
  const totals = { js: sum('js', 'bytes'), jsGzip: sum('js', 'gzip'), css: sum('css', 'bytes'), cssGzip: sum('css', 'gzip'), gzip: sum(null, 'gzip'), chunks: chunks.length }
  const fonts = walk(DIST).filter((f) => /\.(woff2?|ttf)$/.test(f)).reduce((n, f) => n + statSync(f).size, 0)
  return { chunks, totals: { ...totals, fontsBytes: fonts } }
}

// Hooks run before the page's own scripts, so the stamps are page-relative (performance.now() since navigation start).
const PROBE = `(() => {
  const t = (window.__ccmProbe = { mount: null, snapshot: null })
  const tick = () => {
    const app = document.querySelector('#app')
    if (t.mount === null && app && app.__vue_app__) t.mount = performance.now()
    const store = t.mount !== null ? app.__vue_app__.config.globalProperties.$pinia?._s.get('connection') : null
    if (store && store.state === 'connected' && t.snapshot === null) t.snapshot = performance.now()
    if (t.snapshot === null) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

async function startup(runs) {
  const require = createRequire(import.meta.url)
  const { launch } = require(path.join(ROOT, 'apps', 'desktop', 'e2e', 'cdp.cjs'))
  const mounts = []
  const snapshots = []
  const fcps = []
  for (let i = 0; i < runs; i++) {
    const app = await launch({})
    try {
      await app.waitFor(`!!document.querySelector('#app')?.__vue_app__ && document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('connection').state === 'connected'`, 60000, 'app ready')
      await app.cmd('Page.enable')
      await app.cmd('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
      await app.cmd('Page.reload', { ignoreCache: false })
      await app.sleep(500)
      await app.waitFor('window.__ccmProbe && window.__ccmProbe.snapshot !== null', 60000, 'first snapshot')
      const r = await app.evaluate(`JSON.stringify({ ...window.__ccmProbe, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null })`)
      const probe = JSON.parse(r)
      mounts.push(Math.round(probe.mount))
      snapshots.push(Math.round(probe.snapshot))
      if (probe.fcp !== null) fcps.push(Math.round(probe.fcp))
      console.log(`run ${i + 1}: mount ${mounts.at(-1)} ms, snapshot ${snapshots.at(-1)} ms`)
    } finally {
      app.stop()
      await app.sleep(1500)
    }
  }
  return { runs, note: 'dev build, page reload on a warm collector; ms since navigation start', mountMs: { samples: mounts, median: median(mounts) }, snapshotMs: { samples: snapshots, median: median(snapshots) }, fcpMs: { samples: fcps, median: median(fcps) } }
}

async function main() {
  if (!flag('no-build')) build()
  const result = bundle()
  const version = JSON.parse(readFileSync(path.join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8')).version
  const label = opt('label')
  const out = { version, label: label ?? null, date: new Date().toISOString().slice(0, 10), ...result }
  for (const c of result.chunks.slice(0, 12)) console.log(`${c.file.padEnd(48)} ${kb(c.bytes).padStart(10)}  gzip ${kb(c.gzip).padStart(9)}`)
  const t = result.totals
  console.log(`total: ${t.chunks} chunks, js ${kb(t.js)} (gzip ${kb(t.jsGzip)}), css ${kb(t.css)} (gzip ${kb(t.cssGzip)}), gzip sum ${kb(t.gzip)}, fonts ${kb(t.fontsBytes)}`)
  if (flag('startup')) out.startup = await startup(Number(opt('runs')) || 3)
  const dir = path.join(ROOT, 'docs', 'perf')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${version}${label ? `-${label}` : ''}.json`)
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
  console.log(`written ${path.relative(ROOT, file)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
