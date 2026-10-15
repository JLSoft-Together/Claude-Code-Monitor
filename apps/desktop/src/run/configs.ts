import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_RUN_TEMPLATES, RUN_SHARED_DIR, type FlutterMode, type RunConfig, type RunProject, type RunTemplates } from '@ccm/shared'
import { projectKey } from '../layouts'
import { isWithin } from '../preview/paths'

export const RUN_CONFIGS_DIR = 'run-configs'
export const MAX_ENV = 50
export const MAX_BEFORE = 10
const MAX_NAME = 80
const MAX_CMD = 500
const MAX_ARGS = 2000
const MAX_VALUE = 4096

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const FLAVOR_RE = /^[A-Za-z0-9_]{0,64}$/
const VARIANT_RE = /^[A-Za-z0-9_]{1,64}$/
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const MODULE_RE = /^(:[A-Za-z0-9_.-]+)+$/
const DEVICE_RE = /^[A-Za-z0-9_.:@%-]{1,128}$/
const MODES: readonly FlutterMode[] = ['debug', 'profile', 'release']

/** Ids of configs imported from `.run/` / `.vscode/` (repo files): they need the same trust prompt as shared ones. */
export const IMPORT_ID_PREFIX = 'imp-'

// A repo-provided config must not redirect what runs (PATH lookup, shell, JVM / Node / loader injection).
const BLOCKED_ENV = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'NODE_OPTIONS', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'GRADLE_OPTS', 'JAVA_OPTS', 'LD_PRELOAD'])
export const isBlockedSharedEnv = (key: string): boolean => {
  const k = key.toUpperCase()
  return BLOCKED_ENV.has(k) || k.startsWith('DYLD_')
}

export function dropBlockedEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !isBlockedSharedEnv(k)))
}

/** Shared (repo file) or imported: runs only after the user approved this exact content. */
export const needsTrust = (cfg: RunConfig): boolean => cfg.shared || cfg.id.startsWith(IMPORT_ID_PREFIX)

export const isRunConfigId =(v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

const text = (v: unknown, max: number): string | null => (v === undefined ? '' : typeof v === 'string' && v.length <= max ? v : null)

function cleanEntrypoint(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > 260 || path.isAbsolute(v) || /^[A-Za-z]:/.test(v)) return null
  const parts = v.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  return parts.length && !parts.includes('..') ? parts.join('/') : null
}

function cleanEnv(v: unknown): Record<string, string> | null {
  if (v === undefined) return {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const entries = Object.entries(v as Record<string, unknown>)
  if (entries.length > MAX_ENV) return null
  const env: Record<string, string> = {}
  for (const [k, val] of entries) {
    if (!ENV_KEY_RE.test(k) || typeof val !== 'string' || val.length > MAX_VALUE) return null
    env[k] = val
  }
  return env
}

function cleanBefore(v: unknown): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_BEFORE) return null
  if (!v.every((c) => typeof c === 'string' && c.length <= MAX_CMD)) return null
  return (v as string[]).map((c) => c.trim()).filter(Boolean)
}

const cleanDevice = (v: unknown): string | null => (v === undefined || v === 'selected' ? 'selected' : typeof v === 'string' && DEVICE_RE.test(v) ? v : null)

/** Strict: anything malformed → null. `cwd` must sit inside `root` (lexical, case-insensitive on win32). */
export function cleanRunConfig(raw: unknown, root: string): RunConfig | null {
  if (!raw || typeof raw !== 'object' || !path.isAbsolute(root)) return null
  const r = raw as Record<string, unknown>
  if (!isRunConfigId(r.id) || typeof r.name !== 'string') return null
  const name = r.name.trim()
  if (!name || name.length > MAX_NAME) return null
  if (typeof r.cwd !== 'string' || !path.isAbsolute(r.cwd) || r.cwd.length > MAX_VALUE) return null
  const cwd = path.resolve(r.cwd)
  if (!isWithin(root, cwd)) return null
  const env = cleanEnv(r.env)
  const beforeLaunch = cleanBefore(r.beforeLaunch)
  if (!env || !beforeLaunch) return null
  const base = { id: r.id, name, cwd, shared: r.shared === true, env, beforeLaunch }
  switch (r.type) {
    case 'flutter': {
      const entrypoint = cleanEntrypoint(r.entrypoint)
      const device = cleanDevice(r.device)
      const mode = r.mode === undefined ? 'debug' : MODES.includes(r.mode as FlutterMode) ? (r.mode as FlutterMode) : null
      const flavor = text(r.flavor, 64)
      const args = text(r.args, MAX_ARGS)
      const attachArgs = text(r.attachArgs, MAX_ARGS)
      if (!entrypoint || !device || !mode || flavor === null || !FLAVOR_RE.test(flavor) || args === null || attachArgs === null) return null
      return { ...base, type: 'flutter', entrypoint, device, mode, flavor, args, attachArgs }
    }
    case 'android': {
      const device = cleanDevice(r.device)
      const args = text(r.args, MAX_ARGS)
      const variant = r.variant === undefined ? 'debug' : r.variant
      if (typeof r.module !== 'string' || r.module.length > 200 || !MODULE_RE.test(r.module)) return null
      if (!device || args === null || typeof variant !== 'string' || !VARIANT_RE.test(variant)) return null
      return { ...base, type: 'android', module: r.module, variant, device, args }
    }
    case 'custom': {
      const command = text(r.command, MAX_ARGS)
      return command === null ? null : { ...base, type: 'custom', command }
    }
    default:
      return null
  }
}

