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
import { parseProjectModel, projectModelArgs, type ParsedProjectModel } from './projectModel'
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
}

type Resolved = { target: ModelTarget; name: string } | { reason: 'no-gradle' | 'no-app' }

const REFRESH_TIMEOUT_MS = 5 * 60_000
const RES_DEBOUNCE_MS = 300
const GEN_DEBOUNCE_MS = 1500
const LOAD_TIMEOUT_MS = 120_000
const RESOLVE_TTL_MS = 10_000
const MAX_UP = 16
const MAX_THEMES = 20
const BLOCKING = new Set(['sdk-missing', 'jdk-missing', 'jdk-old', 'gradlew-missing', 'gradlew-not-executable'])

const isApp = (m: AndroidModule): boolean => m.type === 'application' || m.guessed

/** `:core:ui-kit` → `projects.core.uiKit` (Gradle type-safe project accessor). */
function accessorOf(modulePath: string): string {
  const camel = (s: string): string => s.replace(/[-_]+([A-Za-z0-9])/g, (_x, c: string) => c.toUpperCase())
  return `projects.${modulePath.replace(/^:/, '').split(':').map(camel).join('.')}`
}

/** True when the app's build script names the library: `project(":lib")` or the type-safe accessor. */
export function dependsOn(buildScript: string, libPath: string): boolean {
  const text = stripComments(buildScript)
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`project\\s*\\(\\s*(?:path\\s*[:=]\\s*)?["']${esc(libPath)}["']`).test(text)) return true
  return new RegExp(`\\b${esc(accessorOf(libPath))}\\b(?!\\.)`).test(text)
}

/**
 * Module whose model serves a layout: its own module when that is an app; for a library, the app whose build
 * script references it, else the first app of the Gradle root (the init script only runs on app modules).
 */
export async function pickModule(project: AndroidProject, file: string, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  let owner: AndroidModule | null = null
  for (const m of project.modules) if (isWithin(m.dir, file, platform) && (!owner || m.dir.length > owner.dir.length)) owner = m
  const apps = project.modules.filter(isApp)
  if (owner && isApp(owner)) return owner.path
  if (!apps.length) return null
  if (owner) {
    for (const app of apps) {
      for (const name of ['build.gradle.kts', 'build.gradle']) {
        const text = await fs.readFile(path.join(app.dir, name), 'utf8').catch(() => null)
        if (text !== null && dependsOn(text, owner.path)) return app.path
      }
    }
  }
  return apps[0]!.path
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
  private chain: Promise<unknown> = Promise.resolve()
  private unwatch: (() => void) | null = null
  private watchedKey: string | null = null
  private resPending = new Set<string>()
  private resTimer: ReturnType<typeof setTimeout> | null = null
  private resSlow = false

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
      const module = await pickModule(project, file, this.deps.platform)
      value = module ? { target: { root, module }, name: project.name } : { reason: 'no-app' }
    }
    this.resolved.set(dirKey, { at: this.now(), value })
    return value
  }

  private entry(target: ModelTarget, name?: string): Entry {
    const key = this.keyOf(target)
    let e = this.entries.get(key)
    if (e && name) e.name = name
    if (!e) {
      const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
      e = { key, target, name: name ?? path.basename(target.root), hash, state: { state: 'none' }, model: null, at: 0, variant: 'debug', broken: false, classesChanged: false, diskChecked: false }
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
    return { target: { ...e.target, name: e.name }, state: e.state, hasModel: !!e.model && !e.broken, themes: themesOf(e.model) }
  }

  /** Before each render: pending res changes flushed, the right project (or none) loaded. `key` changes with the model. */
  async prepare(file: string): Promise<{ key: string; frameworkOnly: boolean }> {
    const e = await this.entryFor(file).catch(() => null)
    this.wanted = e
    await this.flushRes(false)
    await this.serial(() => this.ensureLoaded(e)).catch((err: unknown) => this.deps.log('error', `project load: ${msg(err)}`))
    return this.loadedKey ? { key: `${this.loadedKey}#${this.version}`, frameworkOnly: false } : { key: 'framework', frameworkOnly: true }
  }

  private async ensureLoaded(e: Entry | null): Promise<void> {
    if (e?.model && !e.broken) {
      if (this.loadedKey !== e.key) await this.load(e)
      return
    }
    if (this.loadedKey === null) return
    this.loadedKey = null
    this.version++
    this.stopWatch()
    await this.deps.daemon.request('project/load', {}, this.deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS)
  }

  private async load(e: Entry): Promise<void> {
    let res: Record<string, unknown>
    try {
      // projectId: the daemon keeps a few projects warm, so switching back skips the AAR / classpath load.
      const params = { ...e.model!.payload, projectId: e.hash, classesChanged: e.classesChanged }
      res = ((await this.deps.daemon.request('project/load', params, this.deps.loadTimeoutMs ?? LOAD_TIMEOUT_MS)) ?? {}) as Record<string, unknown>
    } catch (err) {
      this.loadedKey = null
      e.broken = true
      this.setState(e, { state: 'error', code: 'load-failed', detail: msg(err).slice(0, 600), at: this.now() })
      throw err
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

  /** Daemon lifecycle: any (re)start drops the project; once ready, the wanted one is loaded again from the cache. */
  onDaemonState(state: string): void {
    if (state !== 'ready') {
      this.loadedKey = null
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
      this.deps.log('info', `project model: gradlew ${args.join(' ')} (in ${root})`)
      const started = this.now()
      const run = await this.runGradle(spec.file, spec.args, spec.verbatim, root, gradleEnv)
      if (run.timedOut) return fail('timeout')
      if (run.code !== 0) return fail('gradle-failed', run.tail)
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
