import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BuildError, FwpEntry, FwpError, FwpResult, FwpSnapshot } from '@ccm/shared'
import { lineSplitter, parseBuildError } from '../run/parse'
import { killTree, type Spawner } from '../run/proc'
import { BadArgError } from '../run/resolve'
import { findFlutterSdk, flutterSpawn, nodeEnvDeps, sdkInsideProject, sdkSettings, type FlutterEnvOpts, type FlutterSdkLookup } from '../run/flutter/env'
import { createMachineClient, type MachineClient, type MachineReply } from '../run/flutter/machine'
import { maskLog } from '../log-mask'
import { ERROR_MARKER, hostSource, readPackage, SHOW_EXTENSION, writeHost } from './host'
import { scanProject } from './scan'

export interface FlutterPreviewDeps {
  spawn: Spawner
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  home: string
  settings: () => { flutterSdk: string | null; flutterSdkProjects?: Record<string, string> }
  emit: (snapshot: FwpSnapshot) => void
  /** Recursive watch of `<root>/lib`, debounced; returns the unsubscribe. */
  watch: (dir: string, onChange: (changed: string[]) => void) => () => void
  /** `<root>/pubspec.yaml` edits, debounced; returns the unsubscribe. */
  watchPubspec?: (root: string, onChange: () => void) => () => void
  kill?: (child: ChildProcess, sync?: boolean) => void
  findSdk?: (projectDir: string, opts: FlutterEnvOpts) => FlutterSdkLookup
  sdkInside?: (sdk: string, root: string) => boolean
  scan?: (root: string) => Promise<FwpEntry[]>
  readText?: (file: string) => Promise<string | null>
  writeHost?: (root: string, source: string) => Promise<{ file: string; changed: boolean }>
  stopTimeoutMs?: number
  logFlushMs?: number
  pubGetTimeoutMs?: number
}

const LOG_CAP = 300
const STOP_TIMEOUT = 5_000
const FLAVOR = /^[A-Za-z0-9_-]{1,64}$/
const CANCELLED: FwpResult = { ok: false, error: { code: 'cancelled' } }
const LOST = /Lost connection to device/i
const PUB_GET_TIMEOUT = 120_000
const MESSAGE_CAP = 300

interface Live {
  child: ChildProcess
  machine: MachineClient
  root: string
  pkg: string
  sdk: string
  deviceId: string
  flavor: string | null
  appId: string | null
  started: boolean
  stopRequested: boolean
  buildError: BuildError | null
  reloadError: BuildError | null
  deviceLost: boolean
  reloading: boolean
  reloadQueued: boolean
  syncing: boolean
  syncQueued: boolean
  pubChild: ChildProcess | null
  unwatch: (() => void) | null
  unwatchPubspec: (() => void) | null
  exited: Promise<void>
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

function replyError(res: MachineReply): string | null {
  const e = res.error
  if (e !== undefined && e !== null) return typeof e === 'string' ? e : e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' ? e.message : JSON.stringify(e)
  const r = res.result as { code?: unknown; message?: unknown } | undefined
  return typeof r?.code === 'number' && r.code !== 0 ? String(r.message ?? r.code) : null
}

export class FlutterPreviewService {
  private snap: FwpSnapshot = { state: 'idle', root: null, deviceId: null, appId: null, current: null, progress: null, error: null, entries: [], log: [] }
  private live: Live | null = null
  private gen = 0
  private logTimer: NodeJS.Timeout | null = null
  private stopTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: FlutterPreviewDeps) {}

  get(): FwpSnapshot {
    return { ...this.snap, entries: [...this.snap.entries], log: [...this.snap.log] }
  }

  async scan(root: string): Promise<FwpEntry[]> {
    const entries = await (this.deps.scan ?? scanProject)(root)
    if (this.snap.root === root) this.patch({ entries })
    return entries
  }

