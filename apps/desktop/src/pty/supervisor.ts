import { randomBytes } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { MCP_TOOL_ACTION, type OrreryCaller } from '../../../../packages/shared/src/orreryApi'
import { PTY_PROTOCOL_PREFIX, type PaneOpenRequest, type PtyEndpoint, type PtySessionInfo } from '../../../../packages/shared/src/pty'
import { paneOpenResult } from '../openLink'

export interface PtySupervisorOptions {
  script: string
  nodePty: string
  origins: string[]
  logFile: string
  /** zsh startup wrappers that report the current folder (posix only). */
  shellInitDir?: string
  /** Orrery dispatcher: `open_session` and every MCP tool the host cannot answer alone; the host re-checks each reply. */
  onOrrery?: (action: string, args: unknown, caller: OrreryCaller) => Promise<unknown>
  mcpConfig?: string
}

const START_TIMEOUT_MS = 10_000
const CENSUS_TIMEOUT_MS = 1_500
const STOP_TIMEOUT_MS = 3_000

/**
 * Owns the PTY utility process. Started lazily on the first terminal so users who never open the
 * workspace pay nothing; the token is fresh per process and only reaches pages through the preload.
 */
export class PtySupervisor {
  private child: UtilityProcess | null = null
  private starting: Promise<PtyEndpoint> | null = null
  private log: WriteStream | null = null
  private token = ''
  private censusWaiters: ((sessions: PtySessionInfo[]) => void)[] = []
  private stopped = false

  constructor(private readonly opts: PtySupervisorOptions) {}

  endpoint(): Promise<PtyEndpoint> {
    if (this.stopped) return Promise.reject(new Error('pty host stopped'))
    this.starting ??= this.start().catch((err: unknown) => {
      this.starting = null
      throw err
    })
    return this.starting
  }

  private start(): Promise<PtyEndpoint> {
    this.token = randomBytes(32).toString('hex')
    this.log ??= createWriteStream(this.opts.logFile, { flags: 'w' })
    const child = utilityProcess.fork(this.opts.script, [], {
      env: {
        ...process.env,
        CCM_PTY_TOKEN: this.token,
        CCM_PTY_ORIGINS: this.opts.origins.join(','),
        CCM_NODE_PTY: this.opts.nodePty,
        CCM_APP_VERSION: app.getVersion(),
        ...(this.opts.shellInitDir ? { CCM_PTY_INIT_DIR: this.opts.shellInitDir } : {}),
        ...(this.opts.mcpConfig ? { CCM_PTY_MCP_CONFIG: this.opts.mcpConfig } : {}),
      },
      stdio: 'pipe',
      serviceName: 'Orrery terminals',
    })
    const write = (buf: Buffer): void => void this.log?.write(buf)
    child.stdout?.on('data', write)
    child.stderr?.on('data', write)
    this.child = child
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('pty host did not start'))
      }, START_TIMEOUT_MS)
      child.on('message', (data: { t?: string; port?: number; sessions?: PtySessionInfo[]; req?: PaneOpenRequest; call?: { id?: unknown; tool?: unknown; from?: unknown } }) => {
        if (data?.t === 'open' && typeof data.req?.id === 'string') this.relayOpen(child, data.req)
        else if ((data?.t === 'mcp' || data?.t === 'mcp-desk') && typeof data.call?.id === 'string') this.relayMcp(child, data.call.id, data.call)
        else if (data?.t === 'listening' && data.port) {
          clearTimeout(timer)
          resolve({ url: `ws://127.0.0.1:${data.port}/pty`, protocol: `${PTY_PROTOCOL_PREFIX}${this.token}` })
        } else if (data?.t === 'census') {
          const waiters = this.censusWaiters
          this.censusWaiters = []
          for (const w of waiters) w(data.sessions ?? [])
        }
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        this.log?.write(`pty host exited (code ${code})\n`)
        if (this.child === child) {
          this.child = null
          this.starting = null
        }
        for (const w of this.censusWaiters.splice(0)) w([])
        reject(new Error(`pty host exited (${code})`))
      })
    })
  }

  private relayOpen(child: UtilityProcess, req: PaneOpenRequest): void {
    void Promise.resolve()
      .then(() => this.opts.onOrrery?.('session.open', req, { source: 'mcp', ...(req.from ? { pane: req.from } : {}) }) ?? { ok: false, error: 'unavailable' })
      .then(paneOpenResult, () => paneOpenResult(null))
      .then((result) => {
        if (this.child === child) child.postMessage({ t: 'open-reply', id: req.id, result })
      })
  }

  private relayMcp(child: UtilityProcess, id: string, call: { tool?: unknown; from?: unknown }): void {
    const action = typeof call.tool === 'string' && Object.hasOwn(MCP_TOOL_ACTION, call.tool) ? MCP_TOOL_ACTION[call.tool as keyof typeof MCP_TOOL_ACTION] : null
    const caller: OrreryCaller = { source: 'mcp', ...(typeof call.from === 'string' && call.from ? { pane: call.from } : {}) }
    void Promise.resolve()
      .then(() => (action && this.opts.onOrrery?.(action, call, caller)) || { ok: false, error: action ? 'unavailable' : 'failed' })
      .catch(() => ({ ok: false, error: 'failed' }))
      .then((result) => {
        if (this.child === child) child.postMessage({ t: 'mcp-reply', id, result })
      })
  }

  /** Live terminals, for the quit confirmation. Empty when the host never started; null when it did not answer. */
  census(): Promise<PtySessionInfo[] | null> {
    const child = this.child
    if (!child) return Promise.resolve([])
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), CENSUS_TIMEOUT_MS)
      this.censusWaiters.push((sessions) => {
        clearTimeout(timer)
        resolve(sessions.filter((s) => s.alive))
      })
      child.postMessage('census')
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    const child = this.child
    if (!child) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.postMessage('shutdown')
    const timer = setTimeout(() => child.kill(), STOP_TIMEOUT_MS)
    await Promise.race([exited, new Promise((r) => setTimeout(r, STOP_TIMEOUT_MS + 1_000))])
    clearTimeout(timer)
    this.log?.end()
    this.log = null
  }
}
