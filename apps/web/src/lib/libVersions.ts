import { bumpKind, compareLibVersions, isLibName, isPrereleaseVersion, type BumpKind, type LibCheckResult, type LibEco, type LibLookup, type LibQuery, type LibRegistry } from '@ccm/shared'
import { desktop } from './desktop'

interface LibsBridge {
  libsCheck?: (req: { queries: LibQuery[]; fresh: boolean }) => Promise<LibCheckResult>
}
const bridge = desktop as unknown as LibsBridge | undefined

export const hasLibsCheck = typeof bridge?.libsCheck === 'function'
export const libsCheck = (queries: LibQuery[], fresh = false): Promise<LibCheckResult> => bridge?.libsCheck?.({ queries, fresh }) ?? Promise.resolve({ ok: false, error: 'unavailable' })

export type DepFileKind = 'toml' | 'gradle' | 'pubspec' | 'npm'

export function depFileKind(name: string): DepFileKind | null {
  const n = name.toLowerCase()
  if (n.endsWith('.versions.toml')) return 'toml'
  if (n === 'build.gradle' || n === 'build.gradle.kts') return 'gradle'
  if (n === 'pubspec.yaml') return 'pubspec'
  if (n === 'package.json') return 'npm'
  return null
}

export interface Dep {
  eco: LibEco
  name: string
  /** Version the file pins (lower bound of a range). */
  current: string
  /** As written: `^1.2.0`, `1.2.0`, `{ strictly = … }`. */
  spec: string
  line: number
  section: string
  /** Gradle plugin id (looked up as its marker artifact). */
  plugin?: string
  /** libs.versions.toml `version.ref` key. */
  ref?: string
}

const VERSION_TOKEN = /\d+(?:\.(?:\d+|x|\*))*(?:[-+][0-9A-Za-z.+-]*)?/