  async start(root: string, deviceId: string, flavor?: string | null): Promise<FwpResult> {
    if (flavor && !FLAVOR.test(flavor)) return { ok: false, error: { code: 'bad-arg' } }
    await this.stop()
    const gen = ++this.gen
    const sameRoot = this.snap.root === root
    this.snap.log = []
    this.patch({ state: 'starting', root, deviceId, appId: null, progress: null, error: null, current: sameRoot || this.snap.root === null ? this.snap.current : null, entries: sameRoot ? this.snap.entries : [] })
    const { env, platform, home } = this.deps
    const pubspec = await (this.deps.readText ?? readText)(path.join(root, 'pubspec.yaml'))
    if (gen !== this.gen) return CANCELLED
    const pkg = pubspec === null ? null : readPackage(pubspec)
    if (!pkg?.flutter) return this.fail({ code: 'not-flutter' })
    const found = (this.deps.findSdk ?? findFlutterSdk)(root, { ...sdkSettings(this.deps.settings(), root, platform), env, platform, home })
    if (!found.sdk) return this.fail({ code: found.issues[0]?.code ?? 'flutter-missing' })
    const inside = this.deps.sdkInside ?? ((sdk: string, dir: string) => sdkInsideProject(sdk, dir, { env, platform, home }, nodeEnvDeps))
    if (found.source !== 'setting' && found.source !== 'project' && inside(found.sdk, root)) return this.fail({ code: 'fvm-local-unverified', detail: found.sdk })
    let hostFile: string
    try {
      const entries = await (this.deps.scan ?? scanProject)(root)
      hostFile = (await (this.deps.writeHost ?? writeHost)(root, hostSource(pkg.name, entries))).file
      if (gen !== this.gen) return CANCELLED
      this.patch({ entries })
    } catch (e) {
      if (gen !== this.gen) return CANCELLED
      return this.fail({ code: 'host-write', detail: e instanceof Error ? e.message : String(e) })
    }
    const args = ['run', '--machine', '-t', hostFile, '-d', deviceId, '--debug', ...(flavor ? ['--flavor', flavor] : [])]
    if (gen !== this.gen) return CANCELLED
    this.log(`> flutter ${args.join(' ')}`)
    let child: ChildProcess
    try {
      const spec = flutterSpawn(found.sdk, args, platform, env)
      child = this.deps.spawn({ file: spec.file, args: spec.args, cwd: root, verbatim: spec.windowsVerbatimArguments === true, stdin: 'pipe' })
    } catch (e) {
      return this.fail(e instanceof BadArgError ? { code: 'bad-arg' } : { code: 'spawn', detail: e instanceof Error ? e.message : String(e) })
    }
    let onExit: () => void = () => undefined
    // Callbacks fire on later stdout chunks, after `live` / `text` below are initialised.
    const machine = createMachineClient(child, { onEvent: (event, params) => this.onEvent(live, event, params, text), onText: (line) => text(line) })
    const live: Live = {
      child,
      machine,
      root,
      pkg: pkg.name,
      sdk: found.sdk,
      deviceId,
      flavor: flavor || null,
      appId: null,
      started: false,
      stopRequested: false,
      buildError: null,
      reloadError: null,
      deviceLost: false,
      reloading: false,
      reloadQueued: false,
      syncing: false,
      syncQueued: false,
      pubChild: null,
      unwatch: null,
      unwatchPubspec: null,
      exited: new Promise<void>((resolve) => (onExit = resolve)),
    }
    this.live = live
    const text = (line: string): void => {
      if (!line.trim()) return
      const widgetError = this.widgetError(line)
      if (widgetError) {
        this.log(`${ERROR_MARKER}${widgetError.entry}: ${widgetError.detail}`)
        if (live.started && this.live === live && !live.stopRequested) this.patch({ error: widgetError })
        return
      }
      this.log(line)
      if (LOST.test(line)) live.deviceLost = true
      const err = parseBuildError(line, root)
      if (err?.severity !== 'error') return
      if (!live.started && !live.buildError) live.buildError = err
      else if (live.reloading && !live.reloadError) live.reloadError = err
    }
    const err = lineSplitter(text)
    child.stderr?.on('data', err.push)
    child.stdin?.on('error', () => undefined)
    let closed = false
    const close = (code: number | null, spawnError?: string): void => {
      if (closed) return
      closed = true
      live.machine.flush()
      err.flush()
      live.machine.dispose()
      this.unwatch(live)
      onExit()
      if (this.live !== live) return
      this.live = null
      if (live.stopRequested) this.patch({ state: 'stopped', progress: null, appId: null })
      else if (live.started) this.patch({ state: 'stopped', progress: null, appId: null, error: live.deviceLost ? { code: 'device-lost' } : { code: 'exited', detail: String(code ?? 'signal') } })
      else if (spawnError) this.fail({ code: 'spawn', detail: spawnError })
      else this.fail(live.buildError ? { code: 'build', build: live.buildError } : live.deviceLost ? { code: 'device-lost' } : { code: 'exit', detail: String(code ?? 'signal') })
    }
    child.once('error', (e) => close(null, e.message))
    child.once('close', (code) => close(code))
    return { ok: true }
  }

