import type { ChildProcess } from 'node:child_process'
import { readAdbFrames } from '../parse'
import { killTree, type Spawner } from '../proc'
import { collect } from '../collect'

export interface AdbWatchTiming {
  firstListMs: number
  pollMs: number
  restartWindowMs: number
  maxRestarts: number
  pollTimeoutMs: number
}

export interface AdbWatchOpts<T> {
  spawn: Spawner
  cwd: string
  adb: () => Promise<string | null>
  parse: (body: string) => T[]
  timing?: Partial<AdbWatchTiming>
  /** Kills the tracker / a timed-out poll; killTree by default. */
  kill?: (child: ChildProcess, sync: boolean) => void
}

export interface AdbWatch<T> {
  list(): Promise<T[]>
  onChange(cb: (items: T[]) => void): () => void
  stop(sync?: boolean): void
}

const TIMING = {
  firstListMs: 3_000,
  pollMs: 3_000,
  restartWindowMs: 5 * 60_000,
  maxRestarts: 3,
  pollTimeoutMs: 10_000,
}

export function createAdbWatch<T>(opts: AdbWatchOpts<T>): AdbWatch<T> {
  const t = { ...TIMING, ...opts.timing }
  const kill = opts.kill ?? killTree
  let items: T[] = []
  let started: Promise<void> | null = null
  let gotFirst = false
  let firstWaiters: (() => void)[] = []
  let tracker: ChildProcess | null = null
  let restarts: number[] = []
  let polling = false
  let pollTimer: NodeJS.Timeout | null = null
  let stopped = false
  const listeners = new Set<(d: T[]) => void>()

  const publish = (next: T[]): void => {
    const changed = JSON.stringify(items) !== JSON.stringify(next)
    items = next
    if (!gotFirst) {
      gotFirst = true
      for (const w of firstWaiters) w()
      firstWaiters = []
    }
    if (changed) for (const cb of listeners) cb(items)
  }

  const pollOnce = async (): Promise<void> => {
    const adb = await opts.adb()
    if (!adb) return publish([])
    const r = await collect(opts.spawn, adb, ['devices', '-l'], opts.cwd, { timeoutMs: t.pollTimeoutMs, kill })
    if (r.code === 0) publish(opts.parse(r.out))
  }

  const schedulePoll = (): void => {
    if (pollTimer || stopped || !polling || !listeners.size) return
    pollTimer = setTimeout(() => {
      pollTimer = null
      void pollOnce().finally(schedulePoll)
    }, t.pollMs)
  }

  const startTracker = (adb: string): void => {
    let child: ChildProcess
    try {
      child = opts.spawn({ file: adb, args: ['track-devices', '-l'], cwd: opts.cwd })
    } catch {
      return onTrackerExit()
    }
    tracker = child
    let buf = ''
    child.stdout?.on('data', (d: Buffer | string) => {
      try {
        const { frames, rest } = readAdbFrames(buf + d.toString())
        // A frame is at most 4 + 0xffff chars; anything longer is not adb framing.
        buf = rest.length > 4 + 0xffff ? '' : rest
        const last = frames[frames.length - 1]
        if (last !== undefined) publish(opts.parse(last))
      } catch {
        buf = ''
      }
    })
    child.stderr?.on('data', () => undefined)
    let exited = false
    const exit = (): void => {
      if (exited) return
      exited = true
      if (tracker === child) tracker = null
      onTrackerExit()
    }
    child.once('error', exit)
    child.once('close', exit)
  }

  const onTrackerExit = (): void => {
    if (stopped) return
    const now = Date.now()
    restarts = restarts.filter((at) => now - at < t.restartWindowMs)
    if (restarts.length < t.maxRestarts) {
      restarts.push(now)
      void opts.adb().then((adb) => {
        if (adb && !stopped) startTracker(adb)
      })
      return
    }
    polling = true
    void pollOnce().finally(schedulePoll)
  }

  const start = (): Promise<void> =>
    (started ??= opts.adb().then((adb) => {
      if (stopped) return
      if (!adb) return publish([])
      startTracker(adb)
    }))

  const waitFirst = (): Promise<void> =>
    gotFirst
      ? Promise.resolve()
      : new Promise((resolve) => {
          const timer = setTimeout(resolve, t.firstListMs)
          firstWaiters.push(() => {
            clearTimeout(timer)
            resolve()
          })
        })

  return {
    async list() {
      await start()
      await waitFirst()
      return items
    },
    onChange(cb) {
      listeners.add(cb)
      void start()
      schedulePoll()
      return () => {
        listeners.delete(cb)
        if (!listeners.size && pollTimer) {
          clearTimeout(pollTimer)
          pollTimer = null
        }
      }
    },
    stop(sync = false) {
      stopped = true
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = null
      listeners.clear()
      if (tracker) kill(tracker, sync)
      tracker = null
    },
  }
}
