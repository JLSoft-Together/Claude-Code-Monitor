import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AndroidFramework, AndroidModule, AndroidProject, AndroidStatus } from '@ccm/shared'

export interface DetectDeps {
  /** File text, null when missing / not a file / over the cap. */
  readText(file: string): Promise<string | null>
  listDirs(dir: string): Promise<string[]>
}

const MAX_FILE = 256 * 1024
const MAX_DIRS = 400
const SKIP_DIRS = new Set(['node_modules', 'build', 'Pods', 'DerivedData'])

export const fsDetectDeps: DetectDeps = {
  async readText(file) {
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size > MAX_FILE) return null
      return await fs.readFile(file, 'utf8')
    } catch {
      return null
    }
  },
  async listDirs(dir) {
    try {
      return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
    } catch {
      return []
    }
  },
}

const APP_ID = 'com.android.application'
const LIBRARY_IDS = new Set(['com.android.library', 'com.android.dynamic-feature', 'com.android.test', 'com.android.kotlin.multiplatform.library'])
const KMP_ID = 'org.jetbrains.kotlin.multiplatform'

/** Drops `//` line and block comments; good enough for Gradle scripts (strings with `//` only lose their tail). */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1')
}

const STRING_RE = /["']([^"'\r\n]+)["']/g

/** Gradle paths (`:a:b`) from `include` statements, Groovy and KTS, one or many per statement. */
export function parseIncludes(settings: string): string[] {
  const text = stripComments(settings)
  const out: string[] = []
  const re = /\binclude\b\s*(\()?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let body: string
    const start = m.index + m[0].length
    if (m[1]) {
      const end = text.indexOf(')', start)
      body = text.slice(start, end < 0 ? undefined : end)
    } else {
      // Groovy continues `include ':a',` onto the next line.
      const lines = text.slice(start).split(/\r?\n/)
      body = lines[0] ?? ''
      for (let i = 1; body.trimEnd().endsWith(',') && i < lines.length; i++) body += `\n${lines[i]}`
    }
    for (const s of body.matchAll(STRING_RE)) {
      const name = s[1]!.trim().replace(/^:+/, '')
      if (name && /^[\w.\-:]+$/.test(name)) {
        const p = `:${name}`
        if (!out.includes(p)) out.push(p)
      }
    }
  }
  return out
}

