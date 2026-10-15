import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AndroidModule, AndroidProject } from '@ccm/shared'
import { isWithin } from '../preview/paths'
import { parseCatalogLibraries, stripComments } from '../run/android/detect'
import { extractAar, isDir, isFile, resolveCached, safePart, staticVersion, type Coordinate } from './gradleCache'
import { closure, readBuildScript, scriptGraph } from './gradleGraph'
import { MODEL_CAPS, PACKAGE_RE, THEME_RE, type ProjectLoadPayload } from './projectModel'

export type { Coordinate } from './gradleCache'

export interface SourceModelOpts {
  platform: NodeJS.Platform
  /** GRADLE_USER_HOME (default ~/.gradle): libraries come from its `caches/modules-2` download cache. */
  gradleHome: string
  /** Extracted AARs, one `<group>/<name>-<version>/` per artifact, reused across sessions. */
  aarCacheDir: string
  /** Bundled loose kit: its classes + library res stand in for what the project lacks. */
  kit: ProjectLoadPayload | null
  /** Use classes + R.jar a previous build left in `build/` (default true). */
  prebuilt?: boolean
}

export interface SourceModel {
  payload: ProjectLoadPayload
  /** `android:theme` values of the app manifest, for the theme picker. */
  themes: string[]
  warnings: string[]
  /** Classes come from an earlier build: mtime of its R.jar. */
  prebuiltAt?: number
}

const MAX_LIBS = 800
const CONFIG_RE = /^(?:[a-z][A-Za-z0-9]*)?(?:implementation|Implementation|api|Api|compileOnly|CompileOnly)$/
const SKIP_CONFIG_RE = /^(?:test|androidTest|testFixtures|lint)/
const DEBUG_RE = /debug$/i

const artifactOf = (kitName: string): string => kitName.replace(/-\d[\w.\-]*$/, '')

/**
 * External dependencies a build script declares in a non-test configuration: `"g:a:v"` strings and default-catalog
 * accessors (`libs.x.y`, `libs.bundles.z`). `platform(...)` / `project(...)` / file deps are skipped.
 */
