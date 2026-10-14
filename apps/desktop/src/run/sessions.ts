import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  isRunLive,
  type RunCommandPreview,
  type RunConfig,
  type RunDetectResult,
  type RunDevice,
  type RunEmulator,
  type RunEnv,
  type RunEvent,
  type RunKind,
  type RunLogLine,
  type RunProject,
  type RunResult,
  type RunSession,
  type RunStartRequest,
} from '@ccm/shared'
import { isWithin, realOrNull } from '../preview/paths'
import { detectAndroid } from './android/detect'
import { androidEnv, gradlewFile } from './android/env'
import { runStep } from './before'
import { previewCommand } from './command'
import { RunConfigStore, cleanRunConfig, defaultConfigs, dropBlockedEnv, needsTrust } from './configs'
import { detectFlutter } from './flutter/detect'
import { findFlutterSdk, flutterEnv, flutterExecutable, flutterSpawn } from './flutter/env'
import { importIntellij, importVscode } from './importers'
import { killTree, type Spawner } from './proc'
import { configHash, TrustStore } from './trust'
import type { DeviceService, RunContext, RunnerFactory, RunSettings, Runner } from './types'

const DETECT_TTL_MS = 5_000
const LOG_FLUSH_MS = 100
const MAX_ENDED = 20
const SETTINGS_FILE = 'run-settings.json'
const RESTART_STOP_MS = 8_000
const PUB_GET_TIMEOUT_MS = 5 * 60_000

export interface RunManagerDeps {
  dataDir: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  spawn: Spawner
  runners: Record<RunKind, RunnerFactory>
  devices: { flutter: (settings: RunSettings) => DeviceService; adb: (settings: RunSettings) => DeviceService }
  broadcast: (event: RunEvent) => void
  /** Native confirm. `trust-config` detail is JSON `{ name, cwd, command, beforeLaunch, envKeys }`. */
  confirm: (code: string, detail?: string) => Promise<boolean>
  /** Bound on the graceful stop before a same-pair restart (tests shorten it). */
  restartStopMs?: number
  pubGetTimeoutMs?: number
}

interface Live {
  config: RunConfig
  session: RunSession
  runner: Runner
  key: string
  device: RunDevice | null
}

type StateListener = (session: RunSession, config: RunConfig, device: RunDevice | null) => void

const pairKey = (configId: string, deviceId: string | null): string => `${configId}\u0000${deviceId ?? ''}`

export class RunManager {
  private readonly store: RunConfigStore
  private readonly trust: TrustStore
  private settings: RunSettings = { flutterSdk: null, androidSdk: null, jdk: null }
  private readonly detected = new Map<string, RunDetectResult>()
  private readonly sessions = new Map<string, Live>()
  private readonly pending = new Map<string, RunLogLine[]>()
  /** Sessions with a progress-only change waiting for the next flush. */
  private readonly dirty = new Set<string>()
  private readonly starting = new Set<string>()
  private readonly pubGets = new Map<string, Promise<RunResult>>()
  private readonly pubChildren = new Set<ChildProcess>()
  private flushTimer: NodeJS.Timeout | null = null
  private flutterDevices: DeviceService | null = null
  private adbDevices: DeviceService | null = null
  private lastDevices = { flutter: [] as RunDevice[], adb: [] as RunDevice[] }
  private readonly unsubs: (() => void)[] = []
  private readonly stateListeners = new Set<StateListener>()

  constructor(private readonly deps: RunManagerDeps) {
    this.store = new RunConfigStore(deps.dataDir)
    this.trust = new TrustStore(deps.dataDir)
  }

