import path from 'node:path'
import type { EnvIssue } from '@ccm/shared'
import { readProperty, studioJbr, type EnvDeps } from './env'

export interface GradleVersion {
  text: string
  parts: [number, number, number]
}

export interface JdkInfo {
  home: string
  version: number
  /** `JAVA_VERSION` from the `release` file, e.g. `17.0.15`. */
  full: string
  label: string
}

export type JdkSource = 'gradle-properties' | 'setting' | 'idea' | 'discovered'

export interface JdkPick {
  home: string
  /** From the `release` file; null when it has none (the caller still runs `java -version`). */
  version: number | null
  label: string
  source: JdkSource
}

export interface JdkChoice {
  gradle: GradleVersion | null
  /** Null: no decision, the caller keeps its own lookup (setting → JAVA_HOME → JBR → PATH). */
  pick: JdkPick | null
  /** Lowest JDK the Gradle / AGP generation of this project runs on. */
  minJdk: number
  issue?: EnvIssue
}

export interface JdkPickOpts {
  setting: string | null
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
}

/** Gradle release → newest Java it runs on (docs.gradle.org compatibility matrix). */
const GRADLE_MAX_JAVA: [number, number, number][] = [
  [9, 1, 25],
  [8, 14, 24],
  [8, 10, 23],
  [8, 8, 22],
  [8, 5, 21],
  [8, 3, 20],
  [7, 6, 19],
  [7, 5, 18],
  [7, 3, 17],
  [7, 0, 16],
  [6, 7, 15],
  [6, 3, 14],
  [6, 0, 13],
  [5, 4, 12],
  [5, 0, 11],
]
const NEWEST_KNOWN: [number, number] = [9, 1]
const PREFERRED_JDK = 17

const pathOf = (platform: NodeJS.Platform): path.PlatformPath => (platform === 'win32' ? path.win32 : path.posix)
const javaExe = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'java.exe' : 'java')
const cmp = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
  return 0
}

