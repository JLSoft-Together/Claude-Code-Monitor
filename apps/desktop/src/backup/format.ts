import { BACKUP_SECTIONS, type BackupSectionId, type BackupSectionInfo } from '@ccm/shared'

export const BACKUP_FORMAT = 'orrery-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 24 * 1024 * 1024
const MAX_FILE_CHARS = 4 * 1024 * 1024
const MAX_LOCAL_CHARS = 2 * 1024 * 1024
const MAX_MISSING = 20
const MAX_GITHUB = 20

export interface BackupGitHub {
  login: string
  name: string | null
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  app: string
  platform: string
  createdAt: string
  local: Record<string, string>
  /** Data-dir path (forward slashes) → text. */
  files: Record<string, string>
  github: BackupGitHub[]
}

/** Data-dir files that are configuration; caches, history, timeline, logs and security grants (run-trust, preview grants) stay behind. */
const FILE_SECTION: Record<string, BackupSectionId> = {
  'aliases.json': 'names',
  'office-names.json': 'names',
  'favorites.json': 'names',
  'adb-devices.json': 'devices',
  'layouts.json': 'workspace',
  'run-settings.json': 'run',
  'run-templates.json': 'run',
  'update.json': 'updates',
}
export const BACKUP_FILES = Object.keys(FILE_SECTION)
export const NOTE_FILE = /^notes\/[0-9a-f]{40}\.md$/

export function fileSection(rel: string): BackupSectionId | null {
  if (Object.hasOwn(FILE_SECTION, rel)) return FILE_SECTION[rel]!
  return NOTE_FILE.test(rel) ? 'notes' : null
}

/** Machine-bound or one-off keys (seen markers, schedules, inbox state) and the backup's own keys. */
const LOCAL_SKIP = /^ccm\.(whatsNew\.|breakSeen|resumeSchedule|inbox$|backup\.|http\.env)/
const LOCAL_APPEARANCE = /^ccm\.(theme|locale|font\.|fileIcons|minimap|keyHints|dust|office\.(pack|style)$)/
const LOCAL_WORKSPACE = /^ccm\.(workspace\.|layout\.|panels$|bar$|panelSize$|mapLayout|mapView$|view$|sessionTab|run\.selected$|fwp\.|timelineWindow$|launchTerminal$|drawable\.|md\.|http\.open$|imageCompare\.)/
const LOCAL_NOTES = /^ccm\.(prompts$|promptQueue\.|bookmarks$|recentFiles$|recentEdits$|resumeText$|notes\.|planBoard\.)/

const SECRET_KEY = /(token|secret|passw|pwd|api[-_]?key|apikey|private[-_]?key|auth|cookie|credential|bearer)/i
const SECRET_VALUE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|\b(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-ant-[A-Za-z0-9_-]{10,}|\bsk-[A-Za-z0-9]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
export const REMOVED = '[removed]'

export function localSection(key: string): BackupSectionId | null {
  if (!key.startsWith('ccm.') || key.length > 200 || LOCAL_SKIP.test(key) || SECRET_KEY.test(key)) return null
  if (LOCAL_APPEARANCE.test(key)) return 'appearance'
  if (LOCAL_WORKSPACE.test(key)) return 'workspace'
  if (LOCAL_NOTES.test(key)) return 'notes'
  return 'settings'
}

export const scrubText = (s: string): string => s.replace(SECRET_VALUE, REMOVED)

/** Drops secret-named keys, empties `env` maps (run configs), redacts token-shaped strings. */
export function scrubJson(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return scrubText(v)
  if (depth > 40 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => scrubJson(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) {
    if (SECRET_KEY.test(k)) continue
    out[k] = k === 'env' && val !== null && typeof val === 'object' && !Array.isArray(val) ? {} : scrubJson(val, depth + 1)
  }
  return out
}

function scrubStored(value: string, json: boolean): string | null {
  if (json) {
    try {
      return JSON.stringify(scrubJson(JSON.parse(value)))
    } catch {
      return null
    }
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed !== null && typeof parsed === 'object') return JSON.stringify(scrubJson(parsed))
  } catch {
    // plain string value
  }
  return scrubText(value)
}

export function filterLocal(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || v.length > MAX_LOCAL_CHARS || !localSection(k)) continue
    const clean = scrubStored(v, false)
    if (clean !== null) out[k] = clean
  }
  return out
}

export function filterFiles(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [rel, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || v.length > MAX_FILE_CHARS || !fileSection(rel)) continue
    const clean = rel.endsWith('.json') ? scrubStored(v, true) : scrubText(v)
    if (clean !== null) out[rel] = clean
  }
  return out
}