export const newRunConfigId = (): string => randomUUID()

function writeJsonAtomic(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

const sortByName = (list: RunConfig[]): RunConfig[] => list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

/**
 * Personal configs: `<dataDir>/run-configs/<hash(projectKey(root))>.json` (array).
 * Shared: `<root>/.agent-monitor/run/<id>.json`, cwd stored relative to root so the file works on teammates' machines.
 */
export class RunConfigStore {
  constructor(private readonly dataDir: string) {}

  personalFile(root: string): string {
    const hash = createHash('sha256').update(projectKey(root)).digest('hex').slice(0, 24)
    return path.join(this.dataDir, RUN_CONFIGS_DIR, `${hash}.json`)
  }

  sharedDir(root: string): string {
    return path.join(root, ...RUN_SHARED_DIR.split('/'))
  }

  list(root: string): RunConfig[] {
    const byId = new Map<string, RunConfig>()
    for (const c of this.personal(root)) byId.set(c.id, c)
    for (const c of this.shared(root)) byId.set(c.id, c)
    return sortByName([...byId.values()])
  }

  /** Missing id → new one. Writes to the side `shared` names and drops the copy on the other side. */
  save(root: string, raw: unknown): RunConfig | null {
    const input = raw && typeof raw === 'object' && (raw as { id?: unknown }).id === undefined ? { ...raw, id: newRunConfigId() } : raw
    const clean = cleanRunConfig(input, root)
    if (!clean) return null
    const cfg = clean.shared ? { ...clean, env: dropBlockedEnv(clean.env) } : clean
    try {
      const personal = this.personal(root)
      const rest = personal.filter((c) => c.id !== cfg.id)
      if (cfg.shared) {
        writeJsonAtomic(this.sharedFile(root, cfg.id), this.toShared(root, cfg))
        if (rest.length !== personal.length) this.writePersonal(root, rest)
      } else {
        this.writePersonal(root, [...rest, cfg])
        rmSync(this.sharedFile(root, cfg.id), { force: true })
      }
      return cfg
    } catch {
      return null
    }
  }

  delete(root: string, id: string): boolean {
    if (!isRunConfigId(id)) return false
    let removed = false
    try {
      const personal = this.personal(root)
      const rest = personal.filter((c) => c.id !== id)
      if (rest.length !== personal.length) {
        this.writePersonal(root, rest)
        removed = true
      }
      const file = this.sharedFile(root, id)
      if (existsSync(file)) {
        rmSync(file, { force: true })
        removed = true
      }
    } catch {
      // read-only repo / data dir: report what got through
    }
    return removed
  }

  private sharedFile(root: string, id: string): string {
    return path.join(this.sharedDir(root), `${id}.json`)
  }

  private personal(root: string): RunConfig[] {
    const raw = readJson(this.personalFile(root))
    const out: RunConfig[] = []
    for (const item of Array.isArray(raw) ? raw : []) {
      const c = cleanRunConfig(item, root)
      if (c) out.push({ ...c, shared: false })
    }
    return out
  }

  private shared(root: string): RunConfig[] {
    let names: string[]
    try {
      names = readdirSync(this.sharedDir(root))
    } catch {
      return []
    }
    const out: RunConfig[] = []
    for (const f of names) {
      const id = f.endsWith('.json') ? f.slice(0, -5) : ''
      if (!isRunConfigId(id)) continue
      const raw = readJson(this.sharedFile(root, id))
      if (!raw || typeof raw !== 'object') continue
      const rel = (raw as { cwd?: unknown }).cwd
      const cwd = typeof rel === 'string' && !path.isAbsolute(rel) ? path.resolve(root, rel) : rel
      const c = cleanRunConfig({ ...raw, id, cwd }, root)
      if (c) out.push({ ...c, shared: true, env: dropBlockedEnv(c.env) })
    }
    return out
  }

  private toShared(root: string, cfg: RunConfig): Record<string, unknown> {
    const { id: _id, shared: _shared, ...rest } = cfg
    return { ...rest, cwd: path.relative(root, cfg.cwd).split(path.sep).join('/') || '.' }
  }

  private writePersonal(root: string, list: RunConfig[]): void {
    writeJsonAtomic(this.personalFile(root), list)
  }
}

function stableId(root: string, kind: string, dir: string, ...rest: string[]): string {
  const rel = path.relative(root, dir).split(path.sep).join('/')
  const key = [kind, process.platform === 'win32' ? rel.toLowerCase() : rel, ...rest].join('\0')
  return 'auto-' + createHash('sha256').update(key).digest('hex').slice(0, 16)
}

function pickMain(entrypoints: readonly string[]): string | undefined {
  return entrypoints.find((e) => e === 'lib/main.dart') ?? entrypoints[0]
}

/** Strict like `cleanRunConfig`: a bad field falls back to the built-in default, never throws. */
export function cleanTemplates(raw: unknown): RunTemplates {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown> | undefined>
  const f = r.flutter ?? {}
  const a = r.android ?? {}
  const d = DEFAULT_RUN_TEMPLATES
  const args = (v: unknown, def: string): string => (typeof v === 'string' && v.length <= MAX_ARGS ? v : def)
  return {
    flutter: {
      mode: MODES.includes(f.mode as FlutterMode) ? (f.mode as FlutterMode) : d.flutter.mode,
      flavor: typeof f.flavor === 'string' && FLAVOR_RE.test(f.flavor) ? f.flavor : d.flutter.flavor,
      args: args(f.args, d.flutter.args),
    },
    android: {
      variant: typeof a.variant === 'string' && VARIANT_RE.test(a.variant) ? a.variant : d.android.variant,
      args: args(a.args, d.android.args),
    },
  }
}

/**
 * One config per Flutter entrypoint (+ per flavor on the main one) and per runnable Android module. Ids are stable;
 * mode / args / variant come from the templates, the template flavor only when the project declares it.
 */
export function defaultConfigs(projects: readonly RunProject[], root: string, templates: RunTemplates = DEFAULT_RUN_TEMPLATES): RunConfig[] {
  const flutter = projects.filter((p) => p.kind === 'flutter' && p.type === 'app')
  const android = projects.filter((p) => p.kind === 'android' && p.framework !== 'flutter')
  const out: RunConfig[] = []
  const common = { shared: false, env: {}, beforeLaunch: [] as string[] }
  for (const p of flutter) {
    if (p.kind !== 'flutter') continue
    const tag = flutter.length > 1 ? path.basename(p.dir) : ''
    const label = (file: string, flavor = ''): string => {
      const extra = [tag, flavor].filter(Boolean).join(', ')
      return extra ? `${path.posix.basename(file)} (${extra})` : path.posix.basename(file)
    }
    const base = { ...common, type: 'flutter', cwd: p.dir, device: 'selected', mode: templates.flutter.mode, args: templates.flutter.args, attachArgs: '' }
    const flavor = p.flavors.includes(templates.flutter.flavor) ? templates.flutter.flavor : ''
    for (const e of p.entrypoints) out.push({ ...base, id: stableId(root, 'flutter', p.dir, e, ''), name: label(e), entrypoint: e, flavor } as RunConfig)
    const main = pickMain(p.entrypoints)
    if (main) for (const f of p.flavors) out.push({ ...base, id: stableId(root, 'flutter', p.dir, main, f), name: label(main, f), entrypoint: main, flavor: f } as RunConfig)
  }
  for (const p of android) {
    if (p.kind !== 'android') continue
    const tag = android.length > 1 ? path.basename(p.dir) : ''
    for (const m of p.modules) {
      if (m.type !== 'application' && !m.guessed) continue
      const short = m.path.replace(/^:/, '')
      out.push({
        ...common,
        type: 'android',
        id: stableId(root, 'android', p.dir, m.path),
        name: tag ? `${short} (${tag})` : short,
        cwd: p.dir,
        module: m.path,
        variant: templates.android.variant,
        device: 'selected',
        args: templates.android.args,
      })
    }
  }
  return out.map((c) => cleanRunConfig(c, root)).filter((c): c is RunConfig => c !== null)
}
