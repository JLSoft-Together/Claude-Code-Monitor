export interface SpawnTicket {
  readonly started: Promise<boolean>
  promote(): void
  release(settle?: boolean): void
}

export interface SpawnQueue {
  enter(urgent: boolean): SpawnTicket
  readonly running: number
  readonly waiting: number
}

interface Entry {
  urgent: boolean
  state: 'waiting' | 'running' | 'done'
  start: (ok: boolean) => void
}

export function createSpawnQueue(limit: number, holdMs: number): SpawnQueue {
  let running = 0
  const waiting: Entry[] = []

  function pump(): void {
    while (running < limit && waiting.length) {
      const i = waiting.findIndex((e) => e.urgent)
      const entry = waiting.splice(i < 0 ? 0 : i, 1)[0]!
      entry.state = 'running'
      running++
      entry.start(true)
    }
  }

  function enter(urgent: boolean): SpawnTicket {
    let start!: (ok: boolean) => void
    const started = new Promise<boolean>((resolve) => (start = resolve))
    const entry: Entry = { urgent, state: 'waiting', start }
    let timer: ReturnType<typeof setTimeout> | null = null
    waiting.push(entry)
    pump()
    return {
      started,
      promote() {
        if (entry.state === 'waiting') entry.urgent = true
      },
      release(settle = true) {
        if (entry.state === 'done') return
        if (entry.state === 'waiting') {
          entry.state = 'done'
          waiting.splice(waiting.indexOf(entry), 1)
          entry.start(false)
          return
        }
        const finish = (): void => {
          if (entry.state === 'done') return
          entry.state = 'done'
          running--
          pump()
        }
        if (timer) clearTimeout(timer)
        timer = settle ? setTimeout(finish, holdMs) : null
        if (!settle) finish()
      },
    }
  }

  return {
    enter,
    get running() {
      return running
    },
    get waiting() {
      return waiting.length
    },
  }
}

export const spawnQueue = createSpawnQueue(2, 1500)
