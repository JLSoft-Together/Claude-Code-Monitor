import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@ccm/habblaud/client/src/audio/board', () => ({
  SoundBoard: function () { return { configure: () => {}, unlock: () => Promise.resolve(), play: () => true } },
}))

import { OFFICE_SOUND_KEY, useOfficeStore } from './office'

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