export function parseGradleVersion(wrapperProps: string): GradleVersion | null {
  const url = readProperty(wrapperProps, 'distributionUrl')
  const m = url ? /gradle-(\d+)\.(\d+)(?:\.(\d+))?(?:-[^/]*?)?-(?:bin|all)\.zip$/.exec(url.trim()) : null
  if (!m) return null
  const parts: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
  return { text: m[3] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`, parts }
}

export function maxJavaFor(g: GradleVersion): number {
  if (cmp(g.parts.slice(0, 2), NEWEST_KNOWN) > 0) return Infinity
  for (const [maj, min, java] of GRADLE_MAX_JAVA) if (cmp(g.parts, [maj, min, 0]) >= 0) return java
  return 8
}

export function minJavaFor(g: GradleVersion | null): number {
  if (!g || g.parts[0] >= 8) return PREFERRED_JDK
  return g.parts[0] >= 7 ? 11 : 8
}

/** Highest JDK ≤ max that is ≥ 17, else ≥ 11, else any ≤ max. */
export function pickFor(gradle: GradleVersion, jdks: readonly JdkInfo[]): JdkInfo | null {
  const max = maxJavaFor(gradle)
  const ok = [...jdks].filter((j) => j.version <= max).sort((a, b) => b.version - a.version || cmp(fullParts(b.full), fullParts(a.full)))
  return ok.find((j) => j.version >= PREFERRED_JDK) ?? ok.find((j) => j.version >= 11) ?? ok[0] ?? null
}

const fullParts = (full: string): number[] => full.split(/[.+_-]/).map((s) => Number(s) || 0)

/** `JAVA_VERSION="17.0.15"` → 17; `"1.8.0_392"` → 8. */
export function parseRelease(text: string): { version: number; full: string } | null {
  const m = /^JAVA_VERSION\s*=\s*"?([^"\r\n]+)"?/m.exec(text)
  if (!m) return null
  const full = m[1]!.trim()
  const parts = full.split(/[.+_-]/)
  const version = parts[0] === '1' ? Number(parts[1]) : Number(parts[0])
  return Number.isInteger(version) && version > 0 ? { version, full } : null
}

function labelOf(home: string, platform: NodeJS.Platform): string {
  const p = pathOf(platform)
  const base = p.basename(home)
  // macOS bundles: <name>.jdk/Contents/Home
  if (base === 'Home' && p.basename(p.dirname(home)) === 'Contents') return p.basename(p.dirname(p.dirname(home))).replace(/\.jdk$/, '')
  return base
}

async function readJdk(home: string, platform: NodeJS.Platform, deps: EnvDeps): Promise<JdkInfo | null> {
  const p = pathOf(platform)
  if (!(await deps.isFile(p.join(home, 'bin', javaExe(platform))))) return null
  const text = await deps.readText(p.join(home, 'release'))
  const rel = text ? parseRelease(text) : null
  return rel ? { home, ...rel, label: labelOf(home, platform) } : null
}

function gradleUserHome(opts: JdkPickOpts): string {
  return opts.env.GRADLE_USER_HOME?.trim() || pathOf(opts.platform).join(opts.home, '.gradle')
}

/** Folders holding one JDK per child (`<child>`, `<child>/Contents/Home`, or one level deeper for old Gradle toolchains). */
function scanRoots(opts: JdkPickOpts): { dir: string; nested?: boolean }[] {
  const p = pathOf(opts.platform)
  const roots: { dir: string; nested?: boolean }[] = [{ dir: p.join(opts.home, '.jdks') }, { dir: p.join(gradleUserHome(opts), 'jdks'), nested: true }]
  if (opts.platform === 'win32') {
    const pf = opts.env.ProgramFiles || 'C:\\Program Files'
    for (const v of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto']) roots.push({ dir: p.join(pf, v) })
  } else if (opts.platform === 'darwin') {
    roots.push({ dir: '/Library/Java/JavaVirtualMachines' }, { dir: p.join(opts.home, 'Library', 'Java', 'JavaVirtualMachines') })
  } else roots.push({ dir: '/usr/lib/jvm' })
  return roots
}

async function discover(opts: JdkPickOpts, deps: EnvDeps): Promise<JdkInfo[]> {
  const p = pathOf(opts.platform)
  const homes: string[] = []
  for (const h of [opts.env.JAVA_HOME, studioJbr(opts.platform, opts.env)]) if (h?.trim() && p.isAbsolute(h.trim())) homes.push(h.trim())
  if (opts.platform === 'win32') homes.push(p.join(opts.env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jre'))
  const list = deps.listDirs
  if (list) {
    for (const root of scanRoots(opts)) {
      for (const name of await list(root.dir)) {
        const dir = p.join(root.dir, name)
        homes.push(dir, p.join(dir, 'Contents', 'Home'))
        if (root.nested) for (const sub of await list(dir)) homes.push(p.join(dir, sub))
      }
    }
  }
  const seen = new Set<string>()
  const out: JdkInfo[] = []
  for (const home of homes) {
    const info = await readJdk(home, opts.platform, deps)
    if (!info) continue
    const real = (await deps.realpath?.(home)) ?? home
    const key = opts.platform === 'win32' ? real.toLowerCase() : real
    if (seen.has(key)) continue
    seen.add(key)
    out.push(info)
  }
  return out
}

let cache = new WeakMap<EnvDeps, Map<string, Promise<JdkInfo[]>>>()

/** Discovery is cached per app run; the Run settings save clears it. */
export function clearJdkCache(): void {
  cache = new WeakMap()
}

export function discoverJdks(opts: JdkPickOpts, deps: EnvDeps): Promise<JdkInfo[]> {
  const { env } = opts
  const key = JSON.stringify([opts.platform, opts.home, env.JAVA_HOME, env.ProgramFiles, env.GRADLE_USER_HOME])
  let byKey = cache.get(deps)
  if (!byKey) cache.set(deps, (byKey = new Map()))
  let hit = byKey.get(key)
  if (!hit) {
    hit = discover(opts, deps)
    byKey.set(key, hit)
  }
  return hit
}

async function explicitHome(home: string | null | undefined, source: JdkSource, opts: JdkPickOpts, deps: EnvDeps): Promise<JdkPick | null> {
  const p = pathOf(opts.platform)
  const dir = home?.trim()
  if (!dir || !p.isAbsolute(dir) || !(await deps.isFile(p.join(dir, 'bin', javaExe(opts.platform))))) return null
  const text = await deps.readText(p.join(dir, 'release'))
  return { home: dir, version: (text ? parseRelease(text) : null)?.version ?? null, label: labelOf(dir, opts.platform), source }
}

/** Android Studio's per-project Gradle JDK: an absolute path, `#GRADLE_LOCAL_JAVA_HOME`, or a JDK table name like `corretto-17`. */
export function parseGradleJvm(xml: string): string | null {
  const m = /<option\s+name="gradleJvm"\s+value="([^"]*)"/.exec(xml)
  return m ? m[1]!.replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim() || null : null
}

