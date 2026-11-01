// Project build output cleanup (v77 R8): which folders count as rebuildable build output, and the page ↔ desktop shapes.

export type BuildKind = 'node' | 'gradle' | 'flutter' | 'rust' | 'maven' | 'python' | 'web' | 'other'
export const BUILD_KINDS: readonly BuildKind[] = ['node', 'gradle', 'flutter', 'rust', 'maven', 'python', 'web', 'other']

export const BUILD_DIR_NAMES = [
  'node_modules',
  'build',
  '.gradle',
  '.dart_tool',
  'dist',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  '__pycache__',
  '.pytest_cache',
  '.venv',
] as const

/** Levels below the project folder a build folder may sit at (`app/build` = 2). */
export const BUILD_SCAN_DEPTH = 4
export const BUILD_PROJECTS_MAX = 50
export const BUILD_ITEMS_MAX = 500

/** Deleting these means a package install, not only a build, before the project runs again. */
const REINSTALL = new Set(['node_modules', '.venv'])

const has = (siblings: ReadonlySet<string>, ...names: string[]): boolean => names.some((n) => siblings.has(n))
const GRADLE = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradlew']

/**
 * Kind of a folder named `name` whose parent holds `siblings` (lower-case names). Outside git only names whose
 * build tool is visible next to them count: `out` / `dist` / `target` / `build` are too common to take on the name alone.
 */
export function buildDirKind(name: string, siblings: ReadonlySet<string>, git: boolean): BuildKind | null {
  switch (name) {
    case 'node_modules':
      return 'node'
    case '.dart_tool':
      return 'flutter'
    case '.next':
    case '.nuxt':
    case '.turbo':
    case '.parcel-cache':
      return 'web'
    case '__pycache__':
    case '.pytest_cache':
    case '.venv':
      return 'python'
    case '.gradle':
      return git || has(siblings, ...GRADLE) ? 'gradle' : null
    case 'build':
      if (has(siblings, ...GRADLE)) return 'gradle'
      if (has(siblings, 'pubspec.yaml')) return 'flutter'
      if (has(siblings, 'package.json')) return 'web'
      return git ? 'other' : null
    case 'dist':
    case 'out':
      return has(siblings, 'package.json') ? 'web' : git ? 'other' : null
    case 'target':
      if (has(siblings, 'cargo.toml')) return 'rust'
      if (has(siblings, 'pom.xml')) return 'maven'
      return git ? 'other' : null
    default:
      return null
  }
}

export const needsReinstall = (name: string): boolean => REINSTALL.has(name)

export interface BuildDir {
  /** Relative to the project, `/`-separated. */
  rel: string
  name: string
  kind: BuildKind
  bytes: number
  files: number
  newestMs: number | null
  reinstall: boolean
}

export interface BuildProject {
  root: string
  git: boolean
  dirs: BuildDir[]
  bytes: number
  error?: 'missing' | 'refused'
}

/** Something running inside a project, as the page knows it (pane shells / agents); only ever blocks a clean. */
export interface BuildBusy {
  name: string
  cwd: string
}

export interface BuildCleanItem {
  root: string
  rel: string
}

export interface BuildCleanRequest {
  items: BuildCleanItem[]
  trash: boolean
  busy: BuildBusy[]
  /** The owner saw the running Gradle daemons and cleans anyway. */
  ignoreDaemons?: boolean
}

export interface BuildDaemon {
  pid: number
  start: string
  name: string
}

export type BuildCleanError = 'invalid' | 'busy' | 'running' | 'daemons' | 'cancelled' | 'nothing' | 'failed'

export interface BuildCleanResult {
  ok: boolean
  error?: BuildCleanError
  dirs?: number
  bytes?: number
  /** Files that could not be deleted (locked); the rest of their folder is gone. */
  failed?: number
  /** Folders gone after the clean (project root as scanned). */
  removed?: BuildCleanItem[]
  /** `running`: what runs inside the project. */
  holders?: string[]
  /** `daemons`: Gradle / Kotlin daemons that may hold build files. */
  daemons?: BuildDaemon[]
}

export interface BuildProgress {
  op: 'scan' | 'clean'
  root?: string
  dirs: number
  bytes: number
  totalBytes?: number
}

const textOk = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v)

export function parseBuildRoots(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > BUILD_PROJECTS_MAX) return null
  const out: string[] = []
  for (const r of raw) {
    if (!textOk(r, 1024)) return null
    if (!out.includes(r)) out.push(r)
  }
  return out
}

/** `rel` stays inside the project: no `..`, no absolute path, last segment a known build folder name. */
export function isBuildRel(rel: string): boolean {
  if (!textOk(rel, 1024) || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.includes('\\')) return false
  const parts = rel.split('/')
  if (parts.length > BUILD_SCAN_DEPTH || parts.some((p) => !p || p === '.' || p === '..')) return false
  return (BUILD_DIR_NAMES as readonly string[]).includes(parts.at(-1)!)
}

export function parseBuildClean(raw: unknown): BuildCleanRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.items) || !r.items.length || r.items.length > BUILD_ITEMS_MAX) return null
  const items: BuildCleanItem[] = []
  for (const it of r.items) {
    const i = it as Record<string, unknown> | null
    if (!i || !textOk(i.root, 1024) || typeof i.rel !== 'string' || !isBuildRel(i.rel)) return null
    items.push({ root: i.root, rel: i.rel })
  }
  const busy: BuildBusy[] = []
  if (r.busy !== undefined) {
    if (!Array.isArray(r.busy) || r.busy.length > 200) return null
    for (const b of r.busy) {
      const x = b as Record<string, unknown> | null
      if (!x || typeof x.name !== 'string' || !textOk(x.cwd, 1024)) return null
      busy.push({ name: x.name.replace(/[\u0000-\u001f]/g, ' ').slice(0, 120), cwd: x.cwd })
    }
  }
  return { items, trash: r.trash === true, busy, ...(r.ignoreDaemons === true ? { ignoreDaemons: true } : {}) }
}
