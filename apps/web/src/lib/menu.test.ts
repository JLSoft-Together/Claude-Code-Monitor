import { describe, expect, it } from 'vitest'
import { findAction, menuPosition, submenuPosition, type MenuEntry } from './menu'

const at = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y })

describe('menu placement', () => {
  it('opens right/below the cursor', () => {
    expect(menuPosition(at(100, 100), 200, 300, 1000, 800)).toEqual({ left: 100, top: 100, origin: 'left top' })
  })
  it('flips left/up near the window edges and stays 8px inside', () => {
    expect(menuPosition(at(900, 700), 200, 300, 1000, 800)).toEqual({ left: 700, top: 400, origin: 'right bottom' })
    expect(menuPosition(at(50, 100), 200, 900, 1000, 800).top).toBe(8)
  })
  it('keeps the whole menu inside the window: top within [8, vh - 8 - h]', () => {
    // Flipped up from a row near the bottom, the menu still fits: bottom edge at most vh - 8.
    const row = { left: 100, right: 300, top: 760, bottom: 790 }
    const p = menuPosition(row, 200, 500, 1000, 800)
    expect(p.top).toBe(260)
    expect(p.top + 500).toBeLessThanOrEqual(792)
    // Taller than the room above and below the cursor: pinned at the top margin.
    expect(menuPosition(at(100, 400), 200, 600, 1000, 800).top).toBe(8)
    // A cursor inside the bottom margin: flipping up from it alone would leave the menu poking past vh - 8.
    expect(menuPosition(at(100, 798), 200, 100, 1000, 800).top).toBe(692)
    expect(menuPosition(at(100, 790), 200, 784, 1000, 800).top).toBe(8)
    // Narrower window than the menu: pinned at the left margin.
    expect(menuPosition(at(50, 100), 200, 100, 180, 800).left).toBe(8)
  })
  it('puts a submenu beside its row, on the left when the right has no room', () => {
    const row = { left: 100, right: 300, top: 200, bottom: 228 }
    expect(submenuPosition(row, 220, 100, 1000, 800)).toEqual({ left: 300, top: 196 })
    expect(submenuPosition({ ...row, left: 700, right: 900 }, 220, 100, 1000, 800)).toEqual({ left: 480, top: 196 })
    expect(submenuPosition(row, 220, 700, 1000, 800).top).toBe(92)
  })
})

describe('findAction', () => {
  const entries: MenuEntry[] = [{ id: 'a', label: 'A' }, { separator: true }, { id: 'p', label: 'P', children: [{ id: 'c', label: 'C', disabled: true }] }]
  it('finds nested actions', () => {
    expect(findAction(entries, 'c')).toMatchObject({ id: 'c', disabled: true })
    expect(findAction(entries, 'zz')).toBeNull()
  })
})