export function filterGitHub(raw: unknown): BackupGitHub[] {
  if (!Array.isArray(raw)) return []
  const out: BackupGitHub[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const { login, name } = a as { login?: unknown; name?: unknown }
    if (typeof login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) continue
    if (out.some((x) => x.login === login)) continue
    out.push({ login, name: typeof name === 'string' ? name.slice(0, 100) : null })
    if (out.length >= MAX_GITHUB) break
  }
  return out
}

export function buildBackup(input: { app: string; platform: string; now: Date; local: unknown; files: unknown; github: unknown }): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: input.app,
    platform: input.platform,
    createdAt: input.now.toISOString(),
    local: filterLocal(input.local),
    files: filterFiles(input.files),
    github: filterGitHub(input.github),
  }
}

/** Never trusts the file: every entry goes through the same whitelist + secret filter as an export. */
export function parseBackup(text: string): BackupFile | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (b.format !== BACKUP_FORMAT || b.version !== BACKUP_VERSION) return null
  const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: str(b.app, 40),
    platform: str(b.platform, 20),
    createdAt: str(b.createdAt, 40),
    local: filterLocal(b.local),
    files: filterFiles(b.files),
    github: filterGitHub(b.github),
  }
}

const looksAbsolute = (s: string): boolean => s.length >= 4 && s.length <= 1024 && (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\\s]+\\/.test(s) || /^\/[^/\s]+\/\S*$/.test(s))

export function collectPaths(v: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (typeof v === 'string') {
    if (looksAbsolute(v)) out.add(v)
    else if ((v.startsWith('{') || v.startsWith('[')) && depth < 4 && v.length <= 1_000_000) {
      try {
        collectPaths(JSON.parse(v), out, depth + 10)
      } catch {
        // not JSON
      }
    }
    return out
  }
  if (depth > 40 || v === null || typeof v !== 'object') return out
  for (const [k, val] of Array.isArray(v) ? v.entries() : Object.entries(v)) {
    if (typeof k === 'string' && looksAbsolute(k)) out.add(k)
    collectPaths(val, out, depth + 1)
  }
  return out
}

function contentOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** One row per non-empty section; `exists` flags absolute paths missing on this machine. */
export function sectionsOf(b: BackupFile, exists?: (p: string) => boolean): BackupSectionInfo[] {
  const acc = new Map<BackupSectionId, { count: number; paths: Set<string> }>()
  const add = (id: BackupSectionId, value: unknown): void => {
    const cur = acc.get(id) ?? { count: 0, paths: new Set<string>() }
    cur.count++
    if (exists) collectPaths(value, cur.paths)
    acc.set(id, cur)
  }
  for (const [k, v] of Object.entries(b.local)) add(localSection(k)!, contentOf(v))
  for (const [rel, v] of Object.entries(b.files)) add(fileSection(rel)!, rel.endsWith('.json') ? contentOf(v) : null)
  for (const g of b.github) add('github', g.login)
  return BACKUP_SECTIONS.filter((id) => acc.has(id)).map((id) => {
    const { count, paths } = acc.get(id)!
    const missingPaths = exists ? [...paths].filter((p) => !exists(p)).slice(0, MAX_MISSING) : []
    return { id, count, missingPaths }
  })
}

export function pickSections(b: BackupFile, ids: ReadonlySet<BackupSectionId>): { local: Record<string, string>; files: Record<string, string>; github: string[] } {
  const local: Record<string, string> = {}
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(b.local)) if (ids.has(localSection(k)!)) local[k] = v
  for (const [rel, v] of Object.entries(b.files)) if (ids.has(fileSection(rel)!)) files[rel] = v
  return { local, files, github: ids.has('github') ? b.github.map((g) => g.login) : [] }
}

export const cleanSectionIds = (v: unknown): Set<BackupSectionId> | null =>
  Array.isArray(v) && v.length <= BACKUP_SECTIONS.length && v.every((x) => (BACKUP_SECTIONS as readonly unknown[]).includes(x)) ? new Set(v as BackupSectionId[]) : null

export const exportName = (d: Date): string => `orrery-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`

/** Newest `keep` files of one kind stay; returns the names to delete. */
export function pruneList(entries: { name: string; mtime: number }[], prefix: string, keep: number): string[] {
  return entries
    .filter((e) => e.name.startsWith(prefix) && e.name.endsWith('.json'))
    .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name))
    .slice(keep)
    .map((e) => e.name)
}
