import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { FrameParser, RpcClient, RpcError } from './rpc'
import { JAR_NAME } from './download'
import type { DaemonDrawableResult, DaemonRenderResult, DaemonState, JdkStatus, LayoutDevice } from './types'

export interface DaemonChild {
  stdin: Writable | null
  stdout: Readable | null
  stderr: Readable | null
  pid?: number
  exitCode: number | null
  on(event: 'exit', cb: (code: number | null) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

export interface DaemonDeps {
  spawn: (java: string, args: string[], cwd: string) => DaemonChild
  findJava: () => Promise<JdkStatus & { java?: string }>
  daemonJar: string
  layoutlibDir: () => string
  cacheDir: string
  platform: NodeJS.Platform
  kill: (child: DaemonChild) => void
  log?: (level: string, message: string) => void
  onState?: (state: DaemonState, detail?: string) => void
  renderTimeoutMs?: number
  initTimeoutMs?: number
  idleMs?: number
  maxRestarts?: number
  restartWindowMs?: number
  now?: () => number
}

export interface RenderParams {
  layoutPath: string
  xmlContent: string
  device: LayoutDevice
  theme: string | null
  night: boolean
  locale: string | null
}

export interface DrawableParams {
  path: string
  xmlContent: string
  device: LayoutDevice
  night: boolean
  states: string[]
  colorList: boolean
}

export class LayoutError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code)
  }
}

const PROTOCOL_VERSION = 1
const CANCELLED = -32800

export function daemonArgs(daemonJar: string, layoutlibDir: string, platform: NodeJS.Platform): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const sep = platform === 'win32' ? ';' : ':'
  return [
    '-Xmx1g',
    '-XX:+EnableDynamicAgentLoading',
    '-Djdk.attach.allowAttachSelf=true',
    '-cp',
    `${daemonJar}${sep}${p.join(layoutlibDir, JAR_NAME)}`,
    'dev.ccm.layoutdaemon.MainKt',
    '--layoutlib',
    layoutlibDir,
  ]
}

interface Live {
  child: DaemonChild
  rpc: RpcClient
  ready: Promise<void>
  stopping: boolean
}

/** One warm layoutlib JVM: lazy start, per-render watchdog, crash restart budget, idle shutdown. */
export class LayoutDaemon {
  private live: Live | null = null
  private current: DaemonState = 'stopped'
  private restarts: number[] = []
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private seq = 0
  private slots = new Map<string, string>()
  private inFlight = 0
  private starting: Promise<void> | null = null
  private restartPending = false
  private api: number | null = null

  constructor(private readonly deps: DaemonDeps) {}

  get state(): DaemonState {
    return this.current
  }

  /** API level reported by `initialize`; null before the first start. */
  get apiLevel(): number | null {
    return this.api
  }

