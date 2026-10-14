import { describe, expect, it } from 'vitest'
import { workspaceAction } from './workspaceKeys'

const key = (code: string, mods: Partial<KeyboardEvent> = {}, altGraph = false): KeyboardEvent =>
  ({
    type: 'keydown',
    isComposing: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    code,
    getModifierState: (m: string) => m === 'AltGraph' && altGraph,
    ...mods,
  }) as unknown as KeyboardEvent

describe('workspaceAction', () => {
  it('Ctrl+Alt+digit jumps to a tab on Windows', () => {
    expect(workspaceAction(key('Digit2', { ctrlKey: true, altKey: true }), false, false)).toEqual({ t: 'tab', index: 1 })
  })

  it('leaves AltGr+digit to the keyboard layout', () => {
    expect(workspaceAction(key('Digit2', { ctrlKey: true, altKey: true }, true), false, false)).toBeNull()
  })

  it('Cmd+digit jumps to a tab on macOS', () => {
    expect(workspaceAction(key('Digit3', { metaKey: true }), true, false)).toEqual({ t: 'tab', index: 2 })
  })
})
