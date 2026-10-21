import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoundCue, WorldApi } from '@ccm/habblaud/client/src/world/api'

const board = vi.hoisted(() => ({ configure: vi.fn(), unlock: vi.fn(() => Promise.resolve()), play: vi.fn(() => true) }))
const made = vi.hoisted(() => ({ n: 0 }))
vi.mock('@ccm/habblaud/client/src/audio/board', () => ({
  SoundBoard: function () {
    made.n++
    return board
  },
}))

import { createOfficeSound } from './sound'

function fakeWorld() {
  let cb: ((c: SoundCue) => void) | null = null
  const off = vi.fn()
  const world = { onSound: vi.fn((f: (c: SoundCue) => void) => ((cb = f), off)) } as unknown as WorldApi
  return { world, off, emit: (c: SoundCue) => cb?.(c) }
}
const live: { dispose(): void }[] = []
const create = (...a: Parameters<typeof createOfficeSound>) => {
  const s = createOfficeSound(...a)
  live.push(s)
  return s
}
const cue: SoundCue = { kind: 'keys', gain: 0.5, pan: 0, count: 3 }

describe('createOfficeSound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })


  afterEach(() => live.splice(0).forEach((s) => s.dispose()))

  it('schedules nothing while disabled', () => {
    const w = fakeWorld()
    create(w.world, { enabled: () => false })
    window.dispatchEvent(new Event('pointerdown'))
    w.emit(cue)
    expect(board.play).not.toHaveBeenCalled()
    expect(board.unlock).not.toHaveBeenCalled()
  })

  it('plays through the scheduler once enabled and unlocked by a gesture', () => {
    const w = fakeWorld()
    create(w.world, { enabled: () => true })
    window.dispatchEvent(new Event('pointerdown'))
    w.emit(cue)
    expect(board.unlock).toHaveBeenCalled()
    expect(board.configure).toHaveBeenLastCalledWith(true, expect.objectContaining({ volume: expect.any(Number) }))
    expect(board.play).toHaveBeenCalledWith('keys', cue)
  })

  it('stays silent while the document is hidden', () => {
    const w = fakeWorld()
    create(w.world, { enabled: () => true })
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    w.emit(cue)
    expect(board.play).not.toHaveBeenCalled()
  })

  it('shares one board across create / dispose cycles', () => {
    for (let i = 0; i < 3; i++) create(fakeWorld().world, { enabled: () => true }).dispose()
    expect(made.n).toBe(1)
  })

  it('dispose unsubscribes and removes the gesture listeners', () => {
    const w = fakeWorld()
    const s = create(w.world, { enabled: () => true })
    s.dispose()
    expect(w.off).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('keydown'))
    expect(board.unlock).not.toHaveBeenCalled()
  })
})
