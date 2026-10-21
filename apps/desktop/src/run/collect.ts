import type { ChildProcess } from 'node:child_process'
import { killTree, type Spawner } from './proc'

export interface Collected {
  code: number | null
  out: string
  /** True only when the timeout fired. */
  timedOut?: boolean
}

/** Spawns, collects stdout + stderr, resolves on close (code null when it could not start or timed out). */
export function collect(
  spawn: Spawner,
  file: string,
  args: string[],
  cwd: string,
  opts: { timeoutMs?: number; env?: Record<string, string>; track?: (child: ChildProcess, done: boolean) => void } = {},
): Promise<Collected> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn({ file, args, cwd, env: opts.env })
    } catch {
      resolve({ code: null, out: '' })
      return
    }
    opts.track?.(child, false)
    let out = ''
    let settled = false
    const finish = (code: number | null, timedOut = false): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.track?.(child, true)
      resolve(timedOut ? { code, out, timedOut } : { code, out })
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          killTree(child)
          finish(null, true)
        }, opts.timeoutMs)
      : null
    child.stdout?.on('data', (d: Buffer | string) => (out += d.toString()))
    child.stderr?.on('data', (d: Buffer | string) => (out += d.toString()))
    child.once('error', () => finish(null))
    child.once('close', (code: number | null) => finish(code))
  })
}
