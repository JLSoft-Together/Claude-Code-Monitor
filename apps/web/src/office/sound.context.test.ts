import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorldApi } from '@ccm/habblaud/client/src/world/api'

// Real SoundBoard, fake AudioContext: counts how many contexts the office opens across world rebuilds.
const ctx = vi.hoisted(() => ({ made: 0 }))
class FakeAudioContext {
  state = 'running'
  sampleRate = 8000
  currentTime = 0
  destination = {}
  constructor() {
    ctx.made++
  }
  createDynamicsCompressor() {
    const p = () => ({ value: 0 })
    return { threshold: p(), knee: p(), ratio: p(), connect: () => {} }
  }
  createBuffer() {
    throw new Error('no buffers in the fake')
  }
  resume() {
    return Promise.resolve()
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('office sound board', () => {
  it('opens one AudioContext for the app across several world mounts', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const { createOfficeSound } = await import('./sound')
    for (let i = 0; i < 4; i++) {
      const world = { onSound: () => () => {} } as unknown as WorldApi
      const s = createOfficeSound(world, { enabled: () => true })
      window.dispatchEvent(new Event('pointerdown'))
      s.dispose()
    }
    expect(ctx.made).toBe(1)
  })
})
