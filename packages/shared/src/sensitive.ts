/** Sensitive file / command watch (v76 R5): warnings only, nothing is ever blocked. */
export const SENSITIVE_GROUPS = ['secrets', 'outside', 'git', 'delete', 'data', 'custom'] as const
export type SensitiveGroup = (typeof SENSITIVE_GROUPS)[number]

/** Default file rules (group `secrets`); the rule id is the glob itself, matched against the file name. */
export const SECRET_FILE_GLOBS = [
  '.env*',
  '*.jks',
  '*.keystore',
  '*.p12',
  '*.pem',
  'key.properties',
  'local.properties',
  'google-services.json',
  'GoogleService-Info.plist',
  '*.mobileprovision',
] as const

export const COMMAND_RULES = {
  'git-force-push': 'git',
  'git-reset-hard': 'git',
  'git-clean': 'git',
  'rm-rf': 'delete',
  'del-s': 'delete',
  'remove-item-recurse': 'delete',
  'adb-uninstall': 'data',
  'drop-table': 'data',
} as const satisfies Record<string, SensitiveGroup>
export type CommandRule = keyof typeof COMMAND_RULES

export const OUTSIDE_RULE = 'outside-project'
export const CUSTOM_PREFIX = 'custom:'

export function ruleGroup(rule: string): SensitiveGroup | null {
  if (rule === OUTSIDE_RULE) return 'outside'
  if (rule.startsWith(CUSTOM_PREFIX)) return 'custom'
  if ((SECRET_FILE_GLOBS as readonly string[]).includes(rule)) return 'secrets'
  return (COMMAND_RULES as Record<string, SensitiveGroup>)[rule] ?? null
}

export interface SensitiveSettings {
  groups: Record<SensitiveGroup, boolean>
  /** Extra file globs (`*.secret`, `config/prod/**`); a glob without `/` matches the file name. */
  globs: string[]
  /** Project folder → rule ids ignored there. */
  ignore: Record<string, string[]>
}

export const MAX_SENSITIVE_GLOBS = 50
export const MAX_IGNORE_PROJECTS = 200
const MAX_RULES_PER_PROJECT = 64
const GLOB_RE = /^[^\0\r\n]{1,200}$/

export function defaultSensitiveSettings(): SensitiveSettings {
  return { groups: { secrets: true, outside: true, git: true, delete: true, data: true, custom: true }, globs: [], ignore: {} }
}

const isRule = (v: unknown): v is string => typeof v === 'string' && v.length <= 220 && ruleGroup(v) !== null

export function sanitizeGlobs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const g of value) {
    if (typeof g !== 'string') return null
    const glob = g.trim()
    if (glob && GLOB_RE.test(glob) && !out.includes(glob)) out.push(glob)
  }
  return out.slice(0, MAX_SENSITIVE_GLOBS)
}

export function sanitizeIgnore(value: unknown): Record<string, string[]> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const out: Record<string, string[]> = {}
  for (const [dir, rules] of Object.entries(value as Record<string, unknown>).slice(0, MAX_IGNORE_PROJECTS)) {
    if (!dir || dir.length > 1024 || !Array.isArray(rules)) continue
    const list = [...new Set(rules.filter(isRule))].slice(0, MAX_RULES_PER_PROJECT)
    if (list.length) out[dir] = list
  }
  return out
}

export function sanitizeGroups(value: unknown): Partial<Record<SensitiveGroup, boolean>> | null {
  if (typeof value !== 'object' || value === null) return null
  const out: Partial<Record<SensitiveGroup, boolean>> = {}
  for (const g of SENSITIVE_GROUPS) {
    const v = (value as Record<string, unknown>)[g]
    if (typeof v === 'boolean') out[g] = v
  }
  return out
}

export function sanitizeSensitive(value: unknown): SensitiveSettings {
  const base = defaultSensitiveSettings()
  if (typeof value !== 'object' || value === null) return base
  const v = value as Record<string, unknown>
  return {
    groups: { ...base.groups, ...(sanitizeGroups(v.groups) ?? {}) },
    globs: sanitizeGlobs(v.globs) ?? [],
    ignore: sanitizeIgnore(v.ignore) ?? {},
  }
}

/** Rule id is a known rule or `custom:<glob>`; project is the session folder the client was shown. */
export function isSensitiveRule(v: unknown): v is string {
  return isRule(v)
}
