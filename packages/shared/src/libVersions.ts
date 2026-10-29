/** v74 library update check: registry lookups done by the desktop main process (`ccm:libs-check`). */
export type LibEco = 'maven' | 'pub' | 'npm'
export type LibRegistry = 'google' | 'central' | 'pub' | 'npm'

export interface LibQuery {
  eco: LibEco
  /** Maven `group:artifact`, pub package, npm package (scoped allowed). */
  name: string
}

export type LibLookupError = 'invalid' | 'not-found' | 'network' | 'timeout' | 'bad-response'

export type LibLookup =
  | { eco: LibEco; name: string; ok: true; registry: LibRegistry; stable: string | null; pre: string | null; checkedAt: number }
  | { eco: LibEco; name: string; ok: false; error: LibLookupError }

export type LibCheckResult = { ok: true; results: LibLookup[] } | { ok: false; error: 'invalid' | 'too-many' | 'unavailable' }

export const LIBS_MAX = 300

const MAVEN_PART = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/
const NPM_PART = /^[a-z0-9][a-z0-9._~-]*$/

/** Names safe to put in a registry URL path. */
export function isLibName(eco: unknown, name: unknown): boolean {
  if (typeof name !== 'string' || name.length > 214) return false
  if (eco === 'maven') {
    const parts = name.split(':')
    return parts.length === 2 && parts.every((p) => MAVEN_PART.test(p) && !p.includes('..'))
  }
  if (eco === 'pub') return /^[a-z][a-z0-9_]{0,63}$/.test(name)
  if (eco === 'npm') {
    const m = /^(?:@([^/]+)\/)?([^/]+)$/.exec(name)
    return !!m && (m[1] === undefined || NPM_PART.test(m[1])) && NPM_PART.test(m[2]!)
  }
  return false
}

export interface LibVersion {
  nums: number[]
  /** Qualifier after the numbers (`alpha01`, `rc.1`, `jre`, `Final`), lower-cased, '' when none. */
  qual: string
  pre: boolean
}

const PRE_QUAL = /(?:^|[^a-z])(alpha|beta|rc|cr|snapshot|dev|eap|preview|pre|milestone|m\d+|ea|canary|next|nightly|experimental|a\d|b\d)/

export function parseLibVersion(v: string): LibVersion | null {
  const m = /^v?(\d+(?:\.\d+)*)(?:[-.+_]?(.*))?$/i.exec(v.trim())
  if (!m) return null
  const qual = (m[2] ?? '').toLowerCase().replace(/\+.*$/, '')
  return { nums: m[1]!.split('.').map(Number), qual, pre: PRE_QUAL.test(qual) }
}

export const isPrereleaseVersion = (v: string): boolean => parseLibVersion(v)?.pre ?? false

const RANK: Record<string, number> = { dev: 0, snapshot: 0, nightly: 0, canary: 0, experimental: 0, eap: 1, ea: 1, preview: 1, pre: 1, alpha: 1, a: 1, beta: 2, b: 2, milestone: 2, m: 2, next: 2, rc: 3, cr: 3 }

function compareQual(a: string, b: string): number {
  const ta = a.match(/\d+|[a-z]+/g) ?? []
  const tb = b.match(/\d+|[a-z]+/g) ?? []
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i]
    const y = tb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d/.test(x)
    const ny = /^\d/.test(y)
    if (nx && ny) {
      const d = Number(x) - Number(y)
      if (d) return Math.sign(d)
    } else if (!nx && !ny) {
      const d = (RANK[x] ?? 5) - (RANK[y] ?? 5)
      if (d) return Math.sign(d)
      if (x !== y) return x < y ? -1 : 1
    } else return nx ? 1 : -1
  }
  return 0
}

/** Sort order: numbers first, then a prerelease before its release; unparsable versions sort lowest. */
export function compareLibVersions(a: string, b: string): number {
  const x = parseLibVersion(a)
  const y = parseLibVersion(b)
  if (!x || !y) return x ? 1 : y ? -1 : 0
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (x.pre !== y.pre) return x.pre ? -1 : 1
  return compareQual(x.qual, y.qual)
}

/** Highest stable version, and the highest prerelease when it is newer than that. */
export function pickLatest(versions: readonly string[]): { stable: string | null; pre: string | null } {
  let stable: string | null = null
  let pre: string | null = null
  for (const v of versions) {
    const p = parseLibVersion(v)
    if (!p) continue
    if (p.pre) {
      if (!pre || compareLibVersions(v, pre) > 0) pre = v
    } else if (!stable || compareLibVersions(v, stable) > 0) stable = v
  }
  if (pre && stable && compareLibVersions(pre, stable) <= 0) pre = null
  return { stable, pre }
}

export type BumpKind = 'major' | 'minor' | 'patch' | 'none'

/** How far `latest` is from `current` ('none' = not newer). */
export function bumpKind(current: string, latest: string): BumpKind {
  if (compareLibVersions(latest, current) <= 0) return 'none'
  const a = parseLibVersion(current)
  const b = parseLibVersion(latest)
  if (!a || !b) return 'major'
  if ((b.nums[0] ?? 0) !== (a.nums[0] ?? 0)) return 'major'
  if ((b.nums[1] ?? 0) !== (a.nums[1] ?? 0)) return 'minor'
  return 'patch'
}
