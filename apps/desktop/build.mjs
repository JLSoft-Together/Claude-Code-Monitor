// Bundles the Electron main process and the collector into stage/, the app dir electron-builder packs.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STAGE = path.join(HERE, 'stage')
const pkg = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8'))

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', sourcemap: false, logLevel: 'info' }

await build({
  ...common,
  entryPoints: [path.join(HERE, 'src', 'main.ts')],
  outfile: path.join(STAGE, 'main.cjs'),
  external: ['electron'],
})

await build({
  ...common,
  entryPoints: [path.join(HERE, '..', 'collector', 'src', 'index.ts')],
  outfile: path.join(STAGE, 'collector.cjs'),
  // ws loads these optional native peers inside try/catch.
  external: ['bufferutil', 'utf-8-validate'],
  // config.ts touches import.meta only when CCM_WEB_DIST / CCM_STATUSLINE_BRIDGE are unset; the desktop host always sets both.
  logOverride: { 'empty-import-meta': 'silent' },
})

await build({
  ...common,
  entryPoints: [path.join(HERE, 'src', 'preload.ts')],
  outfile: path.join(STAGE, 'preload.cjs'),
  external: ['electron'],
})

await build({
  ...common,
  entryPoints: [path.join(HERE, 'src', 'pty', 'host.ts')],
  outfile: path.join(STAGE, 'pty-host.cjs'),
  // node-pty is native: shipped as extraResources (pty/node_modules) and required by path at runtime.
  external: ['@lydell/node-pty', 'bufferutil', 'utf-8-validate'],
})

// Packaged builds ship the XML layout render daemon (extraResources layout-daemon/); layoutlib itself is downloaded at runtime.
if (process.argv.includes('--dist')) {
  const daemonDir = path.join(HERE, '..', 'layout-daemon')
  const jar = path.join(daemonDir, 'build', 'libs', 'layout-daemon.jar')
  if (process.env.CCM_SKIP_DAEMON_BUILD !== '1') {
    const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
    const run = spawnSync(gradlew, ['shadowJar', '--console=plain'], { cwd: daemonDir, stdio: 'inherit', shell: process.platform === 'win32' })
    if (run.status !== 0) {
      console.error('build: layout-daemon jar build failed (needs JDK 17+ in JAVA_HOME, e.g. the Android Studio JBR)')
      process.exit(1)
    }
  }
  if (!existsSync(jar)) {
    console.error(`build: ${jar} is missing; run "./gradlew shadowJar" in apps/layout-daemon with JAVA_HOME = JDK 17+`)
    process.exit(1)
  }
}

// No dependencies on purpose: everything is bundled, so electron-builder ships no node_modules.
writeFileSync(
  path.join(STAGE, 'package.json'),
  JSON.stringify(
    {
      name: 'agent-monitor',
      productName: 'GolAIm',
      version: pkg.version,
      description: pkg.description,
      author: 'GolAIm',
      main: 'main.cjs',
    },
    null,
    2,
  ),
)
