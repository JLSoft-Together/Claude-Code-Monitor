import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ReleaseApp, ReleaseFinding } from '@ccm/shared'
import { detectAndroid } from '../run/android/detect'
import { isWithin } from '../preview/paths'
import {
  ACK_SOURCE,
  admobFindings,
  ADS_GRADLE,
  ADS_PUBSPEC,
  BILLING_GRADLE,
  BILLING_PUBSPEC,
  buildFindings,
  certFinding,
  CONSENT_SOURCE,
  extrasFindings,
  GMS_PLUGIN,
  langOf,
  locate,
  manifestFindings,
  parseGradleApp,
  parsePubspecVersion,
  pubspecName,
  sdkFindings,
  versionFindings,
  type Located,
} from './rules'
import type { ReleaseStore } from './store'

const TEXT_MAX = 1024 * 1024
const WALK_FILES = 5000
const WALK_BYTES = 48 * 1024 * 1024
const APPS_MAX = 8
const ADMOB_MAX = 40
const SKIP = new Set(['build', 'node_modules', '.dart_tool', 'Pods', '.gradle', '.git', '.idea', '.cxx', 'generated'])
const TEST_SET = /(^|\/)src\/(test|androidTest|testFixtures)\w*\//
const DEBUG_SET = /(^|\/)src\/\w*[dD]ebug\//

export async function readText(file: string): Promise<string | null> {
  try {
    const st = await fs.stat(file)
    return st.isFile() && st.size <= TEXT_MAX ? await fs.readFile(file, 'utf8') : null
  } catch {
    return null
  }
}

async function first(files: string[]): Promise<{ file: string; text: string } | null> {
  for (const file of files) {
    const text = await readText(file)
    if (text !== null) return { file, text }
  }
  return null
}

const listDir = async (dir: string) => fs.readdir(dir, { withFileTypes: true }).catch(() => [])

/** Source files under `dirs` (tests and build output skipped), capped by count and bytes. */
async function walkSources(dirs: string[], base: string): Promise<{ file: string; rel: string }[]> {
  const out: { file: string; rel: string }[] = []
  let bytes = 0
  const walk = async (dir: string): Promise<void> => {
    for (const e of await listDir(dir)) {
      if (out.length >= WALK_FILES || bytes >= WALK_BYTES) return
      const full = path.join(dir, e.name)
      const rel = path.relative(base, full).replace(/\\/g, '/')
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.') && !TEST_SET.test(`${rel}/`)) await walk(full)
      } else if (e.isFile() && langOf(e.name)) {
        const st = await fs.stat(full).catch(() => null)
        if (!st || st.size > TEXT_MAX) continue
        bytes += st.size
        out.push({ file: full, rel })
      }
    }
  }
  for (const d of dirs) await walk(d)
  return out
}

interface AppTarget {
  kind: 'android' | 'flutter'
  dir: string
  name: string
  /** Android application module dir (Flutter: `android/app`). */
  module: string
  /** Gradle root, for `gradle/libs.versions.toml`. */
  gradleRoot: string
}

const isFlutterApp = (pubspec: string | null): boolean => !!pubspec && /^\s*sdk:\s*flutter\b/m.test(pubspec)

async function findFlutter(root: string): Promise<AppTarget[]> {
  const out: AppTarget[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= APPS_MAX) return
    const pubspec = await readText(path.join(dir, 'pubspec.yaml'))
    const module = path.join(dir, 'android', 'app')
    if (isFlutterApp(pubspec) && (await first([path.join(module, 'build.gradle.kts'), path.join(module, 'build.gradle')]))) {
      out.push({ kind: 'flutter', dir, name: pubspecName(pubspec!) ?? path.basename(dir), module, gradleRoot: path.join(dir, 'android') })
      return
    }
    if (depth >= 2) return
    for (const e of await listDir(dir)) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) await visit(path.join(dir, e.name), depth + 1)
  }
  await visit(root, 0)
  return out
}

export async function findApps(root: string): Promise<AppTarget[]> {
  const apps = await findFlutter(root)
  for (const p of await detectAndroid(root)) {
    for (const m of p.modules) {
      if (m.type !== 'application' && !m.guessed) continue
      if (!isWithin(root, m.dir) || apps.some((a) => isWithin(a.dir, m.dir))) continue
      apps.push({ kind: 'android', dir: m.dir, name: m.path === ':' ? p.name : m.path, module: m.dir, gradleRoot: p.dir })
    }
  }
  return apps.slice(0, APPS_MAX)
}