  async show(id: string): Promise<FwpResult> {
    this.patch(this.snap.error?.code === 'widget' ? { current: id, error: null } : { current: id })
    const live = this.live
    if (!live?.started || !live.appId || live.stopRequested) return { ok: true }
    return this.sendShow(live, id)
  }

  async stop(): Promise<void> {
    // Cancels a start() still before spawn (it re-checks gen), so nothing spawns after Stop / quit.
    this.gen++
    const live = this.live
    if (!live) {
      if (this.snap.state === 'starting') this.patch({ state: 'stopped', progress: null, error: null })
      return
    }
    if (!live.stopRequested) {
      live.stopRequested = true
      this.unwatch(live)
      this.patch({ state: 'stopped', progress: null, error: null })
      this.killPubGet(live)
      if (live.appId) void live.machine.request('app.stop', { appId: live.appId })
      else this.kill(live.child)
    }
    const timer = setTimeout(() => this.kill(live.child), this.deps.stopTimeoutMs ?? STOP_TIMEOUT)
    this.stopTimer = timer
    await live.exited
    clearTimeout(timer)
    if (this.stopTimer === timer) this.stopTimer = null
  }

  /** App quit: no graceful path. */
  killNow(): void {
    this.gen++
    this.clearTimers()
    const live = this.live
    if (!live) return
    live.stopRequested = true
    this.unwatch(live)
    this.killPubGet(live, true)
    this.kill(live.child, true)
  }

  dispose(): void {
    this.clearTimers()
  }

  private clearTimers(): void {
    if (this.logTimer) clearTimeout(this.logTimer)
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.logTimer = null
    this.stopTimer = null
  }

  private kill(child: ChildProcess, sync = false): void {
    ;(this.deps.kill ?? killTree)(child, sync)
  }

  private onEvent(live: Live, event: string, params: Record<string, unknown>, text: (line: string) => void): void {
    if (this.live !== live || live.stopRequested) return
    switch (event) {
      case 'app.start':
        live.appId = str(params.appId) ?? live.appId
        this.patch({ appId: live.appId })
        return
      case 'app.progress': {
        if (params.finished === true) return this.patch({ progress: null })
        const message = str(params.message)
        if (message) {
          this.log(message)
          this.patch({ progress: message })
        }
        return
      }
      case 'app.started':
        live.started = true
        this.patch({ state: 'running', progress: null, error: null })
        live.unwatch = this.deps.watch(path.join(live.root, 'lib'), (changed) => void this.onSave(live, changed))
        live.unwatchPubspec = this.deps.watchPubspec?.(live.root, () => void this.onPubspec(live)) ?? null
        if (this.snap.current) void this.sendShow(live, this.snap.current)
        return
      case 'app.log': {
        const log = typeof params.log === 'string' ? params.log : ''
        for (const l of log.split(/\r?\n/)) text(l)
        return
      }
      case 'daemon.logMessage': {
        const message = str(params.message)
        if (message) for (const l of message.split(/\r?\n/)) text(l)
        return
      }
      case 'app.stop': {
        const error = str(params.error)
        if (error) text(error)
        return
      }
    }
  }

  private async sendShow(live: Live, id: string): Promise<FwpResult> {
    const res = await live.machine.request('app.callServiceExtension', { appId: live.appId, methodName: SHOW_EXTENSION, params: { id } })
    const failed = replyError(res)
    if (failed !== null) {
      this.log(failed)
      return { ok: false, error: { code: 'show-failed', detail: failed } }
    }
    const result = res.result as { ok?: unknown } | undefined
    return result?.ok === false ? { ok: false, error: { code: 'unknown-id' } } : { ok: true }
  }

  private async onSave(live: Live, changed: string[]): Promise<void> {
    if (!changed.some((f) => f.endsWith('.dart')) || this.live !== live || !live.started || live.stopRequested || live.syncing) return
    if (live.reloading) {
      live.reloadQueued = true
      return
    }
    live.reloading = true
    live.reloadError = null
    this.patch({ state: 'reloading' })
    let error: FwpError | null = null
    try {
      const entries = await (this.deps.scan ?? scanProject)(live.root)
      await (this.deps.writeHost ?? writeHost)(live.root, hostSource(live.pkg, entries))
      if (this.live === live) this.patch({ entries })
      const res = await live.machine.request('app.restart', { appId: live.appId, fullRestart: false, pause: false, reason: 'save' })
      const failed = replyError(res)
      if (failed !== null) this.log(failed)
      if (live.reloadError) error = { code: 'build', build: live.reloadError }
      else if (failed !== null) error = { code: 'reload-failed', detail: failed }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      this.log(detail)
      error = { code: 'reload-failed', detail }
    } finally {
      live.reloading = false
    }
    if (this.live !== live || live.stopRequested || live.syncing) return
    this.patch({ state: 'running', error })
    if (live.reloadQueued) {
      live.reloadQueued = false
      await this.onSave(live, ['.dart'])
    }
  }