  private set(state: DaemonState, detail?: string): void {
    if (state === this.current && !detail) return
    this.current = state
    this.deps.onState?.(state, detail)
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private budgetLeft(): boolean {
    const window = this.deps.restartWindowMs ?? 5 * 60_000
    const since = this.now() - window
    this.restarts = this.restarts.filter((t) => t > since)
    return this.restarts.length < (this.deps.maxRestarts ?? 3)
  }

  ensure(): Promise<void> {
    if (this.live && !this.live.stopping) return this.live.ready
    if (this.starting) return this.starting
    if (this.current === 'failed' && !this.budgetLeft()) return Promise.reject(new LayoutError('crash-loop'))
    const starting = this.start().finally(() => {
      if (this.starting === starting) this.starting = null
    })
    this.starting = starting
    return starting
  }

  private async start(): Promise<void> {
    this.set('starting')
    const jdk = await this.deps.findJava()
    if (!jdk.ok || !jdk.java) {
      this.set('stopped')
      throw new LayoutError(jdk.ok ? 'jdk-missing' : jdk.code, jdk.ok ? undefined : jdk.detail)
    }
    const dir = this.deps.layoutlibDir()
    let child: DaemonChild
    try {
      child = this.deps.spawn(jdk.java, daemonArgs(this.deps.daemonJar, dir, this.deps.platform), this.deps.cacheDir)
    } catch (err) {
      this.set('stopped')
      throw new LayoutError('spawn-failed', err instanceof Error ? err.message : String(err))
    }
    const rpc = new RpcClient(
      (buf) => {
        if (!child.stdin || child.stdin.destroyed) throw new LayoutError('crashed')
        child.stdin.write(buf)
      },
      (method, params) => {
        if (method !== 'log') return
        const p = (params ?? {}) as { level?: unknown; message?: unknown }
        this.deps.log?.(String(p.level ?? 'info'), String(p.message ?? '').slice(0, 2000))
      },
    )
    const live: Live = { child, rpc, ready: Promise.resolve(), stopping: false }
    this.live = live
    const parser = new FrameParser()
    child.stdout?.on('data', (chunk: Buffer) => {
      try {
        for (const msg of parser.push(chunk)) rpc.handle(msg)
      } catch (err) {
        this.deps.log?.('error', `protocol: ${err instanceof Error ? err.message : String(err)}`)
        this.deps.kill(child)
      }
    })
    let errTail = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      errTail = (errTail + chunk.toString('utf8')).slice(-4000)
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim()) this.deps.log?.('stderr', line.slice(0, 2000))
    })
    child.stdin?.on('error', () => undefined)
    child.on('error', (err) => this.deps.log?.('error', `spawn: ${err.message}`))
    child.on('exit', (code) => this.onExit(live, code, errTail))

    live.ready = this.withTimeout(
      rpc.request('initialize', { protocolVersion: PROTOCOL_VERSION, cacheDir: this.deps.cacheDir }),
      this.deps.initTimeoutMs ?? 60_000,
      () => this.deps.kill(child),
    ).then(
      (res) => {
        if (this.live !== live) throw new LayoutError('crashed')
        const r = (res ?? {}) as { initMs?: unknown; layoutlibVersion?: unknown; apiLevel?: unknown }
        if (typeof r.apiLevel === 'number' && Number.isInteger(r.apiLevel) && r.apiLevel > 0) this.api = r.apiLevel
        this.deps.log?.('info', `initialized layoutlib ${String(r.layoutlibVersion ?? '?')} in ${String(r.initMs ?? '?')} ms`)
        this.set('ready')
        this.touch()
      },
      (err: unknown) => {
        throw err instanceof LayoutError ? err : new LayoutError('init-failed', err instanceof Error ? err.message : String(err))
      },
    )
    live.ready.catch(() => undefined)
    return live.ready
  }

  private onExit(live: Live, code: number | null, errTail: string): void {
    live.rpc.failAll(new LayoutError('crashed', errTail.slice(-600) || `exit ${code}`))
    if (this.live !== live) return
    this.live = null
    this.clearIdle()
    if (live.stopping) {
      this.set('stopped')
      return
    }
    this.deps.log?.('error', `daemon exited with ${code}`)
    this.restarts.push(this.now())
    if (!this.budgetLeft()) {
      this.set('failed', 'crash-loop')
      return
    }
    this.set('stopped', 'crashed')
    // Warm again so the next render does not pay the ~3 s cold start.
    this.ensure().catch(() => undefined)
  }

  private withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new LayoutError('timeout'))
        onTimeout()
      }, ms)
      p.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e: unknown) => {
          clearTimeout(timer)
          reject(e)
        },
      )
    })
  }

  /** `slot` (one per pane / file): a newer render cancels the older one still queued, a stale finished one is dropped. */
  render(params: RenderParams, slot: string): Promise<DaemonRenderResult> {
    return this.slotted('render', slot, (requestId) => ({
      requestId,
      layoutPath: params.layoutPath,
      xmlContent: params.xmlContent,
      device: params.device,
      night: params.night,
      ...(params.theme ? { theme: params.theme } : {}),
      ...(params.locale ? { locale: params.locale } : {}),
    })) as Promise<DaemonRenderResult>
  }

  /** `drawable/render`: same slot / cancel / watchdog rules as a layout render. */
  renderDrawable(params: DrawableParams, slot: string): Promise<DaemonDrawableResult> {
    return this.slotted('drawable/render', slot, (requestId) => ({ requestId, ...params })) as Promise<DaemonDrawableResult>
  }

  private async slotted(method: string, slot: string, payload: (requestId: string) => Record<string, unknown>): Promise<unknown> {
    const requestId = `r${++this.seq}`
    const prev = this.slots.get(slot)
    this.slots.set(slot, requestId)
    this.inFlight++
    this.clearIdle()
    try {
      await this.ensure()
      const live = this.live
      if (!live) throw new LayoutError('crashed')
      if (prev) live.rpc.request('cancel', { requestId: prev }).catch(() => undefined)
      if (this.slots.get(slot) !== requestId) throw new LayoutError('cancelled')
      const res = await this.withTimeout(
        live.rpc.request(method, payload(requestId)),
        this.deps.renderTimeoutMs ?? 15_000,
        () => {
          this.deps.log?.('error', `render ${requestId} exceeded the watchdog, restarting the daemon`)
          this.deps.kill(live.child)
        },
      ).catch((err: unknown) => {
        if (err instanceof RpcError && err.code === CANCELLED) throw new LayoutError('cancelled')
        if (err instanceof RpcError) throw new LayoutError('render-failed', err.message)
        throw err
      })
      if (this.slots.get(slot) !== requestId) throw new LayoutError('cancelled')
      return res
    } finally {
      this.inFlight--
      if (this.slots.get(slot) === requestId) this.slots.delete(slot)
      this.touch()
      this.maybeRestart()
    }
  }

  /** Any other method (`project/load`, `project/changed`); starts the JVM when needed, kills it on a hang. */
  async request(method: string, params: unknown, timeoutMs = 120_000): Promise<unknown> {
    this.inFlight++
    this.clearIdle()
    try {
      await this.ensure()
      const live = this.live
      if (!live) throw new LayoutError('crashed')
      return await this.withTimeout(live.rpc.request(method, params), timeoutMs, () => {
        this.deps.log?.('error', `${method} exceeded ${timeoutMs} ms, restarting the daemon`)
        this.deps.kill(live.child)
      }).catch((err: unknown) => {
        if (err instanceof RpcError) throw new LayoutError('request-failed', err.message)
        throw err
      })
    } finally {
      this.inFlight--
      this.touch()
      this.maybeRestart()
    }
  }

  /** `restartSuggested` (leaked project ClassLoaders): restart once nothing is in flight, then warm up again. */
  requestRestart(): void {
    this.restartPending = true
    this.maybeRestart()
  }

  private maybeRestart(): void {
    if (!this.restartPending || this.inFlight > 0) return
    this.restartPending = false
    if (!this.live || this.live.stopping) return
    this.deps.log?.('info', 'restarting the daemon (restartSuggested)')
    void this.stop().then(() => this.ensure().catch(() => undefined))
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private touch(): void {
    this.clearIdle()
    if (!this.live || this.inFlight > 0) return
    this.idleTimer = setTimeout(() => void this.stop(), this.deps.idleMs ?? 10 * 60_000)
    this.idleTimer.unref?.()
  }

  /** `shutdown`, stdin EOF, then a tree kill if the JVM is still there after 3 s. */
  async stop(): Promise<void> {
    const live = this.live
    this.clearIdle()
    if (!live || live.stopping) return
    live.stopping = true
    await this.withTimeout(live.rpc.request('shutdown', null), 2_000, () => undefined).catch(() => undefined)
    live.child.stdin?.end()
    if (live.child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.deps.kill(live.child)
        resolve()
      }, 3_000)
      live.child.on('exit', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  /** App quit: no waiting. */
  killNow(): void {
    const live = this.live
    this.clearIdle()
    if (!live) return
    live.stopping = true
    this.deps.kill(live.child)
  }
}
