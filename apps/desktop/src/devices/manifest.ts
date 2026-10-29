import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DevDeepLink, DevManifest } from '@ccm/shared'
import { xmlAttrs } from './uiDump'

const MANIFEST_MAX = 2 * 1024 * 1024
const LINKS_MAX = 24
/** Android app module layouts: plain Gradle project, a single-module root, and Flutter's `android/`. */
export const MANIFEST_CANDIDATES = ['app/src/main/AndroidManifest.xml', 'src/main/AndroidManifest.xml', 'android/app/src/main/AndroidManifest.xml']

const attr = (a: Record<string, string>, name: string): string | undefined => a[`android:${name}`] ?? a[name]

/** `.Main` / `Main` → `pkg.Main`; already-qualified names stay. */
export function qualify(name: string, pkg: string | null): string {
  if (name.startsWith('.')) return pkg ? `${pkg}${name}` : name
  if (!name.includes('.') && pkg) return `${pkg}.${name}`
  return name
}

interface DataTag {
  scheme?: string
  host?: string
  port?: string
  path?: string
  pathPrefix?: string
  pathPattern?: string
}

/** Sample URIs of one VIEW intent-filter: its `<data>` attributes combine across the filter's elements. */
export function filterLinks(data: DataTag[]): string[] {
  const schemes = [...new Set(data.map((d) => d.scheme).filter((s): s is string => !!s))]
  const hosts = [...new Set(data.map((d) => (d.host ? (d.port ? `${d.host}:${d.port}` : d.host) : undefined)).filter((h): h is string => !!h))]
  const paths = [...new Set(data.map((d) => d.path ?? d.pathPrefix ?? (d.pathPattern ? d.pathPattern.replace(/\.\*|\\\./g, (m) => (m === '.*' ? '' : '.')) : undefined)).filter((p): p is string => !!p))]
  const out: string[] = []
  for (const s of schemes) {
    if (!hosts.length) {
      out.push(`${s}://`)
      continue
    }
    for (const h of hosts) {
      const host = h.replace(/^\*\./, '')
      if (!paths.length) out.push(`${s}://${host}`)
      for (const p of paths) out.push(`${s}://${host}${p.startsWith('/') ? p : `/${p}`}`)
    }
  }
  return out
}

/** Activities (and aliases) with their exported flag, launcher flag and deep-link samples. Comments dropped; no XML entities beyond the basic five. */
export function parseManifest(xml: string): { pkg: string | null; activities: DevDeepLink[] } {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '')
  const root = /<manifest\b([^>]*)>/.exec(text)
  const pkg = root ? (xmlAttrs(root[1]!).package ?? null) : null
  const activities: DevDeepLink[] = []
  for (const m of text.matchAll(/<(activity|activity-alias)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/g)) {
    const a = xmlAttrs(m[2]!)
    const name = attr(a, 'name')
    if (!name) continue
    const body = m[4] ?? ''
    const filters = [...body.matchAll(/<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter\s*>/g)].map((f) => f[1]!)
    const names = (f: string, tag: string): string[] => [...f.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, 'g'))].map((x) => attr(xmlAttrs(x[1]!), 'name') ?? '')
    let launcher = false
    const links: string[] = []
    for (const f of filters) {
      const actions = names(f, 'action')
      const cats = names(f, 'category')
      if (actions.includes('android.intent.action.MAIN') && cats.includes('android.intent.category.LAUNCHER')) launcher = true
      if (!actions.includes('android.intent.action.VIEW')) continue
      const data = [...f.matchAll(/<data\b([^>]*)\/?>/g)].map((d) => {
        const x = xmlAttrs(d[1]!)
        return { scheme: attr(x, 'scheme'), host: attr(x, 'host'), port: attr(x, 'port'), path: attr(x, 'path'), pathPrefix: attr(x, 'pathPrefix'), pathPattern: attr(x, 'pathPattern') }
      })
      for (const l of filterLinks(data)) if (!links.includes(l) && links.length < LINKS_MAX) links.push(l)
    }
    const exportedAttr = attr(a, 'exported')
    // Before Android 12 an activity with an intent-filter was exported unless it said otherwise.
    const exported = exportedAttr === undefined ? filters.length > 0 : exportedAttr === 'true'
    activities.push({ activity: qualify(name, pkg), exported, launcher, links })
  }
  return { pkg, activities }
}

/** `applicationId "x"` / `applicationId = "x"`, else `namespace`, from a Gradle (Groovy or Kotlin) build file. */
export function gradleAppId(text: string): string | null {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const id = /\bapplicationId\s*=?\s*["']([\w.]+)["']/.exec(clean)?.[1]
  return id ?? /\bnamespace\s*=?\s*["']([\w.]+)["']/.exec(clean)?.[1] ?? null
}

/** `values-vi` → `vi`, `values-pt-rBR` → `pt-BR`, `values-b+sr+Latn` → `sr-Latn`; other qualifiers → null. */
export function valuesLocale(dir: string): string | null {
  const q = /^values-(.+)$/.exec(dir)?.[1]
  if (!q) return null
  const bcp = /^b\+([a-zA-Z]{2,3}(?:\+[a-zA-Z0-9]{2,8})*)$/.exec(q)
  if (bcp) return bcp[1]!.replace(/\+/g, '-')
  const m = /^([a-z]{2,3})(?:-r([A-Z]{2}))?$/.exec(q)
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]!) : null
}

const readSmall = async (file: string): Promise<string | null> => {
  try {
    const st = await fs.stat(file)
    return st.isFile() && st.size <= MANIFEST_MAX ? await fs.readFile(file, 'utf8') : null
  } catch {
    return null
  }
}

const listDir = async (dir: string): Promise<string[]> => {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

/** First app manifest under `root` (a folder the Explorer gate already allowed), its package and resource locales. */
export async function readProjectManifest(root: string): Promise<DevManifest> {
  for (const rel of MANIFEST_CANDIDATES) {
    const file = path.join(root, rel)
    const xml = await readSmall(file)
    if (xml === null) continue
    const parsed = parseManifest(xml)
    const main = path.dirname(file)
    const module = path.dirname(path.dirname(main))
    let pkg = parsed.pkg
    if (!pkg) for (const g of ['build.gradle.kts', 'build.gradle']) pkg ??= gradleAppId((await readSmall(path.join(module, g))) ?? '')
    const locales = new Set<string>()
    for (const d of await listDir(path.join(main, 'res'))) {
      const l = valuesLocale(d)
      if (l) locales.add(l)
    }
    // Flutter apps keep their strings in ARB files, not values-xx.
    for (const f of await listDir(path.join(root, 'lib', 'l10n'))) {
      const l = /^\w+?_([a-z]{2,3}(?:_[A-Z]{2})?)\.arb$/.exec(f)?.[1]
      if (l) locales.add(l.replace('_', '-'))
    }
    const activities = parsed.activities.map((a) => ({ ...a, activity: qualify(a.activity, pkg) }))
    return { ok: true, manifest: rel, pkg, activities, locales: [...locales].sort() }
  }
  return { ok: false, error: 'no-manifest' }
}