  /** pub get, then a fresh session: new packages (plugins with native code too) need a rebuild, not a hot reload. */
  private async onPubspec(live: Live): Promise<void> {
    if (this.live !== live || !live.started || live.stopRequested) return
    if (live.syncing) {
      live.syncQueued = true
      return
    }
    live.syncing = true
    this.patch({ state: 'syncing', progress: null, error: null })
    let error: FwpError | null = null
    do {
      live.syncQueued = false
      error = await this.pubGet(live)
    } while (!error && live.syncQueued && this.live === live && !live.stopRequested)
    live.syncing = false
    if (this.live !== live || live.stopRequested) return
    if (error) return this.patch({ state: 'running', error })
    void this.start(live.root, live.deviceId, live.flavor)
  }

  private pubGet(live: Live): Promise<FwpError | null> {
    const { platform, env } = this.deps
    const args = ['pub', 'get']
    this.log(`> flutter ${args.join(' ')}`)
    let child: ChildProcess
    try {
      const spec = flutterSpawn(live.sdk, args, platform, env)
      child = this.deps.spawn({ file: spec.file, args: spec.args, cwd: live.root, verbatim: spec.windowsVerbatimArguments === true, stdin: 'ignore' })
    } catch (e) {
      return Promise.resolve({ code: 'pub-get', detail: e instanceof Error ? e.message : String(e) })
    }
    live.pubChild = child
    let firstError: string | null = null
    const onLine = (line: string): void => {
      if (!line.trim()) return
      this.log(line)
      if (firstError === null && /error/i.test(line)) firstError = maskLog(line, this.deps.home, platform).slice(0, MESSAGE_CAP)
    }
    const out = lineSplitter(onLine)
    const err = lineSplitter(onLine)
    child.stdout?.on('data', out.push)
    child.stderr?.on('data', err.push)
    return new Promise((resolve) => {
      let settled = false
      const done = (code: number | null, detail?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        out.flush()
        err.flush()
        if (live.pubChild === child) live.pubChild = null
        if (code === 0) return resolve(null)
        resolve({ code: 'pub-get', detail: detail ?? firstError ?? `exit ${code ?? 'signal'}` })
      }
      const timer = setTimeout(() => {
        this.killPubGet(live)
        done(null, 'timeout')
      }, this.deps.pubGetTimeoutMs ?? PUB_GET_TIMEOUT)
      child.once('error', (e) => done(null, e.message))
      child.once('close', (code) => done(code))
    })
  }

  private killPubGet(live: Live, sync = false): void {
    if (live.pubChild) this.kill(live.pubChild, sync)
    live.pubChild = null
  }

  private unwatch(live: Live): void {
    live.unwatch?.()
    live.unwatchPubspec?.()
    live.unwatch = null
    live.unwatchPubspec = null
  }

  /** Host marker line → panel error; masked and capped since the message may quote app data. */
  private widgetError(line: string): FwpError | null {
    const at = line.indexOf(ERROR_MARKER)
    if (at < 0) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(line.slice(at + ERROR_MARKER.length))
    } catch {
      return null
    }
    const { id, message } = (parsed ?? {}) as { id?: unknown; message?: unknown }
    if (typeof id !== 'string' || typeof message !== 'string') return null
    const clean = maskLog(message, this.deps.home, this.deps.platform)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .slice(0, MESSAGE_CAP)
    return { code: 'widget', entry: id.slice(0, 512), detail: clean }
  }

  private fail(error: FwpError): FwpResult {
    this.patch({ state: 'failed', progress: null, appId: null, error })
    return { ok: false, error }
  }

  private log(line: string): void {
    const log = this.snap.log
    log.push(line)
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
    if (this.logTimer) return
    this.logTimer = setTimeout(() => {
      this.logTimer = null
      this.deps.emit(this.get())
    }, this.deps.logFlushMs ?? 100)
  }

  private patch(next: Partial<FwpSnapshot>): void {
    this.snap = { ...this.snap, ...next }
    this.deps.emit(this.get())
  }
}

async function readText(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch(() => null)
}
