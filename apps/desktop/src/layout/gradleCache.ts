import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { extractZip } from './zip'

export interface Coordinate {
  group: string
  name: string
  /** null: unknown (BOM-managed, dynamic, unresolved property): the newest cached version is used. */
  version: string | null
}

export interface CachedArtifact {
  group: string
  name: string
  version: string
  /** `.aar` or `.jar` in the download cache. */
  file: string
}

const PART_RE = /^[A-Za-z0-9_][\w.\-+]*$/
const STATIC_VERSION_RE = /^[\w.\-]+$/
const AAR_MAX_TOTAL = 256 * 1024 * 1024
/** Bumped when `extractAar` keeps more of the archive: older extractions are redone once. */
const READY = '.ccm-ready'
const READY_VERSION = '2'

export const safePart = (s: string | null | undefined): s is string => !!s && PART_RE.test(s) && !s.includes('..')

/** Version as a cache dir name, or null when dynamic / a range / unsafe. */
export const staticVersion = (v: string | null | undefined): string | null => (v && STATIC_VERSION_RE.test(v) && safePart(v) && !v.endsWith('+') ? v : null)

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-]/)
  const pb = b.split(/[.\-]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const nx = /^\d+$/.test(x) ? Number(x) : NaN
    const ny = /^\d+$/.test(y) ? Number(y) : NaN
    const d = !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y)
    if (d) return d
  }
  return 0
}

export const isDir = async (p: string): Promise<boolean> => (await fs.stat(p).catch(() => null))?.isDirectory() ?? false
export const isFile = async (p: string): Promise<boolean> => (await fs.stat(p).catch(() => null))?.isFile() ?? false

const filesRoot = (gradleHome: string): string => path.join(gradleHome, 'caches', 'modules-2', 'files-2.1')

/** Files of one cached version: Gradle keeps each in its own `<sha1>/` folder. */
async function versionFiles(gradleHome: string, group: string, name: string, version: string): Promise<string[]> {
  const dir = path.join(filesRoot(gradleHome), group, name, version)
  const out: string[] = []
  for (const hash of await fs.readdir(dir).catch(() => [] as string[])) {
    for (const f of await fs.readdir(path.join(dir, hash)).catch(() => [] as string[])) out.push(path.join(dir, hash, f))
  }
  return out
}

/**
 * Versions to try: the asked one, then the newest cached ones (a conflict resolved to a higher version leaves only that
 * one in the cache).
 */
async function candidateVersions(gradleHome: string, c: Coordinate): Promise<string[]> {
  const all = (await fs.readdir(path.join(filesRoot(gradleHome), c.group, c.name)).catch(() => [] as string[])).filter(safePart)
  const newest = all.sort(compareVersions).reverse().slice(0, 5)
  return c.version ? [c.version, ...newest.filter((v) => v !== c.version)] : newest
}

interface Metadata {
  deps: Coordinate[]
  /** Artifact file name the runtime variant publishes (`.module`), if known. */
  fileName: string | null
}

/** `org.gradle.usage=java-runtime` library variant, Android / JVM flavors of multiplatform modules first. */
function moduleMetadata(json: unknown, c: { group: string; name: string; version: string }): Metadata | null {
  const variants = (json as { variants?: unknown })?.variants
  if (!Array.isArray(variants)) return null
  type Variant = { attributes?: Record<string, unknown>; dependencies?: unknown[]; files?: { name?: unknown }[]; 'available-at'?: { group?: unknown; module?: unknown; version?: unknown } }
  const runtime = (variants as Variant[]).filter((v) => v.attributes?.['org.gradle.usage'] === 'java-runtime' && (v.attributes?.['org.gradle.category'] ?? 'library') === 'library')
  const rank = (v: Variant): number => {
    const t = v.attributes?.['org.jetbrains.kotlin.platform.type']
    return t === 'androidJvm' ? 0 : t === 'jvm' ? 1 : t === undefined ? 2 : 9
  }
  const best = runtime.filter((v) => rank(v) < 9).sort((a, b) => rank(a) - rank(b))[0]
  if (!best) return null
  const at = best['available-at']
  if (at && typeof at.module === 'string') {
    const version = typeof at.version === 'string' ? at.version : c.version
    return { deps: [{ group: typeof at.group === 'string' ? at.group : c.group, name: at.module, version: staticVersion(version) }], fileName: null }
  }
  const deps: Coordinate[] = []
  for (const d of best.dependencies ?? []) {
    const o = d as { group?: unknown; module?: unknown; version?: Record<string, unknown>; attributes?: Record<string, unknown> }
    if (typeof o.group !== 'string' || typeof o.module !== 'string') continue
    const cat = o.attributes?.['org.gradle.category']
    if (cat === 'platform' || cat === 'enforced-platform') continue
    const v = o.version?.strictly ?? o.version?.requires ?? o.version?.prefers
    deps.push({ group: o.group, name: o.module, version: staticVersion(typeof v === 'string' ? v : null) })
  }
  const file = best.files?.find((f) => typeof f.name === 'string')?.name
  return { deps, fileName: typeof file === 'string' ? file : null }
}