/** `project(':x').projectDir = file('dir')` / `new File(settingsDir, 'dir')`, relative to the settings dir. */
export function parseProjectDirs(settings: string): Map<string, string> {
  const out = new Map<string, string>()
  const re =
    /project\s*\(\s*["'](:?[\w.\-:]+)["']\s*\)\s*\.projectDir\s*=\s*(?:new\s+File\s*\(\s*(?:settingsDir|rootDir|rootProject\.projectDir)\s*,\s*["']([^"']+)["']\s*\)|file\s*\(\s*["']([^"']+)["']\s*\))/g
  for (const m of stripComments(settings).matchAll(re)) out.set(`:${m[1]!.replace(/^:+/, '')}`, (m[2] ?? m[3])!)
  return out
}

export function parseRootName(settings: string): string | null {
  return /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(stripComments(settings))?.[1]?.trim() || null
}

const normKey = (k: string): string => k.toLowerCase().replace(/[-_.]/g, '.')

/** `[plugins]` of a version catalog → normalized accessor (`android.application`) → plugin id. */
export function parseCatalogPlugins(toml: string): Map<string, string> {
  const out = new Map<string, string>()
  let section = ''
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    const head = /^\[([^\[\]]+)\]$/.exec(line)
    if (head) {
      section = head[1]!.trim()
      continue
    }
    if (section !== 'plugins') continue
    const m = /^["']?([\w.\-]+)["']?\s*=\s*(.+)$/.exec(line)
    if (!m) continue
    const id = /\bid\s*=\s*["']([^"']+)["']/.exec(m[2]!)?.[1] ?? /^["']([^"':]+)(?::[^"']*)?["']/.exec(m[2]!)?.[1]
    if (id) out.set(normKey(m[1]!), id.trim())
  }
  return out
}

export interface CatalogLibrary {
  group: string
  name: string
  /** null: no version in the catalog (BOM-managed or rich version without `require` / `strictly` / `prefer`). */
  version: string | null
}

/** `[libraries]` + `[bundles]` of a version catalog, keys normalized like accessors (`sdp.android`); single-line entries only. */
export function parseCatalogLibraries(toml: string): { libraries: Map<string, CatalogLibrary>; bundles: Map<string, string[]> } {
  const versions = new Map<string, string>()
  const raw: [string, string][] = []
  const bundles = new Map<string, string[]>()
  let section = ''
  for (const line0 of toml.split(/\r?\n/)) {
    const line = line0.replace(/\s+#.*$/, '').trim()
    const head = /^\[([^\[\]]+)\]$/.exec(line)
    if (head) {
      section = head[1]!.trim()
      continue
    }
    const m = /^["']?([\w.\-]+)["']?\s*=\s*(.+)$/.exec(line)
    if (!m) continue
    const key = m[1]!
    const value = m[2]!.trim()
    if (section === 'versions') {
      const v = /^["']([^"']+)["']$/.exec(value)?.[1] ?? /\b(?:strictly|require|prefer)\s*=\s*["']([^"']+)["']/.exec(value)?.[1]
      if (v) versions.set(key, v)
    } else if (section === 'libraries') raw.push([key, value])
    else if (section === 'bundles') bundles.set(normKey(key), [...value.matchAll(/["']([\w.\-]+)["']/g)].map((b) => normKey(b[1]!)))
  }
  const libraries = new Map<string, CatalogLibrary>()
  const attr = (value: string, name: string): string | undefined => new RegExp(`(?:^|[\\s{,])${name.replace('.', '\\.')}\\s*=\\s*["']([^"']+)["']`).exec(value)?.[1]
  for (const [key, value] of raw) {
    let lib: CatalogLibrary | null = null
    const short = /^["']([^"':]+):([^"':]+)(?::([^"']+))?["']$/.exec(value)
    if (short) lib = { group: short[1]!, name: short[2]!, version: short[3] ?? null }
    else {
      const module = attr(value, 'module')?.split(':')
      const group = module?.[0] ?? attr(value, 'group')
      const name = module?.[1] ?? attr(value, 'name')
      const ref = attr(value, 'version.ref')
      const version = ref ? (versions.get(ref) ?? null) : (attr(value, 'version') ?? /\bversion\s*=\s*\{[^}]*\b(?:strictly|require|prefer)\s*=\s*["']([^"']+)["']/.exec(value)?.[1] ?? null)
      if (group && name) lib = { group, name, version }
    }
    if (lib) libraries.set(normKey(key), lib)
  }
  return { libraries, bundles }
}

/** Plugin ids a build script applies (declarations with `apply false` excluded). */
export function pluginIds(build: string, catalogs: Map<string, Map<string, string>>): string[] {
  const ids: string[] = []
  const add = (id: string | undefined): void => {
    if (id && !ids.includes(id)) ids.push(id)
  }
  for (const line of stripComments(build).split(/\r?\n/)) {
    if (/\bapply\s*\(?\s*false\b/.test(line)) continue
    for (const m of line.matchAll(/\bid\s*\(?\s*["']([\w.\-]+)["']/g)) add(m[1])
    for (const m of line.matchAll(/\bapply\s+plugin\s*:\s*["']([\w.\-]+)["']/g)) add(m[1])
    for (const m of line.matchAll(/\bapply\s*\(\s*plugin\s*=\s*["']([\w.\-]+)["']/g)) add(m[1])
    if (/\bkotlin\s*\(\s*["']multiplatform["']\s*\)/.test(line)) add(KMP_ID)
    for (const m of line.matchAll(/\balias\s*\(\s*(\w+)\.plugins\.([\w.]+?)(?:\.get\(\))?\s*\)/g)) add(catalogs.get(m[1]!)?.get(normKey(m[2]!)))
  }
  return ids
}

export function moduleType(ids: readonly string[]): AndroidModule['type'] {
  if (ids.includes(APP_ID)) return 'application'
  if (ids.some((id) => LIBRARY_IDS.has(id))) return 'library'
  return 'unknown'
}

/** An `<activity>` / `<activity-alias>` with an intent-filter holding action MAIN and category (LEANBACK_)LAUNCHER. */
export function hasLauncher(manifest: string): boolean {
  const text = manifest.replace(/<!--[\s\S]*?-->/g, '')
  for (const m of text.matchAll(/<(activity-alias|activity)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g)) {
    for (const f of (m[2] ?? '').matchAll(/<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter\s*>/g)) {
      const body = f[1]!
      if (/android:name\s*=\s*["']android\.intent\.action\.MAIN["']/.test(body) && /android:name\s*=\s*["']android\.intent\.category\.(?:LEANBACK_)?LAUNCHER["']/.test(body)) return true
    }
  }
  return false
}

const isFlutterPubspec = (text: string | null): boolean => !!text && /^\s*sdk:\s*flutter\b/m.test(text)

/** Folder the framework files sit in: the parent of an `android/` Gradle root, else the root itself. */
const projectDirOf = (gradleRoot: string): string => (path.basename(gradleRoot) === 'android' ? path.dirname(gradleRoot) : gradleRoot)

export async function androidFramework(gradleRoot: string, kmp: boolean, deps: DetectDeps = fsDetectDeps): Promise<AndroidFramework> {
  const dir = projectDirOf(gradleRoot)
  if (isFlutterPubspec(await deps.readText(path.join(dir, 'pubspec.yaml')))) return 'flutter'
  if (dir !== gradleRoot) {
    const pkg = await deps.readText(path.join(dir, 'package.json'))
    if (pkg) {
      try {
        const json = JSON.parse(pkg) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> }
        if (json.dependencies?.['react-native'] || json.devDependencies?.['react-native']) return 'react-native'
      } catch {
        // not JSON
      }
    }
  }
  for (const name of ['capacitor.config.json', 'capacitor.config.ts', 'capacitor.config.js']) if ((await deps.readText(path.join(dir, name))) !== null) return 'capacitor'
  return kmp ? 'kmp' : 'native'
}

async function readFirst(deps: DetectDeps, files: string[]): Promise<{ file: string; text: string } | null> {
  for (const file of files) {
    const text = await deps.readText(file)
    if (text !== null) return { file, text }
  }
  return null
}

async function loadCatalogs(root: string, deps: DetectDeps): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>()
  // Only the default catalog; extra ones declared in settings (`versionCatalogs { create(...) }`) stay unresolved.
  const text = await deps.readText(path.join(root, 'gradle', 'libs.versions.toml'))
  if (text) out.set('libs', parseCatalogPlugins(text))
  return out
}

/** One Gradle root → project, or null when it has no Android module (plain Java/Kotlin). */
export async function analyzeGradleRoot(root: string, deps: DetectDeps = fsDetectDeps): Promise<AndroidProject | null> {
  const settings = await readFirst(deps, [path.join(root, 'settings.gradle.kts'), path.join(root, 'settings.gradle')])
  if (!settings) return null
  const catalogs = await loadCatalogs(root, deps)
  const dirs = parseProjectDirs(settings.text)
  const includes = parseIncludes(settings.text)
  const paths = includes.length ? includes : [':']

  const modules: AndroidModule[] = []
  let kmp = false
  for (const p of paths) {
    const custom = dirs.get(p)
    const dir = p === ':' ? root : custom ? path.resolve(root, custom) : path.join(root, ...p.slice(1).split(':'))
    const build = await readFirst(deps, [path.join(dir, 'build.gradle.kts'), path.join(dir, 'build.gradle')])
    const manifest = await readFirst(deps, [path.join(dir, 'src', 'main', 'AndroidManifest.xml'), path.join(dir, 'src', 'androidMain', 'AndroidManifest.xml')])
    if (!build && !manifest) continue
    const ids = build ? pluginIds(build.text, catalogs) : []
    if (ids.includes(KMP_ID)) kmp = true
    const type = moduleType(ids)
    const launcher = manifest ? hasLauncher(manifest.text) : false
    modules.push({ path: p, dir, type, manifest: manifest?.file ?? null, launcher, guessed: type === 'unknown' && launcher })
  }

  const androidLike = modules.filter((m) => m.type !== 'unknown' || m.manifest)
  if (!androidLike.length) return null
  let status: AndroidStatus
  if (modules.some((m) => m.type === 'application' || m.guessed)) status = 'runnable'
  else if (modules.some((m) => m.type === 'unknown' && m.manifest)) status = 'unknown'
  else status = 'no-app'

  const name = parseRootName(settings.text) ?? path.basename(projectDirOf(root))
  return { kind: 'android', dir: root, name, framework: await androidFramework(root, kmp, deps), status, modules }
}

async function hasSettings(dir: string, deps: DetectDeps): Promise<boolean> {
  return (await deps.readText(path.join(dir, 'settings.gradle.kts'))) !== null || (await deps.readText(path.join(dir, 'settings.gradle'))) !== null
}

const skipDir = (name: string): boolean => name.startsWith('.') || SKIP_DIRS.has(name)

/**
 * Gradle roots at `root`, up to two levels down, plus `<level2>/android`. A Gradle root's subfolders are not
 * searched (included builds like `build-logic/` have their own settings). The `android/` of a Flutter project
 * is left to the Flutter detector.
 */
export async function findGradleRoots(root: string, deps: DetectDeps = fsDetectDeps): Promise<string[]> {
  const found: string[] = []
  let visited = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (visited++ >= MAX_DIRS) return
    if (await hasSettings(dir, deps)) {
      found.push(dir)
      return
    }
    const children = (await deps.listDirs(dir)).filter((n) => !skipDir(n)).sort()
    for (const name of children) {
      if (depth < 2 || (depth === 2 && name === 'android')) await walk(path.join(dir, name), depth + 1)
    }
  }
  await walk(root, 0)
  const out: string[] = []
  for (const dir of found) {
    if (path.basename(dir) === 'android' && isFlutterPubspec(await deps.readText(path.join(path.dirname(dir), 'pubspec.yaml')))) continue
    out.push(dir)
  }
  return out
}

export async function detectAndroid(root: string, deps: DetectDeps = fsDetectDeps): Promise<AndroidProject[]> {
  const out: AndroidProject[] = []
  for (const dir of await findGradleRoots(root, deps)) {
    const project = await analyzeGradleRoot(dir, deps)
    if (project) out.push(project)
  }
  return out
}
