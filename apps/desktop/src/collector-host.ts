import { createWriteStream, type WriteStream } from 'node:fs'
import { utilityProcess, type UtilityProcess } from 'electron'

export interface CollectorHostOptions {
  script: string
  port: number
  env: NodeJS.ProcessEnv
  logFile: string
  onFatal: (reason: FatalReason) => void
}

export type FatalReason = { kind: 'exited'; code: number | null } | { kind: 'timeout' }

const MAX_RESTARTS = 3
const BOOT_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 4_000
const STABLE_MS = 60_000
const LOG_TAIL = 40

export async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

export class FatalError extends Error {
  constructor(readonly reason: FatalReason) {
    super(reason.kind)
  }
}

/** Runs the bundled collector in an Electron utility process, restarting it a few times if it dies. */
export class CollectorHost {
  private child: UtilityProcess | null = null
  private restarts = 0
  private stopping = false
  private log: WriteStream | null = null
  private lastExit: number | null | undefined
  readonly tail: string[] = []
  /** True when another collector (e.g. the .bat launcher) already serves the port. */
  external = false

  constructor(private readonly opts: CollectorHostOptions) {}

  async start(): Promise<void> {
    if (this.child) await this.stop()
    this.stopping = false
    this.restarts = 0
    this.external = await isHealthy(this.opts.port)
    if (this.external) return
    this.log ??= createWriteStream(this.opts.logFile, { flags: 'w' })
    this.spawn()
    await this.waitHealthy()
  }

  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) return
    const exited = new Promise<'exited'>((resolve) => child.once('exit', () => resolve('exited')))
    const within = (ms: number): Promise<'exited' | 'timeout'> => {
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), ms)))
      return Promise.race([exited, timeout]).finally(() => clearTimeout(timer))
    }
    child.postMessage('shutdown')
    if ((await within(STOP_TIMEOUT_MS)) === 'timeout') {
      child.kill()
      await within(1_000)
    }
    this.log?.end()
    this.log = null
  }

  private spawn(): void {
    this.lastExit = undefined
    const spawnedAt = Date.now()
    const child = utilityProcess.fork(this.opts.script, [], {
      env: { ...this.opts.env, FORCE_COLOR: '0' },
      stdio: 'pipe',
      serviceName: 'Claude Code Monitor collector',
    })
    const onData = (buf: Buffer): void => {
      for (const line of String(buf).split(/\r?\n/)) if (line.trim()) this.write(line)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('exit', (code) => {
      if (this.child === child) this.child = null
      this.lastExit = code
      this.write(`collector exited (code ${code})`)
      if (this.stopping) return
      // Only a crash loop is fatal; a collector that ran for a while gets a fresh restart budget.
      if (Date.now() - spawnedAt > STABLE_MS) this.restarts = 0
      if (this.restarts >= MAX_RESTARTS) return this.opts.onFatal({ kind: 'exited', code })
      this.restarts++
      this.spawn()
      this.waitHealthy().catch((err: unknown) => {
        if (err instanceof FatalError && !this.stopping) this.opts.onFatal(err.reason)
      })
    })
    this.child = child
  }

  private async waitHealthy(): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.lastExit !== undefined && this.restarts >= MAX_RESTARTS) throw new FatalError({ kind: 'exited', code: this.lastExit })
      if (await isHealthy(this.opts.port)) return
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new FatalError({ kind: 'timeout' })
  }

  private write(line: string): void {
    this.log?.write(`${line}\n`)
    this.tail.push(line)
    if (this.tail.length > LOG_TAIL) this.tail.shift()
  }
}