/** `<dependencies>` of a POM (no parent / BOM lookup): compile + runtime scopes, `optional` skipped, `${…}` from `<properties>`. */
export function pomDependencies(pom: string, version: string): Coordinate[] {
  const text = pom.replace(/<!--[\s\S]*?-->/g, '').replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '').replace(/<build>[\s\S]*?<\/build>/g, '').replace(/<profiles>[\s\S]*?<\/profiles>/g, '')
  const props = new Map<string, string>([['project.version', version], ['version', version], ['pom.version', version]])
  const propsBlock = /<properties>([\s\S]*?)<\/properties>/.exec(text)?.[1] ?? ''
  for (const m of propsBlock.matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props.set(m[1]!, m[2]!)
  const sub = (s: string | undefined): string | null => {
    if (!s) return null
    const out = s.trim().replace(/\$\{([^}]+)\}/g, (_x, k: string) => props.get(k) ?? '\u0000')
    return out.includes('\u0000') ? null : out
  }
  const tag = (block: string, name: string): string | undefined => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(block)?.[1]
  const deps: Coordinate[] = []
  const list = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(text)?.[1] ?? ''
  for (const m of list.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const b = m[1]!
    const scope = (tag(b, 'scope') ?? 'compile').trim()
    if (scope !== 'compile' && scope !== 'runtime') continue
    if ((tag(b, 'optional') ?? '').trim() === 'true') continue
    const type = (tag(b, 'type') ?? 'jar').trim()
    if (type === 'pom') continue
    const group = sub(tag(b, 'groupId'))
    const name = sub(tag(b, 'artifactId'))
    if (group && name) deps.push({ group, name, version: staticVersion(sub(tag(b, 'version'))) })
  }
  return deps
}

async function metadataOf(c: { group: string; name: string; version: string }, files: string[]): Promise<Metadata | null> {
  const moduleFile = files.find((f) => path.basename(f) === `${c.name}-${c.version}.module`)
  if (moduleFile) {
    try {
      const m = moduleMetadata(JSON.parse(await fs.readFile(moduleFile, 'utf8')), c)
      if (m) return m
    } catch {
      // unreadable: try the POM
    }
  }
  const pomFile = files.find((f) => path.basename(f) === `${c.name}-${c.version}.pom`)
  const pom = pomFile ? await fs.readFile(pomFile, 'utf8').catch(() => null) : null
  return pom ? { deps: pomDependencies(pom, c.version), fileName: null } : null
}

/**
 * Gradle keeps parsed metadata in its binary descriptor cache and often no raw .pom / .module for the version it
 * resolved: borrow the dependencies of the nearest cached version that has them (older first).
 */
async function nearestMetadata(gradleHome: string, c: { group: string; name: string; version: string }): Promise<Metadata | null> {
  const all = (await fs.readdir(path.join(filesRoot(gradleHome), c.group, c.name)).catch(() => [] as string[])).filter(safePart).filter((v) => v !== c.version)
  const older = all.filter((v) => compareVersions(v, c.version) < 0).sort(compareVersions).reverse()
  const newer = all.filter((v) => compareVersions(v, c.version) > 0).sort(compareVersions)
  for (const v of [...older, ...newer].slice(0, 6)) {
    const m = await metadataOf({ ...c, version: v }, await versionFiles(gradleHome, c.group, c.name, v))
    if (m) return { deps: m.deps, fileName: null }
  }
  return null
}