function matchesName(name: string, jdk: JdkInfo): boolean {
  const n = name.toLowerCase()
  const label = jdk.label.toLowerCase()
  if (label === n || label.startsWith(`${n}.`)) return true
  if (/^\d+$/.test(n)) return jdk.version === Number(n)
  const m = /^(.+)-(\d+)$/.exec(n)
  return !!m && jdk.version === Number(m[2]) && label.startsWith(m[1]!)
}

async function ideaPick(root: string, jdks: readonly JdkInfo[], max: number, opts: JdkPickOpts, deps: EnvDeps): Promise<JdkPick | null> {
  const p = pathOf(opts.platform)
  const xml = await deps.readText(p.join(root, '.idea', 'gradle.xml'))
  let value = xml ? parseGradleJvm(xml) : null
  if (!value) return null
  if (value === '#GRADLE_LOCAL_JAVA_HOME') {
    const props = await deps.readText(p.join(root, '.gradle', 'config.properties'))
    value = props ? readProperty(props, 'java.home') : null
    if (!value) return null
  } else if (value.startsWith('#')) return null
  value = value.replace(/\$USER_HOME\$/g, opts.home).replace(/\$PROJECT_DIR\$/g, root)
  // A stale Studio choice (e.g. a JBR the Gradle version cannot run on) is skipped, unlike gradle.properties.
  const fits = (v: number | null): boolean => v === null || v <= max
  if (p.isAbsolute(value)) {
    const pick = await explicitHome(value, 'idea', opts, deps)
    return pick && fits(pick.version) ? pick : null
  }
  const named = jdks.filter((j) => matchesName(value, j) && fits(j.version)).sort((a, b) => cmp(fullParts(b.full), fullParts(a.full)))[0]
  return named ? { home: named.home, version: named.version, label: named.label, source: 'idea' } : null
}

/**
 * JDK for the project's Gradle wrapper, like Android Studio's Gradle JDK: `org.gradle.java.home` → Run setting →
 * `.idea/gradle.xml` gradleJvm → the best discovered JDK for the wrapper's Gradle version.
 */
export async function chooseJdk(root: string, opts: JdkPickOpts, deps: EnvDeps): Promise<JdkChoice> {
  const p = pathOf(opts.platform)
  const wrapper = await deps.readText(p.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties'))
  const gradle = wrapper ? parseGradleVersion(wrapper) : null
  const minJdk = minJavaFor(gradle)
  for (const file of [p.join(gradleUserHome(opts), 'gradle.properties'), p.join(root, 'gradle.properties')]) {
    const text = await deps.readText(file)
    const raw = text ? readProperty(text, 'org.gradle.java.home') : null
    const pick = raw ? await explicitHome(p.resolve(root, raw), 'gradle-properties', opts, deps) : null
    if (pick) return { gradle, pick, minJdk }
  }
  const setting = await explicitHome(opts.setting, 'setting', opts, deps)
  if (setting) return { gradle, pick: setting, minJdk }
  if (!gradle) return { gradle, pick: null, minJdk }
  const jdks = await discoverJdks(opts, deps)
  const max = maxJavaFor(gradle)
  const idea = await ideaPick(root, jdks, max, opts, deps)
  if (idea) return { gradle, pick: idea, minJdk }
  const best = pickFor(gradle, jdks)
  if (best) return { gradle, pick: { home: best.home, version: best.version, label: best.label, source: 'discovered' }, minJdk }
  if (!jdks.length) return { gradle, pick: null, minJdk }
  const found = [...jdks].sort((a, b) => a.version - b.version).map((j) => `${j.version} (${j.label})`).join(', ')
  return { gradle, pick: null, minJdk, issue: { code: 'jdk-incompatible', detail: `Gradle ${gradle.text} runs on JDK ${Number.isFinite(max) ? `≤ ${max}` : 'any'}; found ${found}` } }
}

const SOURCE_NOTE: Record<JdkSource, string> = {
  'gradle-properties': ' from org.gradle.java.home',
  setting: ' from Run settings',
  idea: ' from .idea/gradle.xml',
  discovered: '',
}

/** Build-log line, e.g. `JDK 17 (corretto-17.0.15) for Gradle 7.3.3`. */
export function describeJdk(choice: JdkChoice, home: string | null, version: number | null, platform: NodeJS.Platform): string | null {
  if (!home) return null
  const label = choice.pick?.label ?? labelOf(home, platform)
  const v = version ?? choice.pick?.version
  return `JDK ${v ?? '?'} (${label})${choice.gradle ? ` for Gradle ${choice.gradle.text}` : ''}${choice.pick ? SOURCE_NOTE[choice.pick.source] : ''}`
}
