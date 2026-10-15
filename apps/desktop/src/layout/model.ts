import type { ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { AndroidEnv, AndroidModule, AndroidProject, RunConfig, RunDevice } from '@ccm/shared'
import { isWithin, rootKey } from '../preview/paths'
import { analyzeGradleRoot, stripComments } from '../run/android/detect'
import { androidEnv, gradlewSpawn, type AndroidEnvOpts } from '../run/android/env'
import { lineSplitter } from '../run/parse'
import type { Spawner } from '../run/proc'
import { parseProjectModel, projectModelArgs, type ParsedProjectModel, type ProjectLoadPayload } from './projectModel'
import type { LayoutEvent, LayoutModelInfo, ModelState, ModelTarget } from './types'

export interface ModelDaemon {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  requestRestart(): void
}

export interface ModelServiceDeps {
  /** `<dataDir>/layoutlib/models`: Gradle output, one `<hash>.json` per (root, module). */
  modelsDir: string
  /** Absolute `ccm-project-model.gradle`. */
  initScript: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  home: string
  getSettings: () => { androidSdk: string | null; jdk: string | null }
  spawn: Spawner
  kill: (child: ChildProcess, sync?: boolean) => void
  daemon: ModelDaemon
  broadcast: (event: LayoutEvent) => void
  log: (level: string, message: string) => void
  /** Recursive watch of the module res dirs; returns the disposer. */
  watchDirs: (dirs: string[], onChange: (files: string[]) => void) => () => void
  /** After-build refresh only when the preview is set up (jar + layoutlib). */
  canRun: () => boolean
  /** Bundled loose kit (ConstraintLayout / AppCompat / Material) for layouts without a usable model; null = none. */
  looseKit?: () => Promise<ProjectLoadPayload | null>
  timeoutMs?: number
  debounceMs?: number
  genDebounceMs?: number
  loadTimeoutMs?: number
  androidEnv?: (root: string, opts: AndroidEnvOpts) => Promise<AndroidEnv>
  exists?: (p: string) => boolean
  now?: () => number
}

interface Entry {
  key: string
  target: ModelTarget
  name: string
  hash: string
  state: ModelState
  model: ParsedProjectModel | null
  at: number
  variant: string
  /** Last `project/load` failed: framework-only until the next refresh. */
  broken: boolean
  /** Refreshed while another project was active: the daemon's cached copy holds old classes. */
  classesChanged: boolean
  diskChecked: boolean
  /** When a watched .kt / .java changed after the model was built; 0 = none. */
  codeChangedAt: number
}

type Resolved = { target: ModelTarget; name: string; library?: LibraryLink } | { reason: 'no-gradle' | 'no-app' }

const PREFS_FILE = 'preferred-apps.json'

const REFRESH_TIMEOUT_MS = 5 * 60_000
const RES_DEBOUNCE_MS = 300
const GEN_DEBOUNCE_MS = 1500
const LOAD_TIMEOUT_MS = 120_000
const RESOLVE_TTL_MS = 10_000
const MAX_UP = 16
const MAX_THEMES = 20
const MAX_CODE_DIRS = 50
const CODE_RE = /\.(kt|java)$/i
const KIT_KEY = 'loose-kit'
const BLOCKING = new Set(['sdk-missing', 'jdk-missing', 'jdk-old', 'gradlew-missing', 'gradlew-not-executable'])

const isApp = (m: AndroidModule): boolean => m.type === 'application' || m.guessed

/** `:core:ui-kit` → `projects.core.uiKit` (Gradle type-safe project accessor). */
function accessorOf(modulePath: string): string {
  const camel = (s: string): string => s.replace(/[-_]+([A-Za-z0-9])/g, (_x, c: string) => c.toUpperCase())
  return `projects.${modulePath.replace(/^:/, '').split(':').map(camel).join('.')}`
}

function depMatcher(libPath: string): (strippedScript: string) => boolean {
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const byPath = new RegExp(`project\\s*\\(\\s*(?:path\\s*[:=]\\s*)?["']${esc(libPath)}["']`)
  const byAccessor = new RegExp(`\\b${esc(accessorOf(libPath))}\\b(?!\\.)`)
  return (text) => byPath.test(text) || byAccessor.test(text)
}

/** True when the app's build script names the library: `project(":lib")` or the type-safe accessor. */
export function dependsOn(buildScript: string, libPath: string): boolean {
  return depMatcher(libPath)(stripComments(buildScript))
}

/** Module → project modules its build script names (direct edges only). */
async function scriptGraph(project: AndroidProject): Promise<Map<string, string[]>> {
  const matchers = project.modules.map((m) => ({ path: m.path, test: depMatcher(m.path) }))
  const graph = new Map<string, string[]>()
  await Promise.all(
    project.modules.map(async (m) => {
      let text: string | null = null
      for (const name of ['build.gradle.kts', 'build.gradle']) {
        text = await fs.readFile(path.join(m.dir, name), 'utf8').catch(() => null)
        if (text !== null) break
      }
      const stripped = text === null ? '' : stripComments(text)
      graph.set(m.path, stripped ? matchers.filter((o) => o.path !== m.path && o.test(stripped)).map((o) => o.path) : [])
    }),
  )
  return graph
}

function reaches(graph: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set([from])
  const queue = [from]
  while (queue.length) {
    for (const next of graph.get(queue.shift()!) ?? []) {
      if (next === to) return true
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/** A library layout renders with an app's model: `candidates` are the apps that depend on it (sorted). */
export interface LibraryLink {
  module: string
  candidates: string[]
  /** False: no app depends on the library, the model is borrowed from an unrelated app. */
  linked: boolean
}

export interface ModulePick {
  module: string
  library?: LibraryLink
}

export interface PickOpts {
  platform?: NodeJS.Platform
  /** App last used for preview / run in this Gradle root. */
  preferred?: string | null
  /** Project deps from the app's cached Gradle model (catches deps a convention plugin adds). */
  modelDeps?: (app: string) => Promise<readonly string[] | null>
}

/**
 * Module whose model serves a layout: its own module when that is an app (the init script only runs on app modules);
 * for a library, an app depending on it directly or transitively (preferred one, else the first by path), else the
 * preferred / first app of the Gradle root.
 */
export async function pickModule(project: AndroidProject, file: string, opts: PickOpts = {}): Promise<ModulePick | null> {
  const platform = opts.platform ?? process.platform
  let owner: AndroidModule | null = null
  for (const m of project.modules) if (isWithin(m.dir, file, platform) && (!owner || m.dir.length > owner.dir.length)) owner = m
  const apps = project.modules.filter(isApp)
  if (owner && isApp(owner)) return { module: owner.path }
  if (!apps.length) return null
  const preferredApp = apps.find((a) => a.path === opts.preferred)?.path
  if (!owner) return { module: preferredApp ?? apps[0]!.path }
  const lib = owner.path
  const graph = await scriptGraph(project)
  const candidates: string[] = []
  for (const app of apps) {
    const deps = (await opts.modelDeps?.(app.path).catch(() => null)) ?? []
    if (deps.includes(lib) || reaches(graph, app.path, lib)) candidates.push(app.path)
  }
  candidates.sort()
  if (!candidates.length) return { module: preferredApp ?? apps[0]!.path, library: { module: lib, candidates, linked: false } }
  const module = candidates.includes(opts.preferred ?? '') ? opts.preferred! : candidates[0]!
  return { module, library: { module: lib, candidates, linked: true } }
}

export async function findGradleRoot(file: string): Promise<string | null> {
  let dir = path.dirname(file)
  for (let i = 0; i < MAX_UP; i++) {
    for (const name of ['settings.gradle.kts', 'settings.gradle']) if ((await fs.stat(path.join(dir, name)).catch(() => null))?.isFile()) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/**
 * Gradle target whose build outputs a run just refreshed: the Android config itself, or for Flutter on an Android
 * device the host project `<cwd>/android` (`:app`, variant = flavor + mode like `flutter build`).
 */
export function afterRunTarget(
  cfg: RunConfig,
  device: RunDevice | null,
  exists: (p: string) => boolean = existsSync,
): { root: string; module: string; variant: string } | null {
  if (cfg.type === 'android') return { root: cfg.cwd, module: cfg.module, variant: cfg.variant }
  if (cfg.type !== 'flutter' || !device?.platform.startsWith('android')) return null
  const root = path.join(cfg.cwd, 'android')
  if (!['settings.gradle.kts', 'settings.gradle'].some((n) => exists(path.join(root, n)))) return null
  const mode = cfg.mode.charAt(0).toUpperCase() + cfg.mode.slice(1)
  const variant = cfg.flavor ? `${cfg.flavor}${mode}` : cfg.mode
  return /^[A-Za-z][A-Za-z0-9]*$/.test(variant) ? { root, module: ':app', variant } : null
}

/** Only `build` segments below the Gradle root count: the project itself may live under a folder named build. */
const buildIndex = (root: string, dir: string): number => path.relative(root, dir).split(/[\\/]/).indexOf('build')

const isGenerated = (root: string, dir: string): boolean => isWithin(root, dir) && buildIndex(root, dir) >= 0

/** `<module>/build/generated/res/resValues/debug` → `<module>`. */
function moduleDirOf(root: string, dir: string): string {
  const parts = path.relative(root, dir).split(/[\\/]/)
  return path.join(root, ...parts.slice(0, buildIndex(root, dir)))
}

const samePayload = (a: ParsedProjectModel, b: ParsedProjectModel): boolean => JSON.stringify(a.payload) === JSON.stringify(b.payload)

/**
 * Source roots whose .kt / .java feed the model's classes: modules with class output under the Gradle root
 * (`<module>/build/...`) plus the modules owning the source res dirs (Flutter moves build/ out of android/).
 */
export function codeDirs(root: string, payload: { resDirs: string[]; classpath: string[] }, platform: NodeJS.Platform, exists: (p: string) => boolean): string[] {
  const out = new Set<string>()
  for (const p of payload.classpath) if (isGenerated(root, p)) out.add(path.join(moduleDirOf(root, p), 'src'))
  for (const d of payload.resDirs) {
    if (!isWithin(root, d, platform) || isGenerated(root, d)) continue
    const parts = path.relative(root, d).split(/[\\/]/)
    const i = parts.indexOf('src')
    if (i >= 0) out.add(path.join(root, ...parts.slice(0, i + 1)))
  }
  return [...out].filter((d) => exists(d)).slice(0, MAX_CODE_DIRS)
}

function themesOf(model: ParsedProjectModel | null): string[] {
  if (!model) return []
  const out = new Set<string>()
  if (model.payload.appTheme) out.add(model.payload.appTheme)
  for (const t of Object.values(model.payload.activityThemes)) out.add(t)
  return [...out].slice(0, MAX_THEMES)
}

/**
 * Project model for the layout daemon: Gradle init script only on demand (after an Android build in the Run pane or
 * the Refresh button, never on open), result cached on disk per (root, module), (re)loaded into the daemon lazily
 * before a render and again after a daemon restart.
 */
export class LayoutModelService {
  private readonly entries = new Map<string, Entry>()
  private readonly refreshing = new Map<string, Promise<void>>()
  private readonly resolved = new Map<string, { at: number; value: Resolved }>()
  private readonly children = new Set<ChildProcess>()
  private loadedKey: string | null = null
  private version = 0
  private wanted: Entry | null = null
  /** Kit load failed in this daemon process: framework-only until the daemon restarts. */
  private kitFailed = false
  private chain: Promise<unknown> = Promise.resolve()
  private unwatch: (() => void) | null = null
  private watchedKey: string | null = null
  private resPending = new Set<string>()
  private resTimer: ReturnType<typeof setTimeout> | null = null
  private resSlow = false
  private prefsLoad: Promise<Map<string, string>> | null = null

  constructor(private readonly deps: ModelServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => undefined)
    return next
  }

  private keyOf(t: ModelTarget): string {
    return `${rootKey(t.root, this.deps.platform)}\u0000${t.module}`
  }

  async resolve(file: string): Promise<Resolved> {
    const dirKey = rootKey(path.dirname(file), this.deps.platform)
    const hit = this.resolved.get(dirKey)
    if (hit && this.now() - hit.at < RESOLVE_TTL_MS) return hit.value
    let value: Resolved
    const root = await findGradleRoot(file)
    const project = root ? await analyzeGradleRoot(root).catch(() => null) : null
    if (!root || !project) value = { reason: 'no-gradle' }
    else {
      const pick = await pickModule(project, file, {
        platform: this.deps.platform,
        preferred: (await this.prefs()).get(rootKey(root, this.deps.platform)) ?? null,
        modelDeps: async (app) => {
          const e = this.entry({ root, module: app })
          await this.loadDisk(e)
          return e.model?.projectDeps ?? null
        },
      })
      value = pick ? { target: { root, module: pick.module }, name: project.name, ...(pick.library ? { library: pick.library } : {}) } : { reason: 'no-app' }
    }
    this.resolved.set(dirKey, { at: this.now(), value })
    return value
  }

  /** Last app used for preview / run per Gradle root; persisted so a library layout reopens with the same app. */
  private prefs(): Promise<Map<string, string>> {
    this.prefsLoad ??= fs
      .readFile(path.join(this.deps.modelsDir, PREFS_FILE), 'utf8')
      .then((text) => {
        const raw = JSON.parse(text) as unknown
        const out = new Map<string, string>()
        if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out.set(k, v)
        return out
      })
      .catch(() => new Map<string, string>())
    return this.prefsLoad
  }

  private async prefer(root: string, module: string): Promise<void> {
    const prefs = await this.prefs()
    const key = rootKey(root, this.deps.platform)
    this.resolved.clear()
    if (prefs.get(key) === module) return
    prefs.set(key, module)
    await fs.mkdir(this.deps.modelsDir, { recursive: true })
    await fs.writeFile(path.join(this.deps.modelsDir, PREFS_FILE), JSON.stringify(Object.fromEntries(prefs)))
  }

  /** Model chip picker: render a library layout with another app that depends on it. */
  async pickApp(file: string, module: string): Promise<LayoutModelInfo> {
    const r = await this.resolve(file)
    if ('target' in r && r.library?.candidates.includes(module)) {
      await this.prefer(r.target.root, module).catch((err: unknown) => this.deps.log('warn', `preferred app: ${msg(err)}`))
    }
    return this.info(file)
  }

  private entry(target: ModelTarget, name?: string): Entry {
    const key = this.keyOf(target)
    let e = this.entries.get(key)
    if (e && name) e.name = name
    if (!e) {
      const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
      e = { key, target, name: name ?? path.basename(target.root), hash, state: { state: 'none' }, model: null, at: 0, variant: 'debug', broken: false, classesChanged: false, diskChecked: false, codeChangedAt: 0 }
      this.entries.set(key, e)
    }
    return e
  }

  private cacheFile(e: Entry): string {
    return path.join(this.deps.modelsDir, `${e.hash}.json`)
  }

  private ready(e: Entry): ModelState {
    const p = e.model!.payload
    return { state: 'ready', at: e.at, resCount: p.resDirs.length + p.aarResDirs.length, classpathCount: p.classpath.length, warnings: e.model!.warnings.length }
  }

  private setState(e: Entry, state: ModelState): void {
    e.state = state
    this.deps.broadcast({ type: 'model', root: e.target.root, module: e.target.module, state })
  }

  /** Last Gradle output from a previous session: loaded without running Gradle again. */
  private async loadDisk(e: Entry): Promise<void> {
    if (e.diskChecked) return
    e.diskChecked = true
    if (e.model) return
    const file = this.cacheFile(e)
    const [text, stat] = await Promise.all([fs.readFile(file, 'utf8').catch(() => null), fs.stat(file).catch(() => null)])
    if (text === null || e.model) return
    try {
      e.model = parseProjectModel(text, { exists: this.deps.exists })
      e.variant = e.model.variant
      e.at = stat?.mtimeMs ?? this.now()
      if (e.state.state === 'none') e.state = this.ready(e)
    } catch (err) {
      this.deps.log('warn', `project model cache unreadable: ${msg(err)}`)
    }
  }

  private async entryFor(file: string): Promise<Entry | null> {
    const r = await this.resolve(file)
    if (!('target' in r)) return null
    const e = this.entry(r.target, r.name)
    await this.loadDisk(e)
    return e
  }

  async info(file: string): Promise<LayoutModelInfo> {
    const r = await this.resolve(file).catch((): Resolved => ({ reason: 'no-gradle' }))
    if (!('target' in r)) return { target: null, reason: r.reason, state: { state: 'none' }, hasModel: false, themes: [] }
    const e = this.entry(r.target, r.name)
    await this.loadDisk(e)
    return { target: { ...e.target, name: e.name }, ...(r.library ? { library: r.library } : {}), state: e.state, hasModel: !!e.model && !e.broken, themes: themesOf(e.model), codeChanged: !!e.model && e.codeChangedAt > 0 }
  }

  /** Before each render: pending res changes flushed, the right project (or none) loaded. `key` changes with the model. */
  async prepare(file: string): Promise<{ key: string; frameworkOnly: boolean; builtinLibs: boolean }> {
    const e = await this.entryFor(file).catch(() => null)
    this.wanted = e
    await this.flushRes(false)
    await this.serial(() => this.ensureLoaded(e)).catch((err: unknown) => this.deps.log('error', `project load: ${msg(err)}`))
    if (!this.loadedKey) return { key: 'framework', frameworkOnly: true, builtinLibs: false }
    const kit = this.loadedKey === KIT_KEY
    return { key: `${this.loadedKey}#${this.version}`, frameworkOnly: kit, builtinLibs: kit }
  }

  private async ensureLoaded(e: Entry | null): Promise<void> {
    if (e?.model && !e.broken) {
      if (this.loadedKey !== e.key) await this.load(e)
      return
    }
    const kit = this.kitFailed ? null : await this.deps.looseKit?.().catch(() => null)
    if (kit) {
      if (this.loadedKey !== KIT_KEY) await this.loadKit(kit)
      return
    }
    if (this.loadedKey === null) return
    this.loadedKey = null
    this.version++
    this.stopWatch()
    await this.deps.daemon.request('project/load', {}, this.deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS)
  }

  /** Not a project model: the result stays `frameworkOnly` (no project res / classes), only library views resolve. */
  private async loadKit(kit: ProjectLoadPayload): Promise<void> {
    this.stopWatch()
    this.loadedKey = null
    let res: Record<string, unknown>
    this.deps.broadcast({ type: 'loading', kind: 'kit', active: true })
    try {
      res = ((await this.deps.daemon.request('project/load', { ...kit, projectId: KIT_KEY }, this.deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS)) ?? {}) as Record<string, unknown>
    } catch (err) {
      this.kitFailed = true
      this.version++
      throw err
    } finally {
      this.deps.broadcast({ type: 'loading', kind: 'kit', active: false })
    }
    this.loadedKey = KIT_KEY
    this.version++
    this.deps.log('info', `project/load loose kit${res.reused === true ? ' (warm)' : ''}: ${String(res.resCount ?? '?')} res, ${String(res.loadMs ?? '?')} ms`)
    for (const w of Array.isArray(res.warnings) ? res.warnings.slice(0, 20) : []) this.deps.log('warn', String(w).slice(0, 500))
    if (res.restartSuggested === true) this.deps.daemon.requestRestart()
  }

  private async load(e: Entry): Promise<void> {
    let res: Record<string, unknown>
    try {
      // projectId: the daemon keeps a few projects warm, so switching back skips the AAR / classpath load.
      const params = { ...e.model!.payload, projectId: e.hash, classesChanged: e.classesChanged }
      this.deps.broadcast({ type: 'loading', kind: 'project', active: true })
      res = ((await this.deps.daemon.request('project/load', params, this.deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS)) ?? {}) as Record<string, unknown>
    } catch (err) {
      this.loadedKey = null
      e.broken = true
      this.setState(e, { state: 'error', code: 'load-failed', detail: msg(err).slice(0, 600), at: this.now() })
      throw err
    } finally {
      this.deps.broadcast({ type: 'loading', kind: 'project', active: false })
    }
    this.loadedKey = e.key
    e.classesChanged = false
    this.version++
    this.deps.log('info', `project/load ${e.target.module}${res.reused === true ? ' (warm)' : ''}: ${String(res.resCount ?? '?')} res, ${String(res.classpathCount ?? '?')} classpath, ${String(res.loadMs ?? '?')} ms`)
    for (const w of Array.isArray(res.warnings) ? res.warnings.slice(0, 20) : []) this.deps.log('warn', String(w).slice(0, 500))
    // A refresh may change resDirs while the same project stays loaded.
    this.stopWatch()
    this.watch(e)
    if (res.restartSuggested === true) this.deps.daemon.requestRestart()
  }

  private async changed(kind: 'res' | 'classes', files: string[]): Promise<void> {
    try {
      const res = ((await this.deps.daemon.request('project/changed', { kind, files }, this.deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS)) ?? {}) as Record<string, unknown>
      this.version++
      if (res.restartSuggested === true) this.deps.daemon.requestRestart()
    } catch (err) {
      // Unknown daemon state: the next prepare() does a full project/load.
      this.loadedKey = null
      this.version++
      throw err
    }
  }

  private watch(e: Entry): void {
    if (this.watchedKey === e.key) return
    this.stopWatch()
    const { platform } = this.deps
    const dirs = e.model!.payload.resDirs
    const { root } = e.target
    const generated = dirs.filter((d) => isGenerated(root, d))
    const sources = dirs.filter((d) => !isGenerated(root, d))
    const offs: (() => void)[] = []
    if (sources.length) offs.push(this.deps.watchDirs(sources, (files) => this.onRes(e.key, files, false)))
    if (generated.length) {
      // `clean` deletes build/ (a watch on it dies with it), so watch the module dir and keep generated res files only.
      const modules = [...new Set(generated.map((d) => moduleDirOf(root, d)))]
      offs.push(
        this.deps.watchDirs(modules, (files) => {
          const hits = files.filter((f) => generated.some((g) => isWithin(g, f, platform)))
          if (hits.length) this.onRes(e.key, hits, true)
        }),
      )
    }
    const code = codeDirs(root, e.model!.payload, this.deps.platform, this.deps.exists ?? existsSync)
    if (code.length) offs.push(this.deps.watchDirs(code, (files) => this.onCode(e.key, files)))
    if (!offs.length) return
    this.watchedKey = e.key
    this.unwatch = () => offs.forEach((off) => off())
  }

  private stopWatch(): void {
    this.unwatch?.()
    this.unwatch = null
    this.watchedKey = null
    this.resPending.clear()
    this.resSlow = false
    if (this.resTimer) clearTimeout(this.resTimer)
    this.resTimer = null
  }

  /** Generated res is rewritten in bursts during a build: wait for it to settle. */
  private onRes(key: string, files: string[], generated: boolean): void {
    if (this.loadedKey !== key) return
    for (const f of files) this.resPending.add(f)
    this.resSlow ||= generated
    if (this.resTimer) clearTimeout(this.resTimer)
    const wait = this.resSlow ? (this.deps.genDebounceMs ?? GEN_DEBOUNCE_MS) : (this.deps.debounceMs ?? RES_DEBOUNCE_MS)
    this.resTimer = setTimeout(() => void this.flushRes(true), wait)
  }

  private async flushRes(fromTimer: boolean): Promise<void> {
    if (this.resTimer) clearTimeout(this.resTimer)
    this.resTimer = null
    this.resSlow = false
    if (!this.resPending.size) return
    const files = [...this.resPending].slice(0, 50)
    this.resPending.clear()
    const key = this.loadedKey
    if (!key) return
    try {
      await this.serial(async () => {
        if (this.loadedKey === key) await this.changed('res', files)
      })
    } catch (err) {
      this.deps.log('error', `project/changed res: ${msg(err)}`)
    }
    const e = this.entries.get(key)
    if (fromTimer && e) this.deps.broadcast({ type: 'project-changed', root: e.target.root, module: e.target.module })
  }

  /** Only while the project is loaded in the daemon, i.e. a preview rendered it in the last idle window. */
  private onCode(key: string, files: string[]): void {
    const e = this.entries.get(key)
    if (!e || this.loadedKey !== key || e.codeChangedAt || !files.some((f) => CODE_RE.test(f))) return
    e.codeChangedAt = this.now()
    this.deps.broadcast({ type: 'code-changed', root: e.target.root, module: e.target.module })
  }

  /** Daemon lifecycle: any (re)start drops the project; once ready, the wanted one is loaded again from the cache. */
  onDaemonState(state: string): void {
    if (state !== 'ready') {
      this.loadedKey = null
      this.kitFailed = false
      // Idle shutdown = no preview rendered for a while: stop watching until the next load.
      this.stopWatch()
      return
    }
    const e = this.wanted
    if (e?.model && !e.broken && this.loadedKey === null) {
      void this.serial(() => this.ensureLoaded(e)).catch((err: unknown) => this.deps.log('error', `project reload: ${msg(err)}`))
    }
  }

  async refreshFile(file: string): Promise<LayoutModelInfo> {
    const r = await this.resolve(file)
    if ('target' in r) await this.refresh(r.target)
    return this.info(file)
  }

  /** Run pane: an Android (or Flutter-on-Android) session reached `running`, so the build outputs the init script reads are fresh. */
  afterBuild(root: string, module: string, variant: string): void {
    void this.prefer(root, module).catch((err: unknown) => this.deps.log('warn', `preferred app: ${msg(err)}`))
    if (!this.deps.canRun()) return
    void this.refresh({ root, module }, variant)
  }

  /** One Gradle run per root at a time; a second call joins it. */
  refresh(target: ModelTarget, variant?: string): Promise<ModelState> {
    const e = this.entry(target)
    const rk = rootKey(target.root, this.deps.platform)
    let job = this.refreshing.get(rk)
    if (!job) {
      job = this.runRefresh(e, variant).finally(() => this.refreshing.delete(rk))
      this.refreshing.set(rk, job)
    }
    return job.then(() => e.state)
  }

  private async runRefresh(e: Entry, variant?: string): Promise<void> {
    await this.loadDisk(e)
    const fail = (code: string, detail?: string): void => this.setState(e, { state: 'error', code, ...(detail ? { detail: detail.slice(-600) } : {}), at: this.now() })
    this.setState(e, { state: 'running', since: this.now() })
    const { root, module } = e.target
    const { platform, env, home } = this.deps
    try {
      const settings = this.deps.getSettings()
      const aenv = await (this.deps.androidEnv ?? androidEnv)(root, { sdkSetting: settings.androidSdk, jdkSetting: settings.jdk, env, platform, home, trusted: true })
      const issue = aenv.issues.find((i) => BLOCKING.has(i.code))
      if (issue) return fail(issue.code, issue.detail)
      await fs.mkdir(this.deps.modelsDir, { recursive: true })
      const out = path.join(this.deps.modelsDir, `${e.hash}.next.json`)
      await fs.rm(out, { force: true })
      const args = projectModelArgs(module, out, this.deps.initScript, variant ?? e.variant)
      const spec = gradlewSpawn(root, args, platform, env)
      const gradleEnv: Record<string, string> = { ...(aenv.jdk ? { JAVA_HOME: aenv.jdk } : {}), ...(aenv.sdk ? { ANDROID_HOME: aenv.sdk } : {}) }
      if (aenv.jdkNote) this.deps.log('info', `project model: ${aenv.jdkNote}`)
      this.deps.log('info', `project model: gradlew ${args.join(' ')} (in ${root})`)
      const started = this.now()
      const run = await this.runGradle(spec.file, spec.args, spec.verbatim, root, gradleEnv)
      if (run.timedOut) return fail('timeout')
      const incompatible = aenv.issues.find((i) => i.code === 'jdk-incompatible')
      if (run.code !== 0) return incompatible ? fail(incompatible.code, incompatible.detail) : fail('gradle-failed', run.tail)
      const text = await fs.readFile(out, 'utf8').catch(() => null)
      if (text === null) return fail('no-output')
      let parsed: ParsedProjectModel
      try {
        parsed = parseProjectModel(text, { exists: this.deps.exists ?? existsSync })
      } catch (err) {
        return fail('bad-model', msg(err))
      }
      await fs.rename(out, this.cacheFile(e))
      this.deps.log('info', `project model ${module} ready in ${this.now() - started} ms (${parsed.warnings.length} warnings)`)
      for (const w of parsed.warnings.slice(0, 20)) this.deps.log('warn', w.slice(0, 500))
      const prev = e.model
      e.model = parsed
      e.variant = parsed.variant
      e.at = this.now()
      e.broken = false
      if (e.codeChangedAt < started) e.codeChangedAt = 0
      // New projectDeps may change which app a library layout borrows.
      this.resolved.clear()
      this.setState(e, this.ready(e))
      await this.serial(async () => {
        if (this.loadedKey !== e.key) {
          e.classesChanged = true
          return
        }
        if (prev && samePayload(prev, parsed)) {
          // Same dirs, new contents: the build may have rewritten generated res (resValues) as well as classes.
          await this.changed('res', [])
          await this.changed('classes', [])
        } else await this.load(e)
      }).catch((err: unknown) => this.deps.log('error', `project reload after refresh: ${msg(err)}`))
      this.deps.broadcast({ type: 'project-changed', root, module })
    } catch (err) {
      fail('failed', msg(err))
    }
  }

  private runGradle(file: string, args: string[], verbatim: boolean, cwd: string, env: Record<string, string>): Promise<{ code: number | null; tail: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = this.deps.spawn({ file, args, cwd, env, verbatim })
      } catch (err) {
        resolve({ code: null, tail: msg(err), timedOut: false })
        return
      }
      this.children.add(child)
      let tail = ''
      let timedOut = false
      let settled = false
      const onLine = (text: string): void => {
        if (!text.trim()) return
        tail = `${tail}${text}\n`.slice(-2000)
        this.deps.log('gradle', text.slice(0, 2000))
      }
      const out = lineSplitter(onLine)
      const err = lineSplitter(onLine)
      child.stdout?.on('data', out.push)
      child.stderr?.on('data', err.push)
      const finish = (code: number | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        out.flush()
        err.flush()
        this.children.delete(child)
        resolve({ code, tail, timedOut })
      }
      const timer = setTimeout(() => {
        timedOut = true
        this.deps.log('error', `project model: Gradle exceeded ${(this.deps.timeoutMs ?? REFRESH_TIMEOUT_MS) / 1000} s, killed`)
        this.deps.kill(child)
        finish(null)
      }, this.deps.timeoutMs ?? REFRESH_TIMEOUT_MS)
      child.once('error', (e) => {
        tail += e.message
        finish(null)
      })
      child.once('close', (code: number | null) => finish(code))
    })
  }

  /** App quit. */
  killNow(): void {
    for (const c of this.children) this.deps.kill(c, true)
    this.children.clear()
    this.stopWatch()
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? (err.message + ('detail' in err && typeof err.detail === 'string' ? `: ${err.detail}` : '')) : String(err)
}
