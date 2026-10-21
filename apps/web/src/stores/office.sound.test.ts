import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@ccm/habblaud/client/src/audio/board', () => ({
  SoundBoard: function () { return { configure: () => {}, unlock: () => Promise.resolve(), play: () => true } },
}))

import { DEFAULT_OFFICE_VOLUME, OFFICE_SOUND_KEY, OFFICE_VOLUME_KEY, useOfficeStore } from './office'

describe('office sound toggle', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('is off by default and persists the choice', () => {
    const o = useOfficeStore()
    expect(o.sound).toBe(false)
    o.setSound(true)
    expect(localStorage.getItem(OFFICE_SOUND_KEY)).toBe('1')
    setActivePinia(createPinia())
    expect(useOfficeStore().sound).toBe(true)
  })
})

describe('office sound volume', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('starts at the default and persists the slider', () => {
    const o = useOfficeStore()
    expect(o.volume).toBe(DEFAULT_OFFICE_VOLUME)
    o.setVolume(0.85)
    expect(localStorage.getItem(OFFICE_VOLUME_KEY)).toBe('0.85')
    setActivePinia(createPinia())
    expect(useOfficeStore().volume).toBe(0.85)
  })

  it('clamps to 0..1 and ignores a corrupted saved value', () => {
    const o = useOfficeStore()
    o.setVolume(3)
    expect(o.volume).toBe(1)
    o.setVolume(-1)
    expect(o.volume).toBe(0)
    o.setVolume(Number.NaN)
    expect(o.volume).toBe(0)
    localStorage.setItem(OFFICE_VOLUME_KEY, 'loud')
    setActivePinia(createPinia())
    expect(useOfficeStore().volume).toBe(DEFAULT_OFFICE_VOLUME)
  })

  it('turns the sound on when the slider moves above zero, never off', () => {
    const o = useOfficeStore()
    o.setVolume(0)
    expect(o.sound).toBe(false)
    o.setVolume(0.4)
    expect(o.sound).toBe(true)
    o.setVolume(0)
    expect(o.sound).toBe(true)
  })
})