  async loadSettings(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.deps.dataDir, SETTINGS_FILE), 'utf8')) as Partial<RunSettings>
      const abs = (v: unknown): string | null => (typeof v === 'string' && path.isAbsolute(v) ? v : null)
      this.settings = { flutterSdk: abs(raw.flutterSdk), androidSdk: abs(raw.androidSdk), jdk: abs(raw.jdk) }
    } catch {
      // first run / unreadable: defaults
    }
  }

  getSettings(): RunSettings {
    return { ...this.settings }
  }

  async setSettings(next: Partial<RunSettings>): Promise<RunSettings> {
    const abs = (v: unknown, prev: string | null): string | null => (v === undefined ? prev : typeof v === 'string' && path.isAbsolute(v) ? v : null)
    this.settings = { flutterSdk: abs(next.flutterSdk, this.settings.flutterSdk), androidSdk: abs(next.androidSdk, this.settings.androidSdk), jdk: abs(next.jdk, this.settings.jdk) }
    const file = path.join(this.deps.dataDir, SETTINGS_FILE)
    await fs.mkdir(this.deps.dataDir, { recursive: true })
    await fs.writeFile(file + '.tmp', JSON.stringify(this.settings, null, 2))
    await fs.rename(file + '.tmp', file)
    this.restartDevices()
    return this.getSettings()
  }

  async detect(root: string, fresh = false): Promise<RunDetectResult> {
    const cached = this.detected.get(root)
    if (!fresh && cached && Date.now() - cached.at < DETECT_TTL_MS) return cached
    const [flutter, android] = await Promise.all([detectFlutter(root).catch(() => []), detectAndroid(root).catch(() => [])])
    const result: RunDetectResult = { root, projects: [...flutter, ...android], at: Date.now() }
    const changed = JSON.stringify(cached?.projects) !== JSON.stringify(result.projects)
    this.detected.set(root, result)
    if (cached && changed) this.deps.broadcast({ type: 'projects', result })
    return result
  }

  /** Deepest detected root holding `dir` (the repo the project sits in). */
  private repoRootOf(dir: string): string | undefined {
    let best: string | undefined
    for (const root of this.detected.keys()) if (isWithin(root, dir) && (!best || root.length > best.length)) best = root
    return best
  }

  /** Passive (pane open): never executes an SDK / JDK that lives inside the project or its repo. */
  async env(dir: string, kind: 'flutter' | 'android'): Promise<RunEnv> {
    const { env, platform, home } = this.deps
    const repoRoot = this.repoRootOf(dir)
    if (kind === 'flutter') return flutterEnv(dir, { setting: this.settings.flutterSdk, env, platform, home, repoRoot })
    return androidEnv(dir, { sdkSetting: this.settings.androidSdk, jdkSetting: this.settings.jdk, env, platform, home, repoRoot })
  }

  private ensureDevices(): void {
    if (!this.flutterDevices) {
      this.flutterDevices = this.deps.devices.flutter(this.settings)
      this.unsubs.push(this.flutterDevices.onChange((d) => this.devicesChanged('flutter', d)))
    }
    if (!this.adbDevices) {
      this.adbDevices = this.deps.devices.adb(this.settings)
      this.unsubs.push(this.adbDevices.onChange((d) => this.devicesChanged('adb', d)))
    }
  }

  private restartDevices(sync = false): void {
    for (const u of this.unsubs.splice(0)) u()
    this.flutterDevices?.stop(sync)
    this.adbDevices?.stop(sync)
    this.flutterDevices = this.adbDevices = null
  }

  private merged(): RunDevice[] {
    // flutter lists Android devices too (same serial); adb knows unauthorized/offline, flutter knows the platform.
    const byId = new Map<string, RunDevice>()
    for (const d of this.lastDevices.adb) byId.set(d.id, d)
    for (const d of this.lastDevices.flutter) {
      const adb = byId.get(d.id)
      byId.set(d.id, adb ? { ...d, state: adb.state } : d)
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  private devicesChanged(source: 'flutter' | 'adb', devices: RunDevice[]): void {
    this.lastDevices[source] = devices
    this.deps.broadcast({ type: 'devices', devices: this.merged() })
  }

  async devices(): Promise<RunDevice[]> {
    this.ensureDevices()
    const [flutter, adb] = await Promise.all([this.flutterDevices!.list().catch(() => []), this.adbDevices!.list().catch(() => [])])
    this.lastDevices = { flutter, adb }
    return this.merged()
  }

  async emulators(): Promise<RunEmulator[]> {
    this.ensureDevices()
    const [flutter, adb] = await Promise.all([this.flutterDevices!.emulators().catch(() => []), this.adbDevices!.emulators().catch(() => [])])
    const seen = new Set(flutter.map((e) => e.id))
    return [...flutter, ...adb.filter((e) => !seen.has(e.id))]
  }

  /** Only an id the tools listed: it ends up as an `emulator -avd <id>` / `flutter emulators --launch <id>` argument. */
  async launchEmulator(id: string, source: 'flutter' | 'adb'): Promise<RunResult> {
    if (id.startsWith('-') || !(await this.emulators()).some((e) => e.id === id)) return { ok: false, error: { code: 'emulator-missing' } }
    const svc = source === 'flutter' ? this.flutterDevices! : this.adbDevices!
    return svc.launchEmulator(id)
  }

  /** Stored configs, then the detected defaults they don't override (stable `auto-` ids). */
  async configs(root: string): Promise<RunConfig[]> {
    const stored = this.store.list(root)
    const ids = new Set(stored.map((c) => c.id))
    const defaults = defaultConfigs((await this.detect(root)).projects, root).filter((c) => !ids.has(c.id))
    return [...stored, ...defaults]
  }

  async saveConfig(root: string, raw: unknown): Promise<RunConfig | null> {
    const saved = this.store.save(root, raw)
    if (saved) this.deps.broadcast({ type: 'configs', root, configs: await this.configs(root) })
    return saved
  }

  async deleteConfig(root: string, id: string): Promise<boolean> {
    const ok = this.store.delete(root, id)
    if (ok) this.deps.broadcast({ type: 'configs', root, configs: await this.configs(root) })
    return ok
  }

  /** Idempotent: an entry imported before (same `imp-` id) is skipped, even if edited since. */
  async importConfigs(root: string): Promise<RunConfig[]> {
    const have = new Set(this.store.list(root).map((c) => c.id))
    const found = [...importIntellij(root), ...importVscode(root)].filter((c) => !have.has(c.id))
    const saved = found.flatMap((c) => this.store.save(root, c) ?? [])
    if (saved.length) this.deps.broadcast({ type: 'configs', root, configs: await this.configs(root) })
    return saved
  }

  private projectAt(root: string, cwd: string): RunProject | null {
    return this.detected.get(root)?.projects.find((p) => path.relative(p.dir, cwd) === '') ?? null
  }

  async preview(root: string, raw: unknown, deviceId: string | null): Promise<RunCommandPreview | null> {
    const cfg = cleanRunConfig(raw, root)
    if (!cfg) return null
    await this.detect(root)
    const { env, platform, home } = this.deps
    let executable = ''
    if (cfg.type === 'flutter') {
      const sdk = findFlutterSdk(cfg.cwd, { setting: this.settings.flutterSdk, env, platform, home }).sdk
      executable = sdk ? flutterExecutable(sdk, platform) : 'flutter'
    } else if (cfg.type === 'android') executable = gradlewFile(cfg.cwd, platform)
    return previewCommand(cfg, { executable, deviceId, workspaceDir: root, env, project: this.projectAt(root, cfg.cwd) })
  }

  list(): RunSession[] {
    return [...this.sessions.values()].map((l) => l.session)
  }

  live(): RunSession[] {
    return this.list().filter((s) => isRunLive(s.state))
  }

  /** One start per (config, device) at a time: a double Run click gets `run-pending`, not a second session. */
  async start(req: RunStartRequest): Promise<RunResult> {
    const reserved = pairKey(req.configId, req.deviceId)
    if (this.starting.has(reserved)) return { ok: false, error: { code: 'run-pending' } }
    this.starting.add(reserved)
    try {
      return await this.startReserved(req, reserved)
    } finally {
      this.starting.delete(reserved)
    }
  }

  private async startReserved(req: RunStartRequest, reserved: string): Promise<RunResult> {
    const found = (await this.configs(req.root)).find((c) => c.id === req.configId)
    if (!found) return { ok: false, error: { code: 'config-missing' } }
    const cfg = needsTrust(found) ? { ...found, env: dropBlockedEnv(found.env) } : found
    const deviceId = cfg.type === 'custom' ? null : cfg.device !== 'selected' ? cfg.device : req.deviceId
    if (cfg.type !== 'custom' && !deviceId) return { ok: false, error: { code: 'device-missing' } }
    const device = deviceId ? (this.merged().find((d) => d.id === deviceId) ?? (await this.devices()).find((d) => d.id === deviceId) ?? null) : null
    if (deviceId && !device) return { ok: false, error: { code: 'device-missing', detail: deviceId } }
    const key = pairKey(cfg.id, deviceId)
    if (key !== reserved) {
      if (this.starting.has(key)) return { ok: false, error: { code: 'run-pending' } }
      this.starting.add(key)
    }
    try {
      const [realRoot, realCwd] = await Promise.all([realOrNull(req.root), realOrNull(cfg.cwd)])
      if (!realCwd) return { ok: false, error: { code: 'cwd-missing', detail: cfg.cwd } }
      if (!realRoot || !isWithin(realRoot, realCwd)) return { ok: false, error: { code: 'cwd-outside', detail: cfg.cwd } }
      if (needsTrust(cfg) && !(await this.approve(req.root, cfg, deviceId))) return { ok: false, error: { code: 'untrusted' } }
      const previous = [...this.sessions.values()].find((l) => l.key === key && isRunLive(l.session.state))
      if (previous) await this.stopBounded(previous)
      return this.launch(req.root, cfg, device, key)
    } finally {
      if (key !== reserved) this.starting.delete(key)
    }
  }

  /** First run of a shared / imported config, or after its content changed: native confirm, remembered by hash. */
  private async approve(root: string, cfg: RunConfig, deviceId: string | null): Promise<boolean> {
    const hash = configHash(cfg)
    if (await this.trust.has(hash)) return true
    const preview = await this.preview(root, cfg, deviceId).catch(() => null)
    const detail = JSON.stringify({
      name: cfg.name,
      cwd: cfg.cwd,
      command: preview?.command ?? '',
      beforeLaunch: cfg.beforeLaunch,
      envKeys: Object.keys(cfg.env),
    })
    if (!(await this.deps.confirm('trust-config', detail))) return false
    await this.trust.add(hash)
    return true
  }

  private async stopBounded(l: Live): Promise<void> {
    let timer: NodeJS.Timeout | undefined
    const timedOut = await Promise.race([
      l.runner.stop().then(
        () => false,
        () => false,
      ),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), this.deps.restartStopMs ?? RESTART_STOP_MS))),
    ])
    clearTimeout(timer)
    if (!timedOut) return
    l.runner.kill()
    if (isRunLive(l.session.state)) this.update(l.session.id, { state: 'stopped', endedAt: Date.now(), progress: null })
  }

  private launch(root: string, cfg: RunConfig, device: RunDevice | null, key: string): RunResult {
    const session: RunSession = {
      id: randomUUID(),
      configId: cfg.id,
      configName: cfg.name,
      type: cfg.type,
      cwd: cfg.cwd,
      deviceId: device?.id ?? null,
      deviceName: device?.name ?? null,
      mode: cfg.type === 'flutter' ? cfg.mode : null,
      state: 'starting',
      startedAt: Date.now(),
      endedAt: null,
      appId: null,
      vmServiceUri: null,
      devtoolsUri: null,
      failure: null,
      progress: null,
    }
    const ctx: RunContext = {
      root,
      config: cfg,
      device,
      settings: this.getSettings(),
      env: this.deps.env,
      platform: this.deps.platform,
      home: this.deps.home,
      spawn: this.deps.spawn,
      hooks: {
        state: (state, patch) => this.update(session.id, { state, ...patch, ...(isRunLive(state) ? {} : { endedAt: Date.now(), progress: null }) }),
        fail: (failure) => this.update(session.id, { state: 'failed', failure, endedAt: Date.now(), progress: null }),
        log: (line) => this.queueLog(session.id, { ...line, at: Date.now() }),
        error: (error) => this.deps.broadcast({ type: 'error', sessionId: session.id, error }),
        confirm: this.deps.confirm,
      },
    }
    const runner = this.deps.runners[cfg.type](ctx)
    this.sessions.set(session.id, { session, runner, key, config: cfg, device })
    this.prune()
    this.deps.broadcast({ type: 'session', session })
    void runner.start().catch(() => ctx.hooks.fail({ code: 'spawn' }))
    return { ok: true, sessionId: session.id }
  }

  private update(id: string, patch: Partial<RunSession>): void {
    const live = this.sessions.get(id)
    // Ended (stopped / failed / cancelled) is final: late runner reports must not revive or relabel it.
    if (!live || !isRunLive(live.session.state)) return
    const progressOnly = Object.keys(patch).every((k) => k === 'progress' || k === 'state') && (patch.state === undefined || patch.state === live.session.state)
    const prevState = live.session.state
    live.session = { ...live.session, ...patch }
    if (progressOnly) {
      this.dirty.add(id)
      this.flushTimer ??= setTimeout(() => this.flushLogs(), LOG_FLUSH_MS)
      return
    }
    this.dirty.delete(id)
    this.flushLogs()
    this.deps.broadcast({ type: 'session', session: live.session })
    if (live.session.state !== prevState) {
      for (const cb of this.stateListeners) {
        try {
          cb(live.session, live.config, live.device)
        } catch {
          // a listener must not break session bookkeeping
        }
      }
    }
  }

  /** State transitions (e.g. an Android build reaching `running`), for side services such as the layout model. */
  onSessionState(cb: StateListener): () => void {
    this.stateListeners.add(cb)
    return () => this.stateListeners.delete(cb)
  }

  private queueLog(id: string, line: RunLogLine): void {
    const list = this.pending.get(id)
    if (list) list.push(line)
    else this.pending.set(id, [line])
    this.flushTimer ??= setTimeout(() => this.flushLogs(), LOG_FLUSH_MS)
  }

  private flushLogs(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    for (const [sessionId, lines] of this.pending) this.deps.broadcast({ type: 'log', sessionId, lines })
    this.pending.clear()
    for (const id of this.dirty) {
      const live = this.sessions.get(id)
      if (live) this.deps.broadcast({ type: 'session', session: live.session })
    }
    this.dirty.clear()
  }

  private prune(): void {
    const ended = this.list().filter((s) => !isRunLive(s.state)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    for (const s of ended.slice(MAX_ENDED)) this.sessions.delete(s.id)
  }

  async stop(sessionId: string): Promise<RunResult> {
    const live = this.sessions.get(sessionId)
    if (!live) return { ok: false, error: { code: 'session-missing' } }
    await live.runner.stop()
    return { ok: true }
  }

  async reload(sessionId: string, full: boolean): Promise<RunResult> {
    const live = this.sessions.get(sessionId)
    if (!live?.runner.reload) return { ok: false, error: { code: 'reload-unsupported' } }
    return live.runner.reload(full)
  }

  /** One `pub get` per folder at a time; a second call joins the first. */
  pubGet(dir: string): Promise<RunResult> {
    const key = this.deps.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir)
    const running = this.pubGets.get(key)
    if (running) return running
    const job = this.runPubGet(dir).finally(() => this.pubGets.delete(key))
    this.pubGets.set(key, job)
    return job
  }

  private async runPubGet(dir: string): Promise<RunResult> {
    const { env, platform, home } = this.deps
    const sdk = findFlutterSdk(dir, { setting: this.settings.flutterSdk, env, platform, home }).sdk
    if (!sdk) return { ok: false, error: { code: 'flutter-missing' } }
    let spec: ReturnType<typeof flutterSpawn>
    try {
      spec = flutterSpawn(sdk, ['pub', 'get'], platform, env)
    } catch {
      return { ok: false, error: { code: 'bad-arg' } }
    }
    let firstError: string | null = null
    const ctx = {
      config: { cwd: dir, env: {} },
      spawn: this.deps.spawn,
      hooks: {
        log: (l: { text: string }) => {
          if (firstError === null && /error/i.test(l.text)) firstError = l.text.slice(0, 300)
        },
      },
    } as unknown as RunContext
    const step = runStep(ctx, spec.file, spec.args, { verbatim: spec.windowsVerbatimArguments })
    const child = step.child
    if (child) this.pubChildren.add(child)
    let timer: NodeJS.Timeout | undefined
    const result = await Promise.race([
      step.done.then((ok) => (ok ? 'ok' : 'failed')),
      new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), this.deps.pubGetTimeoutMs ?? PUB_GET_TIMEOUT_MS))),
    ])
    clearTimeout(timer)
    if (child) {
      if (result === 'timeout') killTree(child)
      this.pubChildren.delete(child)
    }
    for (const root of this.detected.keys()) if (isWithin(root, dir)) void this.detect(root, true)
    if (result === 'ok') return { ok: true }
    const detail = result === 'timeout' ? 'timeout' : firstError
    return { ok: false, error: detail ? { code: 'pub-get', detail } : { code: 'pub-get' } }
  }

  /** App quit: graceful stops in parallel, bounded by the caller's deadline. */
  async stopAll(): Promise<void> {
    await Promise.allSettled(this.live().map((s) => this.sessions.get(s.id)?.runner.stop()))
    this.restartDevices()
  }

  /** Sync: safe to call from `before-quit` / session end. */
  killAll(): void {
    for (const l of this.sessions.values()) if (isRunLive(l.session.state)) l.runner.kill()
    for (const c of this.pubChildren) killTree(c, true)
    this.pubChildren.clear()
    this.restartDevices(true)
  }
}
