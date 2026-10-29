import { compareLibVersions, type LibEco, type LibVuln, type VulnSeverity } from '@ccm/shared'

export const OSV_BASE = 'https://api.osv.dev'

const ECOSYSTEM: Record<LibEco, string> = { maven: 'Maven', pub: 'Pub', npm: 'npm' }
export const osvEcosystem = (eco: LibEco): string => ECOSYSTEM[eco]

export const isOsvId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)

export const osvBatchUrl = (base?: string): string => `${(base ?? OSV_BASE).replace(/\/$/, '')}/v1/querybatch`
export const osvVulnUrl = (id: string, base?: string): string => `${(base ?? OSV_BASE).replace(/\/$/, '')}/v1/vulns/${encodeURIComponent(id)}`

/** `{results: [{vulns: [{id}]}]}` → ids per query, in query order; null when the shape is off. */
export function parseOsvBatch(json: string, count: number): string[][] | null {
  try {
    const doc = JSON.parse(json) as { results?: { vulns?: { id?: unknown }[] }[] }
    if (!Array.isArray(doc.results) || doc.results.length !== count) return null
    return doc.results.map((r) => (Array.isArray(r?.vulns) ? r.vulns.map((v) => v?.id).filter(isOsvId) : []))
  } catch {
    return null
  }
}

const SEVERITY: Record<string, VulnSeverity> = { critical: 'critical', high: 'high', moderate: 'moderate', medium: 'moderate', low: 'low' }

const severityWord = (v: unknown): VulnSeverity | null => (typeof v === 'string' ? (SEVERITY[v.trim().toLowerCase()] ?? null) : null)

interface OsvAffected {
  package?: { ecosystem?: unknown; name?: unknown }
  ranges?: { type?: unknown; events?: Record<string, unknown>[] }[]
  database_specific?: { severity?: unknown }
  ecosystem_specific?: { severity?: unknown }
}

interface OsvDoc {
  id?: unknown
  summary?: unknown
  details?: unknown
  aliases?: unknown
  withdrawn?: unknown
  affected?: OsvAffected[]
  database_specific?: { severity?: unknown }
}

const sameName = (eco: LibEco, a: unknown, b: string): boolean => typeof a === 'string' && (eco === 'npm' || eco === 'pub' ? a === b : a.toLowerCase() === b.toLowerCase())

/** Fix for the range the version sits in; else the lowest fixed version above it. */
function fixedFor(affected: OsvAffected[], version: string): string | null {
  let inRange: string | null = null
  let above: string | null = null
  const lower = (a: string | null, b: string): string => (!a || compareLibVersions(b, a) < 0 ? b : a)
  for (const a of affected) {
    for (const r of a.ranges ?? []) {
      if (r?.type === 'GIT') continue
      let introduced = '0'
      for (const e of r.events ?? []) {
        if (typeof e?.introduced === 'string') introduced = e.introduced
        const fixed = e?.fixed
        if (typeof fixed !== 'string' || compareLibVersions(fixed, version) <= 0) continue
        above = lower(above, fixed)
        if (introduced === '0' || compareLibVersions(version, introduced) >= 0) inRange = lower(inRange, fixed)
      }
    }
  }
  return inRange ?? above
}

/** One OSV record narrowed to the queried package; null when unreadable or withdrawn. */
export function parseOsvVuln(json: string, eco: LibEco, name: string, version: string): LibVuln | null {
  let doc: OsvDoc
  try {
    doc = JSON.parse(json) as OsvDoc
  } catch {
    return null
  }
  if (!doc || !isOsvId(doc.id) || doc.withdrawn) return null
  const affected = (Array.isArray(doc.affected) ? doc.affected : []).filter((a) => a?.package?.ecosystem === osvEcosystem(eco) && sameName(eco, a.package?.name, name))
  let severity: VulnSeverity | null = severityWord(doc.database_specific?.severity)
  for (const a of affected) severity ??= severityWord(a.database_specific?.severity) ?? severityWord(a.ecosystem_specific?.severity)
  const text = typeof doc.summary === 'string' && doc.summary.trim() ? doc.summary : typeof doc.details === 'string' ? doc.details : ''
  return {
    id: doc.id,
    aliases: (Array.isArray(doc.aliases) ? doc.aliases : []).filter(isOsvId).slice(0, 5),
    summary: text.replace(/\s+/g, ' ').trim().slice(0, 200),
    severity: severity ?? 'unknown',
    fixed: fixedFor(affected, version),
  }
}

/** Placeholder when the record itself could not be fetched: the id still counts. */
export const bareVuln = (id: string): LibVuln => ({ id, aliases: [], summary: '', severity: 'unknown', fixed: null })
