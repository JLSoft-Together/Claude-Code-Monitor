import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { WorldApi } from '@ccm/habblaud/client/src/world/api'

const s = vi.hoisted(() => ({ disposes: [] as ReturnType<typeof vi.fn>[], worlds: [] as unknown[] }))
vi.mock('../office/sound', () => ({
  createOfficeSound: vi.fn((world: unknown) => {
    const dispose = vi.fn()
    s.worlds.push(world)
    s.disposes.push(dispose)
    return { dispose }
  }),
}))

import { useOfficeStore } from './office'

const fake = (): WorldApi => ({}) as unknown as WorldApi

describe('office store sound controller', () => {
  beforeEach(() => {
    s.disposes.length = 0
    s.worlds.length = 0
    setActivePinia(createPinia())
  })

  it('creates one controller per world and disposes it on swap and on null', () => {
    const o = useOfficeStore()
    const a = fake()
    const b = fake()
    o.world = a
    expect(s.worlds).toEqual([a])
    o.world = b
    expect(s.worlds).toEqual([a, b])
    expect(s.disposes[0]).toHaveBeenCalledTimes(1)
    expect(s.disposes[1]).not.toHaveBeenCalled()
    o.world = null
    expect(s.disposes[1]).toHaveBeenCalledTimes(1)
    expect(s.worlds).toHaveLength(2)
  })
})
