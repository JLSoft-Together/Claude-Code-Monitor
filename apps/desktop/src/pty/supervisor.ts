import { randomBytes } from 'node:crypto'
import { createWriteStream, type WriteStream } from 'node:fs'
import { utilityProcess, type UtilityProcess } from 'electron'
import { PTY_PROTOCOL_PREFIX, type PtyEndpoint, type PtySessionInfo } from '../../../../packages/shared/src/pty'

export interface PtySupervisorOptions {
  script: string
  nodePty: string
  origins: string[]
  logFile: string
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

  constructor(private readonly opts: PtySupervisorOptions) {}

  endpoint(): Promise<PtyEndpoint> {
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
      env: { ...process.env, CCM_PTY_TOKEN: this.token, CCM_PTY_ORIGINS: this.opts.origins.join(','), CCM_NODE_PTY: this.opts.nodePty },
      stdio: 'pipe',
      serviceName: 'Agent Monitor terminals',
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
      child.on('message', (data: { t?: string; port?: number; sessions?: PtySessionInfo[] }) => {
        if (data?.t === 'listening' && data.port) {
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