async function scanApp(app: AppTarget, store: ReleaseStore): Promise<ReleaseApp> {
  const flutter = app.kind === 'flutter'
  const build = await first([path.join(app.module, 'build.gradle.kts'), path.join(app.module, 'build.gradle')])
  const gradle = parseGradleApp(build?.text ?? '')
  const buildFile = build?.file ?? path.join(app.module, 'build.gradle')
  const pubspecFile = path.join(app.dir, 'pubspec.yaml')
  const pubspec = flutter ? await readText(pubspecFile) : null
  const memory = await store.get(app.dir)
  const findings: ReleaseFinding[] = []

  const pv = pubspec ? parsePubspecVersion(pubspec) : null
  const useGradle = !flutter || gradle.versionCode?.value != null
  const version = useGradle
    ? { code: gradle.versionCode?.value ?? null, codeRaw: gradle.versionCode?.raw ?? null, name: gradle.versionName?.value ?? null, file: buildFile, codeLine: gradle.versionCode?.line ?? null, nameLine: gradle.versionName?.line ?? null }
    : { code: pv?.code ?? null, codeRaw: pv?.raw ?? null, name: pv?.name ?? null, file: pubspecFile, codeLine: pv?.line ?? null, nameLine: pv?.line ?? null }
  findings.push(...versionFindings(version, memory.released))
  findings.push(...buildFindings(gradle, buildFile, flutter))
  findings.push(...sdkFindings(gradle, buildFile, flutter))

  const mainManifest = path.join(app.module, 'src', 'main', 'AndroidManifest.xml')
  for (const [file, main] of [
    [mainManifest, true],
    [path.join(app.module, 'src', 'release', 'AndroidManifest.xml'), false],
  ] as const) {
    const xml = await readText(file)
    if (xml !== null) findings.push(...manifestFindings(xml, file, main))
  }

  const roots = flutter ? [path.join(app.dir, 'lib'), path.join(app.module, 'src'), path.join(app.dir, 'ios', 'Runner')] : [path.join(app.module, 'src')]
  let admob = 0
  let consent = false
  let acknowledge = false
  for (const { file, rel } of await walkSources(roots, app.dir)) {
    const text = await readText(file)
    if (text === null) continue
    if (admob < ADMOB_MAX) {
      const found = admobFindings(text, file, DEBUG_SET.test(rel)).slice(0, ADMOB_MAX - admob)
      admob += found.length
      findings.push(...found)
    }
    consent ||= CONSENT_SOURCE.test(text)
    acknowledge ||= ACK_SOURCE.test(text)
  }

  const toml = await readText(path.join(app.gradleRoot, 'gradle', 'libs.versions.toml'))
  const tomlFile = path.join(app.gradleRoot, 'gradle', 'libs.versions.toml')
  const dep = (gradleRe: RegExp, pubRe: RegExp): Located | null =>
    (pubspec ? locate(pubspec, pubspecFile, 'yaml', pubRe) : null) ??
    (build ? locate(build.text, build.file, 'c', gradleRe) : null) ??
    (toml ? locate(toml, tomlFile, 'yaml', gradleRe) : null)
  const billing = dep(BILLING_GRADLE, BILLING_PUBSPEC)
  const revenueCat = /\bpurchases_flutter\s*:|com\.revenuecat/.test(`${pubspec ?? ''}\n${build?.text ?? ''}\n${toml ?? ''}`)
  const gsJson = await first([path.join(app.module, 'google-services.json'), ...(await listDir(path.join(app.module, 'src'))).filter((e) => e.isDirectory()).map((e) => path.join(app.module, 'src', e.name, 'google-services.json'))])
  findings.push(
    ...extrasFindings({
      ads: dep(ADS_GRADLE, ADS_PUBSPEC),
      consent,
      billing: billing ? { ...billing, revenueCat } : null,
      acknowledge,
      googleServicesJson: gsJson?.file ?? null,
      gmsPlugin: build ? locate(build.text, build.file, 'c', GMS_PLUGIN) : null,
    }),
  )
  findings.push(certFinding(null, memory.cert?.sha256 ?? null, false, null))

  return {
    kind: app.kind,
    dir: app.dir,
    name: app.name,
    version: { code: version.code, name: version.name },
    released: memory.released,
    cert: memory.cert,
    findings,
  }
}

export async function scanRelease(root: string, store: ReleaseStore): Promise<ReleaseApp[]> {
  const out: ReleaseApp[] = []
  for (const app of await findApps(root)) out.push(await scanApp(app, store))
  return out
}

/** Newest APK / AAB under the app's build outputs, release builds first. */
export async function newestArtifact(app: Pick<ReleaseApp, 'kind' | 'dir'>): Promise<string | null> {
  const bases = app.kind === 'flutter' ? [path.join(app.dir, 'build', 'app', 'outputs'), path.join(app.dir, 'android', 'app', 'build', 'outputs')] : [path.join(app.dir, 'build', 'outputs')]
  const found: { file: string; mtime: number; release: boolean }[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await listDir(dir)) {
      const full = path.join(dir, e.name)
      if (e.isDirectory() && depth < 5) await walk(full, depth + 1)
      else if (e.isFile() && /\.(apk|aab)$/i.test(e.name) && found.length < 200) {
        const st = await fs.stat(full).catch(() => null)
        if (st) found.push({ file: full, mtime: st.mtimeMs, release: /release/i.test(path.relative(app.dir, full)) })
      }
    }
  }
  for (const b of bases) await walk(b, 0)
  found.sort((a, b) => Number(b.release) - Number(a.release) || b.mtime - a.mtime)
  return found[0]?.file ?? null
}