/** `^1.2.3`, `~1.2`, `>=1.2.0 <2.0.0`, `1.x` → the lowest version the range allows; null for tags / paths / git / `*`. */
export function rangeBase(spec: string): string | null {
  const s = spec.trim()
  if (!s || /^(\*|x|latest|next|any)$/i.test(s) || /^(workspace|file|link|git|github|https?|npm|portal|patch):/i.test(s) || s.includes('/')) return null
  const m = VERSION_TOKEN.exec(s.replace(/^[\^~=v<>\s]+/, ''))
  if (!m) return null
  return m[0].replace(/\.(x|\*)/gi, '.0')
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length

const tomlString = (v: string): string | null => /^\s*["']([^"']*)["']/.exec(v)?.[1] ?? null
const inlineField = (table: string, field: string): string | null => {
  const m = new RegExp(`(?:^|[{,\\s])${field.replace('.', '\\.')}\\s*=\\s*("[^"]*"|'[^']*'|\\{[^}]*\\})`).exec(table)
  if (!m) return null
  const v = m[1]!
  if (v.startsWith('{')) return tomlString(/(?:strictly|require|prefer)\s*=\s*("[^"]*"|'[^']*')/.exec(v)?.[1] ?? '') ?? (/\bref\s*=\s*("[^"]*"|'[^']*')/.test(v) ? `ref:${tomlString(/\bref\s*=\s*("[^"]*"|'[^']*')/.exec(v)![1]!)}` : null)
  return tomlString(v)
}

/** `gradle/libs.versions.toml`: libraries and plugins with a version (literal, `version.ref` or rich version). */
export function parseVersionsToml(text: string): Dep[] {
  const versions = new Map<string, string>()
  const rows: { section: string; key: string; value: string; line: number }[] = []
  let section = ''
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '')
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sec) {
      section = sec[1]!.trim()
      return
    }
    const kv = /^\s*([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.+)$/.exec(line)
    if (!kv) return
    const key = kv[1]!.replace(/"/g, '')
    if (section === 'versions') {
      const v = kv[2]!.trim().startsWith('{') ? tomlString(/(?:strictly|require|prefer)\s*=\s*("[^"]*"|'[^']*')/.exec(kv[2]!)?.[1] ?? '') : tomlString(kv[2]!)
      if (v) versions.set(key, v)
    } else if (section === 'libraries' || section === 'plugins') rows.push({ section, key, value: kv[2]!.trim(), line: i + 1 })
  })
  const out: Dep[] = []
  for (const r of rows) {
    let coord: string | null = null
    let version: string | null = null
    let plugin: string | undefined
    let ref: string | undefined
    if (r.value.startsWith('{')) {
      const vr = inlineField(r.value, 'version.ref')
      const v = inlineField(r.value, 'version')
      if (vr) ref = vr
      else if (v?.startsWith('ref:')) ref = v.slice(4)
      else version = v
      if (ref) version = versions.get(ref) ?? null
      if (r.section === 'plugins') plugin = inlineField(r.value, 'id') ?? undefined
      else {
        const module = inlineField(r.value, 'module')
        const group = inlineField(r.value, 'group')
        const name = inlineField(r.value, 'name')
        coord = module ?? (group && name ? `${group}:${name}` : null)
      }
    } else {
      const s = tomlString(r.value)
      if (!s) continue
      const parts = s.split(':')
      if (r.section === 'plugins' && parts.length === 2) [plugin, version] = parts as [string, string]
      else if (parts.length === 3) {
        coord = `${parts[0]}:${parts[1]}`
        version = parts[2]!
      }
    }
    if (plugin) coord = `${plugin}:${plugin}.gradle.plugin`
    if (!coord || !version || !isLibName('maven', coord)) continue
    out.push({ eco: 'maven', name: coord, current: version, spec: version, line: r.line, section: r.section, ...(plugin ? { plugin } : {}), ...(ref ? { ref } : {}) })
  }
  return out
}

/** `build.gradle(.kts)`: plain `"group:artifact:version"` literals and `id("x") version "y"` plugins; `$var` versions skipped. */
export function parseGradleDeps(text: string): Dep[] {
  const out: Dep[] = []
  for (const m of text.matchAll(/["']([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([0-9][A-Za-z0-9_.+-]*)(?:@[a-z]+)?["']/g)) {
    const name = `${m[1]}:${m[2]}`
    if (isLibName('maven', name)) out.push({ eco: 'maven', name, current: m[3]!, spec: m[3]!, line: lineOf(text, m.index ?? 0), section: 'dependencies' })
  }
  for (const m of text.matchAll(/\bid\s*\(?\s*["']([A-Za-z0-9_.-]+)["']\s*\)?\s+version\s*\(?\s*["']([0-9][A-Za-z0-9_.+-]*)["']/g)) {
    const name = `${m[1]}:${m[1]}.gradle.plugin`
    if (isLibName('maven', name)) out.push({ eco: 'maven', name, current: m[2]!, spec: m[2]!, line: lineOf(text, m.index ?? 0), section: 'plugins', plugin: m[1]! })
  }
  return out.sort((a, b) => a.line - b.line)
}

const PUB_SECTIONS = new Set(['dependencies', 'dev_dependencies', 'dependency_overrides'])

/** `pubspec.yaml` hosted packages (`name: ^1.2.3` or a map with `version:`); sdk / path / git entries skipped. */
export function parsePubspec(text: string): Dep[] {
  const out: Dep[] = []
  const lines = text.split(/\r?\n/)
  let section: string | null = null
  let pending: { name: string; line: number; indent: number; skip: boolean } | null = null
  const flush = () => (pending = null)
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '')
    if (!line.trim()) return
    const indent = /^ */.exec(line)![0].length
    if (indent === 0) {
      flush()
      const top = /^([A-Za-z_]+)\s*:/.exec(line)
      section = top && PUB_SECTIONS.has(top[1]!) ? top[1]! : null
      return
    }
    if (!section) return
    if (pending && indent > pending.indent) {
      const kv = /^\s*([a-z_]+)\s*:\s*(.*)$/.exec(line)
      if (kv && /^(sdk|path|git)$/.test(kv[1]!)) pending.skip = true
      if (kv?.[1] === 'version' && !pending.skip) {
        const spec = kv[2]!.replace(/^["']|["']$/g, '')
        const base = rangeBase(spec)
        if (base && isLibName('pub', pending.name)) out.push({ eco: 'pub', name: pending.name, current: base, spec, line: pending.line, section })
        pending.skip = true
      }
      return
    }
    flush()
    const dep = /^(\s+)([a-z][a-z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!dep) return
    const value = dep[3]!.trim().replace(/^["']|["']$/g, '')
    if (!value) {
      pending = { name: dep[2]!, line: i + 1, indent: dep[1]!.length, skip: false }
      return
    }
    const base = rangeBase(value)
    if (base && isLibName('pub', dep[2]!)) out.push({ eco: 'pub', name: dep[2]!, current: base, spec: value, line: i + 1, section })
  })
  return out
}

const NPM_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const

/** `package.json` dependencies with a semver range; tags, aliases, git / file / workspace specs skipped. */
export function parsePackageJson(text: string): Dep[] {
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text) as Record<string, unknown>
  } catch {
    return []
  }
  const out: Dep[] = []
  for (const section of NPM_SECTIONS) {
    const deps = doc[section]
    if (!deps || typeof deps !== 'object') continue
    const secAt = text.indexOf(`"${section}"`)
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string' || !isLibName('npm', name)) continue
      const base = rangeBase(spec)
      if (!base) continue
      const at = text.indexOf(`"${name}"`, Math.max(0, secAt))
      out.push({ eco: 'npm', name, current: base, spec, line: at >= 0 ? lineOf(text, at) : 1, section })
    }
  }
  return out
}

export function parseDepFile(kind: DepFileKind, text: string): Dep[] {
  if (kind === 'toml') return parseVersionsToml(text)
  if (kind === 'gradle') return parseGradleDeps(text)
  if (kind === 'pubspec') return parsePubspec(text)
  return parsePackageJson(text)
}

export type LibStatus = 'outdated' | 'current' | 'unknown' | 'error'

export interface LibRow extends Dep {
  latest: string | null
  /** Latest is a prerelease (only offered when the current version is one). */
  latestPre: boolean
  bump: BumpKind
  status: LibStatus
  lookup: LibLookup | null
}

export const libKey = (d: Pick<Dep, 'eco' | 'name'>): string => `${d.eco}:${d.name}`

/** Merge parsed deps with registry answers; prereleases count only when the file already pins one. */
export function libRows(deps: readonly Dep[], results: readonly LibLookup[] | null): LibRow[] {
  const byKey = new Map((results ?? []).map((r) => [libKey(r), r]))
  return deps.map((d) => {
    const r = byKey.get(libKey(d)) ?? null
    if (!r) return { ...d, latest: null, latestPre: false, bump: 'none', status: 'unknown', lookup: null }
    if (!r.ok) return { ...d, latest: null, latestPre: false, bump: 'none', status: 'error', lookup: r }
    const pre = isPrereleaseVersion(d.current) && r.pre && (!r.stable || compareLibVersions(r.pre, r.stable) > 0) ? r.pre : null
    const latest = pre ?? r.stable
    if (!latest) return { ...d, latest: null, latestPre: false, bump: 'none', status: 'unknown', lookup: r }
    const bump = bumpKind(d.current, latest)
    return { ...d, latest, latestPre: !!pre, bump, status: bump === 'none' ? 'current' : 'outdated', lookup: r }
  })
}

export const queriesOf = (deps: readonly Dep[]): LibQuery[] => [...new Map(deps.map((d) => [libKey(d), { eco: d.eco, name: d.name }])).values()]

/** Package page / changelog for a lookup; https only (opened through `openExternal`). */
export function libPage(eco: LibEco, name: string, registry: LibRegistry | null): string | null {
  if (!isLibName(eco, name)) return null
  if (eco === 'pub') return `https://pub.dev/packages/${name}/changelog`
  if (eco === 'npm') return `https://www.npmjs.com/package/${name}?activeTab=versions`
  const [group, artifact] = name.split(':') as [string, string]
  if (registry === 'google') return `https://maven.google.com/web/index.html#${group}:${artifact}`
  return `https://central.sonatype.com/artifact/${group}/${artifact}/versions`
}

/** Prefill (never submitted) asking the agent to upgrade the picked rows and build. */
export function upgradePrompt(file: string, rows: readonly LibRow[]): string | null {
  const picked = rows.filter((r) => r.status === 'outdated' && r.latest)
  if (!picked.length) return null
  const lines = picked.map((r) => `- ${r.plugin ? `plugin ${r.plugin}` : r.name}: ${r.spec} → ${r.latest} (${r.bump})${r.ref ? ` [version.ref "${r.ref}"]` : ''}`)
  return `Upgrade these libraries in ${file}, keeping the file's style (version catalogs: change the [versions] entry). Check each changelog for breaking changes (major bumps first), then build the project and fix any errors:\n${lines.join('\n')}`
}