export interface Resolution {
  artifacts: CachedArtifact[]
  /** `group:name` never downloaded (sync or build the project once). */
  missing: string[]
}

/**
 * Direct coordinates + their transitive runtime dependencies, from the metadata Gradle already cached (`.module`, else
 * `.pom`). Conflicts take the highest version, like Gradle. Artifacts without a cached file are reported missing.
 */
export async function resolveCached(gradleHome: string, roots: Coordinate[], opts: { transitive: boolean; max: number }): Promise<Resolution> {
  const chosen = new Map<string, { version: string; file: string | null }>()
  const missing = new Set<string>()
  const queue: Coordinate[] = [...roots]
  let steps = 0
  while (queue.length && steps++ < opts.max * 4) {
    const c = queue.shift()!
    if (!safePart(c.group) || !safePart(c.name)) continue
    const key = `${c.group}:${c.name}`
    const prev = chosen.get(key)
    if (prev && (!c.version || compareVersions(c.version, prev.version) <= 0)) continue
    if (!prev && chosen.size >= opts.max) continue
    // First version whose artifact is cached; one with metadata only still carries the dependencies.
    let hit: { version: string; files: string[]; file: string | null } | null = null
    for (const v of await candidateVersions(gradleHome, c)) {
      const files = await versionFiles(gradleHome, c.group, c.name, v)
      if (!files.length) continue
      const file = files.find((f) => path.basename(f) === `${c.name}-${v}.aar`) ?? files.find((f) => path.basename(f) === `${c.name}-${v}.jar`) ?? null
      if (file) {
        hit = { version: v, files, file }
        break
      }
      hit ??= { version: v, files, file: null }
    }
    if (!hit) {
      // A wanted version not cached while another one is: keep the cached one.
      if (!prev) missing.add(key)
      continue
    }
    if (prev && compareVersions(hit.version, prev.version) <= 0) continue
    const meta = opts.transitive ? ((await metadataOf({ ...c, version: hit.version }, hit.files)) ?? (await nearestMetadata(gradleHome, { ...c, version: hit.version }))) : null
    const named = meta?.fileName ? hit.files.find((f) => path.basename(f) === meta.fileName) : undefined
    const file = named ?? hit.file
    chosen.set(key, { version: hit.version, file })
    missing.delete(key)
    if (meta) queue.push(...meta.deps)
  }
  const artifacts: CachedArtifact[] = []
  for (const [key, v] of chosen) {
    if (!v.file) continue
    const [group, name] = key.split(':') as [string, string]
    artifacts.push({ group, name, version: v.version, file: v.file })
  }
  return { artifacts, missing: [...missing] }
}

/**
 * `res/`, R.txt, manifest and (with `classes`) `classes.jar` + `libs/*.jar` of an AAR under `dest`, extracted once.
 * `res` null when the AAR has none.
 */
export async function extractAar(file: string, dest: string): Promise<{ res: string | null; jars: string[] }> {
  const marker = path.join(dest, READY)
  if ((await fs.readFile(marker, 'utf8').catch(() => null)) !== READY_VERSION) {
    const tmp = `${dest}.partial-${randomBytes(4).toString('hex')}`
    try {
      await fs.mkdir(tmp, { recursive: true })
      const keep = (n: string): boolean => n.startsWith('res/') || n === 'R.txt' || n === 'AndroidManifest.xml' || n === 'classes.jar' || /^libs\/[^/]+\.jar$/.test(n)
      await extractZip(file, tmp, { maxTotal: AAR_MAX_TOTAL, concurrency: 4, filter: keep })
      await fs.writeFile(path.join(tmp, READY), READY_VERSION)
      await fs.rm(dest, { recursive: true, force: true })
      await fs.rename(tmp, dest)
    } catch (err) {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
      if ((await fs.readFile(marker, 'utf8').catch(() => null)) !== READY_VERSION) throw err
    }
  }
  const res = path.join(dest, 'res')
  const jars: string[] = []
  if (await isFile(path.join(dest, 'classes.jar'))) jars.push(path.join(dest, 'classes.jar'))
  for (const f of (await fs.readdir(path.join(dest, 'libs')).catch(() => [] as string[])).sort()) if (f.endsWith('.jar')) jars.push(path.join(dest, 'libs', f))
  return { res: (await isDir(res)) ? res : null, jars }
}