export function scriptDependencies(script: string, catalogToml: string | null): Coordinate[] {
  const catalog = catalogToml ? parseCatalogLibraries(catalogToml) : null
  const out: Coordinate[] = []
  const add = (c: Coordinate | null | undefined): void => {
    if (c && safePart(c.group) && safePart(c.name)) out.push({ ...c, version: staticVersion(c.version) })
  }
  const re = /\b([A-Za-z]+)\s*\(?\s*(?:["']([^"'\s]+)["']|\blibs\.([\w.]+))/g
  for (const m of stripComments(script).matchAll(re)) {
    if (!CONFIG_RE.test(m[1]!) || SKIP_CONFIG_RE.test(m[1]!)) continue
    if (m[2]) {
      const [group, name, version] = m[2].split('@')[0]!.split(':')
      if (group && name) add({ group, name, version: version ?? null })
      continue
    }
    if (!catalog) continue
    const key = m[3]!.replace(/\.get$/, '').toLowerCase().replace(/[-_.]/g, '.')
    if (key.startsWith('bundles.')) for (const k of catalog.bundles.get(key.slice(8)) ?? []) add(catalog.libraries.get(k))
    else if (!key.startsWith('plugins.') && !key.startsWith('versions.')) add(catalog.libraries.get(key))
  }
  return out
}

function manifestFacts(text: string, namespace: string | null): { pkg: string | null; appTheme: string | null; activityThemes: Record<string, string> } {
  const attr = (tag: string, name: string): string | undefined => new RegExp(`\\bandroid:${name}\\s*=\\s*["']([^"']+)["']`).exec(tag)?.[1]?.trim()
  const pkg = /<manifest\b[^>]*?\bpackage\s*=\s*["']([^"']+)["']/.exec(text)?.[1] ?? null
  const ns = namespace ?? pkg
  let appTheme: string | null = null
  const activityThemes: Record<string, string> = {}
  for (const m of text.matchAll(/<(application|activity|activity-alias)\b([^>]*)>/g)) {
    const theme = attr(m[2]!, 'theme')
    if (!theme || !THEME_RE.test(theme)) continue
    if (m[1] === 'application') {
      appTheme ??= theme
      continue
    }
    const raw = attr(m[2]!, 'name')
    const name = raw && ns && (raw.startsWith('.') || !raw.includes('.')) ? `${ns}${raw.startsWith('.') ? '' : '.'}${raw}` : raw
    if (name && PACKAGE_RE.test(name) && Object.keys(activityThemes).length < MODEL_CAPS.activityThemes) activityThemes[name] = theme
  }
  return { pkg: pkg && PACKAGE_RE.test(pkg) ? pkg : null, appTheme, activityThemes }
}

const mtimeOf = async (p: string): Promise<number> => (await fs.stat(p).catch(() => null))?.mtimeMs ?? 0
const subdirs = async (dir: string): Promise<string[]> => (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name)

/** Prefer `want`, then debug variants, then the newest. */
function pickVariant(found: { variant: string; mtime: number }[], want: string | null): string | null {
  if (!found.length) return null
  if (want && found.some((f) => f.variant === want)) return want
  const debug = found.filter((f) => DEBUG_RE.test(f.variant))
  return (debug.length ? debug : found).sort((a, b) => b.mtime - a.mtime)[0]!.variant
}

/** R.jar of the app's last build (`compile_and_runtime_not_namespaced_r_class_jar/<variant>/[<task>/]R.jar`): R of the app and every library. */
export async function appRJar(appDir: string): Promise<{ file: string; variant: string; mtime: number } | null> {
  const base = path.join(appDir, 'build', 'intermediates', 'compile_and_runtime_not_namespaced_r_class_jar')
  const found: { file: string; variant: string; mtime: number }[] = []
  for (const variant of await subdirs(base)) {
    const direct = path.join(base, variant, 'R.jar')
    const files = [direct, ...(await subdirs(path.join(base, variant))).map((t) => path.join(base, variant, t, 'R.jar'))]
    for (const file of files) if (await isFile(file)) found.push({ file, variant, mtime: await mtimeOf(file) })
  }
  const v = pickVariant(found, null)
  return found.filter((f) => f.variant === v).sort((a, b) => b.mtime - a.mtime)[0] ?? null
}

/** Class output of a module's last build: Kotlin, javac and AGP built-in Kotlin dirs of one variant, else its runtime jar. */
export async function moduleClasses(moduleDir: string, want: string | null): Promise<string[]> {
  const build = path.join(moduleDir, 'build')
  const kotlin = path.join(build, 'tmp', 'kotlin-classes')
  const javac = path.join(build, 'intermediates', 'javac')
  const builtIn = path.join(build, 'intermediates', 'built_in_kotlinc')
  const found: { variant: string; mtime: number }[] = []
  for (const root of [kotlin, javac, builtIn]) for (const v of await subdirs(root)) found.push({ variant: v, mtime: await mtimeOf(path.join(root, v)) })
  const v = pickVariant(found, want)
  const out: string[] = []
  if (v) {
    if (await isDir(path.join(kotlin, v))) out.push(path.join(kotlin, v))
    for (const root of [javac, builtIn]) {
      for (const task of await subdirs(path.join(root, v))) if (await isDir(path.join(root, v, task, 'classes'))) out.push(path.join(root, v, task, 'classes'))
    }
  }
  if (out.length) return out
  const jars = path.join(build, 'intermediates', 'runtime_library_classes_jar')
  const jarFound: { variant: string; mtime: number }[] = []
  for (const jv of await subdirs(jars)) jarFound.push({ variant: jv, mtime: await mtimeOf(path.join(jars, jv)) })
  const jv = pickVariant(jarFound, want)
  if (!jv) return []
  for (const task of await subdirs(path.join(jars, jv))) if (await isFile(path.join(jars, jv, task, 'classes.jar'))) out.push(path.join(jars, jv, task, 'classes.jar'))
  return out
}

/**
 * `project/load` params without a Gradle run: `src/main/res` of the app and the project modules it names (lowest
 * priority first, app last, then the previewed file's own source set), res + classes of the libraries they declare
 * (transitively, from the metadata Gradle cached), and when a previous build left them the module classes + the app's
 * R.jar (`prebuiltAt`). Missing pieces come from the loose kit. Null when there is no project res to add over the kit.
 */
export async function buildSourceModel(project: AndroidProject, app: string, file: string, opts: SourceModelOpts): Promise<SourceModel | null> {
  const warnings: string[] = []
  const byPath = new Map(project.modules.map((m) => [m.path, m]))
  let owner: AndroidModule | null = null
  for (const m of project.modules) if (isWithin(m.dir, file, opts.platform) && (!owner || m.dir.length > owner.dir.length)) owner = m
  const graph = await scriptGraph(project)
  const order = byPath.has(app) ? closure(graph, app) : []
  if (owner && !order.includes(owner.path)) order.push(owner.path)
  const mods = order.map((p) => byPath.get(p)).filter((m): m is AndroidModule => !!m)

  const resDirs: string[] = []
  for (const m of [...mods].reverse()) {
    const dir = path.join(m.dir, 'src', 'main', 'res')
    if (await isDir(dir)) resDirs.push(dir)
  }
  if (owner) {
    const rel = path.relative(owner.dir, file).split(/[\\/]/)
    if (rel[0] === 'src' && rel[1] && rel[1] !== 'main' && rel[2] === 'res') {
      const dir = path.join(owner.dir, 'src', rel[1], 'res')
      if (await isDir(dir)) resDirs.push(dir)
    }
  }
  if (!resDirs.length) return null

  const appModule = byPath.get(app) ?? owner
  const rJar = opts.prebuilt !== false && appModule ? await appRJar(appModule.dir) : null

  const catalog = await fs.readFile(path.join(project.dir, 'gradle', 'libs.versions.toml'), 'utf8').catch(() => null)
  const scripts = await Promise.all(mods.map((m) => readBuildScript(m.dir)))
  const roots: Coordinate[] = []
  for (const s of scripts) roots.push(...(s ? scriptDependencies(s, catalog) : []))

  // Without the project's R.jar the kit's R.jar stays: same-named kit libraries win so res and classes match it.
  const kitArtifacts = new Set((opts.kit?.aarResDirs ?? []).map((a) => artifactOf(a.name)))
  const resolved = await resolveCached(opts.gradleHome, roots, { transitive: true, max: MAX_LIBS })
  const libs = rJar ? resolved.artifacts : resolved.artifacts.filter((a) => !kitArtifacts.has(a.name))
  if (resolved.missing.length) warnings.push(`not in the Gradle cache (sync or build the project once): ${resolved.missing.slice(0, 10).join(', ')}${resolved.missing.length > 10 ? ', …' : ''}`)

  const aarRes: { dir: string; name: string }[] = []
  const libJars: string[] = []
  await Promise.all(
    libs.map(async (a, i) => {
      if (a.file.endsWith('.jar')) {
        libJars[i * 8] = a.file
        return
      }
      try {
        const x = await extractAar(a.file, path.join(opts.aarCacheDir, a.group, `${a.name}-${a.version}`))
        if (x.res) aarRes[i] = { dir: x.res, name: `${a.group}:${a.name}:${a.version}` }
        x.jars.slice(0, 8).forEach((j, k) => (libJars[i * 8 + k] = j))
      } catch (err) {
        warnings.push(`AAR ${a.group}:${a.name}:${a.version} unreadable: ${err instanceof Error ? err.message : String(err)}`)
      }
    }),
  )

  const classDirs: string[] = []
  if (rJar) for (const m of mods) classDirs.push(...(await moduleClasses(m.dir, rJar.variant)))

  const appScript = appModule ? stripComments(scripts[mods.indexOf(appModule)] ?? (await readBuildScript(appModule.dir)) ?? '') : ''
  const nsRaw = /\bnamespace\s*=?\s*["']([\w.]+)["']/.exec(appScript)?.[1] ?? null
  const manifestText = appModule?.manifest ? await fs.readFile(appModule.manifest, 'utf8').catch(() => null) : null
  const facts = manifestText ? manifestFacts(manifestText, nsRaw) : { pkg: null, appTheme: null, activityThemes: {} }
  const namespace = (nsRaw && PACKAGE_RE.test(nsRaw) ? nsRaw : null) ?? facts.pkg ?? opts.kit?.packageName ?? 'dev.ccm.source'
  const sdkOf = (name: string): number | undefined => {
    const v = Number(new RegExp(`\\b${name}(?:Version)?\\s*[=(]?\\s*(\\d{1,3})\\b`).exec(appScript)?.[1])
    return Number.isInteger(v) && v > 0 ? v : undefined
  }

  const projectRes = aarRes.filter(Boolean)
  const have = new Set(libs.map((a) => a.name))
  const kitRes = (opts.kit?.aarResDirs ?? []).filter((k) => !have.has(artifactOf(k.name)))
  const payload: ProjectLoadPayload = {
    resDirs: resDirs.slice(0, MODEL_CAPS.resDirs),
    aarResDirs: (rJar ? [...projectRes, ...kitRes] : [...kitRes, ...projectRes]).slice(0, MODEL_CAPS.aarResDirs),
    // Module classes first: they shadow same-named library classes like on device; the kit last as a fallback.
    classpath: [...new Set([...classDirs, ...libJars.filter(Boolean), ...(opts.kit?.classpath ?? [])])].slice(0, MODEL_CAPS.classpath),
    packageName: namespace,
    namespace,
    activityThemes: facts.activityThemes,
  }
  const r = rJar?.file ?? opts.kit?.rJar
  if (r) payload.rJar = r
  const appTheme = facts.appTheme ?? opts.kit?.appTheme
  if (appTheme) payload.appTheme = appTheme
  const minSdk = sdkOf('minSdk')
  const targetSdk = sdkOf('targetSdk')
  if (minSdk !== undefined) payload.minSdk = minSdk
  if (targetSdk !== undefined) payload.targetSdk = targetSdk
  const sampleDataDirs: string[] = []
  for (const m of [owner, appModule]) if (m && (await isDir(path.join(m.dir, 'sampledata')))) sampleDataDirs.push(path.join(m.dir, 'sampledata'))
  if (sampleDataDirs.length) payload.sampleDataDirs = [...new Set(sampleDataDirs)]
  const themes = [...new Set([facts.appTheme, ...Object.values(facts.activityThemes)].filter((t): t is string => !!t))]
  return { payload, themes, warnings, ...(rJar ? { prebuiltAt: rJar.mtime } : {}) }
}
