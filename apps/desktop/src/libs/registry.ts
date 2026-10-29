import { isLibName, type LibEco, type LibRegistry } from '@ccm/shared'

export const REGISTRY_BASE: Record<LibRegistry, string> = {
  google: 'https://dl.google.com/android/maven2',
  central: 'https://repo1.maven.org/maven2',
  pub: 'https://pub.dev/api/packages',
  npm: 'https://registry.npmjs.org',
}

/** Loopback http base for tests (`CCM_LIBS_REGISTRY`): `<base>/google`, `/central`, `/pub`, `/npm`. */
export function isAllowedOverride(base: string | undefined): base is string {
  if (!base) return false
  try {
    const u = new URL(base)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]') && !u.search && !u.hash
  } catch {
    return false
  }
}

/** Groups Google hosts on dl.google.com; anything else (and a Google miss) goes to Maven Central. */
export function registriesFor(eco: LibEco, name: string): LibRegistry[] {
  if (eco === 'pub') return ['pub']
  if (eco === 'npm') return ['npm']
  const group = name.split(':')[0]!
  return /^(androidx|android\.arch|com\.android|com\.google)(\.|$)/.test(group) ? ['google', 'central'] : ['central']
}

/** Registry URL for a validated name; null when the name is not one `isLibName` accepts. */
export function lookupUrl(registry: LibRegistry, eco: LibEco, name: string, override?: string): string | null {
  if (!isLibName(eco, name)) return null
  const base = override ? `${override.replace(/\/$/, '')}/${registry}` : REGISTRY_BASE[registry]
  if (registry === 'google' || registry === 'central') {
    const [group, artifact] = name.split(':') as [string, string]
    return `${base}/${group.replace(/\./g, '/')}/${artifact}/maven-metadata.xml`
  }
  if (registry === 'pub') return `${base}/${name}`
  return `${base}/${name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)}`
}

export function parseMavenMetadata(xml: string): string[] | null {
  if (!/<metadata[\s>]/.test(xml)) return null
  const block = /<versions>([\s\S]*?)<\/versions>/.exec(xml)?.[1] ?? ''
  const list = [...block.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)].map((m) => m[1]!)
  const release = /<release>\s*([^<\s]+)\s*<\/release>/.exec(xml)?.[1]
  if (release && !list.includes(release)) list.push(release)
  return list
}

export function parsePubVersions(json: string): string[] | null {
  try {
    const doc = JSON.parse(json) as { versions?: { version?: unknown; retracted?: unknown }[] }
    if (!Array.isArray(doc.versions)) return null
    return doc.versions.filter((v) => typeof v?.version === 'string' && v.retracted !== true).map((v) => v.version as string)
  } catch {
    return null
  }
}

/** Abbreviated npm metadata: every published version minus deprecated ones. */
export function parseNpmVersions(json: string): string[] | null {
  try {
    const doc = JSON.parse(json) as { versions?: Record<string, { deprecated?: unknown }> }
    if (!doc.versions || typeof doc.versions !== 'object') return null
    return Object.entries(doc.versions)
      .filter(([, v]) => !v?.deprecated)
      .map(([k]) => k)
  } catch {
    return null
  }
}
