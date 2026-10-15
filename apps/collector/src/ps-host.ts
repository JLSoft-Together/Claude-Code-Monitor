import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { windowsPowerShell } from './win-exe'

export type HostSpawner = (script: string, env: Record<string, string>) => ChildProcessWithoutNullStreams

export interface PsHostOptions {
  script: string
  /** Added to the host's environment at spawn. */
  env?: Record<string, string>
  timeoutMs?: number
  /** A quiet host exits after this long; the next request starts a new one. */
  idleMs?: number
  spawner?: HostSpawner
}

const defaultSpawner: HostSpawner = (script, env) =>
  spawn(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })

interface Pending {
  resolve: (value: string | null) => void
  timer: NodeJS.Timeout
}

/**
 * One long-lived PowerShell answering base64-JSON request lines with `<id>\t<result>` lines. Requests travel as data
 * on stdin, never in the script text. A crashed or hung host fails its pending requests and is respawned on the next
 * one; the host ends when its stdin closes, so it never outlives the collector.
 */
export class PsHost {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null
  private exitHooked = false
  spawns = 0

  constructor(private readonly opts: PsHostOptions) {}

  run(request: Record<string, string>): Promise<string | null> {
    const child = this.ensure()
    if (!child) return Promise.resolve(null)
    this.clearIdle()
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.settle(id, null)
        // A hung WinRT call blocks every later request behind it.
        this.stop()
      }, this.opts.timeoutMs ?? 15_000)
      timer.unref?.()
      this.pending.set(id, { resolve, timer })
      const line = Buffer.from(JSON.stringify({ ...request, id }), 'utf8').toString('base64')
      child.stdin.write(`${line}\n`, (err) => {
        if (err) this.settle(id, null)
      })
    })
  }

  stop(): void {
    const child = this.child
    this.child = null
    this.clearIdle()
    for (const id of [...this.pending.keys()]) this.settle(id, null)
    if (!child) return
    child.stdin.end()
    child.kill()
  }

  private ensure(): ChildProcessWithoutNullStreams | null {
    if (this.child) return this.child
    let child: ChildProcessWithoutNullStreams
    try {
      child = (this.opts.spawner ?? defaultSpawner)(this.opts.script, this.opts.env ?? {})
    } catch {
      return null
    }
    this.spawns++
    this.child = child
    if (!this.exitHooked) {
      this.exitHooked = true
      process.once('exit', () => this.stop())
    }
    child.on('error', () => this.dropChild(child))
    child.on('exit', () => this.dropChild(child))
    child.stdin.on('error', () => this.dropChild(child))
    child.stderr.resume()
    createInterface({ input: child.stdout }).on('line', (line) => {
      const tab = line.indexOf('\t')
      if (tab > 0) this.settle(Number(line.slice(0, tab)), line.slice(tab + 1).trim())
    })
    return child
  }

  private dropChild(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = null
    this.clearIdle()
    for (const id of [...this.pending.keys()]) this.settle(id, null)
  }

  private settle(id: number, value: string | null): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(value)
    if (this.pending.size === 0 && this.child) this.armIdle()
  }

  private armIdle(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => this.stop(), this.opts.idleMs ?? 10 * 60_000)
    this.idleTimer.unref?.()
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }
}
