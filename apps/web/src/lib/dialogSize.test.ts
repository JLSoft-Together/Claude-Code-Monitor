import { beforeEach, describe, expect, it } from 'vitest'
import { clampDialogSize, readDialogSize, saveDialogSize } from './dialogSize'

describe('dialog size', () => {
  beforeEach(() => localStorage.clear())

  it('clamps between the minimum and the window', () => {
    const min = { w: 560, h: 400 }
    const view = { w: 1200, h: 800 }
    expect(clampDialogSize(100, 100, min, view, 16)).toEqual({ w: 560, h: 400 })
    expect(clampDialogSize(5000, 5000, min, view, 16)).toEqual({ w: 1168, h: 768 })
    expect(clampDialogSize(900.4, 600.6, min, view, 16)).toEqual({ w: 900, h: 601 })
  })

  it('keeps the minimum when the window is smaller', () => {
    expect(clampDialogSize(900, 900, { w: 560, h: 400 }, { w: 300, h: 300 }, 16)).toEqual({ w: 560, h: 400 })
  })

  it('round trips and resets', () => {
    saveDialogSize('ccm.test', { w: 900, h: 700 })
    expect(readDialogSize('ccm.test')).toEqual({ w: 900, h: 700 })
    saveDialogSize('ccm.test', null)
    expect(readDialogSize('ccm.test')).toBeNull()
    localStorage.setItem('ccm.test', '{"w":"x"}')
    expect(readDialogSize('ccm.test')).toBeNull()
  })
})
