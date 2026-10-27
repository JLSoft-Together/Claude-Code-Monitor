import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSpawnQueue } from './spawnQueue'

const flush = () => new Promise<void>((r) => queueMicrotask(r))

describe('spawn queue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts at most the limit and lets the next one go after the hold', async () => {
    const q = createSpawnQueue(2, 1000)
    const order: number[] = []
    const tickets = [0, 1, 2, 3].map((i) => {
      const tk = q.enter(false)
      void tk.started.then((ok) => ok && order.push(i))
      return tk
    })
    await flush()
    expect(order).toEqual([0, 1])
    tickets[0]!.release()
    await flush()
    expect(order).toEqual([0, 1])
    vi.advanceTimersByTime(1000)
    await flush()
    expect(order).toEqual([0, 1, 2])
    tickets[1]!.release(false)
    await flush()
    expect(order).toEqual([0, 1, 2, 3])
    expect(q.waiting).toBe(0)
  })

  it('lets visible panes jump the line', async () => {
    const q = createSpawnQueue(1, 0)
    const order: string[] = []
    const a = q.enter(false)
    q.enter(false).started.then((ok) => ok && order.push('b'))
    const c = q.enter(false)
    void c.started.then((ok) => ok && order.push('c'))
    q.enter(true).started.then((ok) => ok && order.push('d'))
    c.promote()
    a.release(false)
    await flush()
    expect(order).toEqual(['c'])
  })

  it('drops a cancelled wait without taking a slot', async () => {
    const q = createSpawnQueue(1, 0)
    const a = q.enter(false)
    const b = q.enter(false)
    b.release()
    await expect(b.started).resolves.toBe(false)
    a.release(false)
    expect(q.running).toBe(0)
    expect(q.waiting).toBe(0)
  })
})
