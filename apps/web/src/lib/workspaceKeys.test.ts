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

  it('maps Ctrl+Shift+O / Cmd+Shift+O to mission control', () => {
    expect(workspaceAction(key('KeyO', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'mission' })
    expect(workspaceAction(key('KeyO', { metaKey: true, shiftKey: true }), true, false)).toEqual({ t: 'mission' })
    expect(workspaceAction(key('KeyO', { ctrlKey: true }), false, false)).toBeNull()
  })

  it('Ctrl+Shift+PageUp/PageDown (⇧⌘ on macOS) moves the tab left / right', () => {
    expect(workspaceAction(key('PageUp', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'moveTab', step: -1 })
    expect(workspaceAction(key('PageDown', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'moveTab', step: 1 })
    expect(workspaceAction(key('PageDown', { metaKey: true, shiftKey: true }), true, false)).toEqual({ t: 'moveTab', step: 1 })
    expect(workspaceAction(key('PageUp', { ctrlKey: true }), false, false)).toBeNull()
    expect(workspaceAction(key('PageUp', { ctrlKey: true, shiftKey: true, altKey: true }), false, false)).toBeNull()
    expect(workspaceAction(key('PageUp', { metaKey: true }), true, false)).toBeNull()
  })

  it('Ctrl+Shift+Enter / Cmd+Shift+Enter zooms the pane', () => {
    expect(workspaceAction(key('Enter', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'zoom' })
    expect(workspaceAction(key('Enter', { metaKey: true, shiftKey: true }), true, true)).toEqual({ t: 'zoom' })
    expect(workspaceAction(key('Enter', { shiftKey: true }), false, true)).toBeNull()
    expect(workspaceAction(key('Enter', { ctrlKey: true }), false, true)).toBeNull()
    expect(workspaceAction(key('Enter', { metaKey: true }), true, true)).toBeNull()
    expect(workspaceAction(key('Enter', { ctrlKey: true, shiftKey: true }), true, true)).toBeNull()
  })

  it('reopens the last closed pane: Cmd+Shift+T on macOS, Ctrl+Shift+Z elsewhere', () => {
    expect(workspaceAction(key('KeyT', { metaKey: true, shiftKey: true }), true, false)).toEqual({ t: 'reopen' })
    expect(workspaceAction(key('KeyT', { metaKey: true }), true, false)).toEqual({ t: 'newTab' })
    expect(workspaceAction(key('KeyZ', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'reopen' })
    expect(workspaceAction(key('KeyT', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'newTab' })
    expect(workspaceAction(key('KeyZ', { ctrlKey: true }), false, false)).toBeNull()
    expect(workspaceAction(key('KeyZ', { metaKey: true, shiftKey: true }), true, false)).toBeNull()
  })

  it('Alt+Shift+P (⇧⌘P on macOS) opens the prompt library', () => {
    expect(workspaceAction(key('KeyP', { altKey: true, shiftKey: true }), false, false)).toEqual({ t: 'prompts' })
    expect(workspaceAction(key('KeyP', { metaKey: true, shiftKey: true }), true, false)).toEqual({ t: 'prompts' })
    expect(workspaceAction(key('KeyP', { ctrlKey: true, shiftKey: true }), false, false)).toEqual({ t: 'quickOpen' })
  })

  it('recent, bookmarks and back / forward', () => {
    expect(workspaceAction(key('KeyE', { altKey: true, shiftKey: true }), false, false)).toEqual({ t: 'recent' })
    expect(workspaceAction(key('KeyE', { metaKey: true }), true, false)).toEqual({ t: 'recent' })
    expect(workspaceAction(key('KeyE', { ctrlKey: true }), false, false)).toBeNull()
    expect(workspaceAction(key('F11', { shiftKey: true }), false, false)).toEqual({ t: 'bookmarks' })
    expect(workspaceAction(key('F11', { shiftKey: true }), true, false)).toEqual({ t: 'bookmarks' })
    expect(workspaceAction(key('ArrowLeft', { ctrlKey: true, altKey: true }), false, true)).toEqual({ t: 'navBack' })
    expect(workspaceAction(key('ArrowRight', { ctrlKey: true, altKey: true }), false, true)).toEqual({ t: 'navForward' })
    expect(workspaceAction(key('Minus', { ctrlKey: true }), true, false)).toEqual({ t: 'navBack' })
    expect(workspaceAction(key('Minus', { ctrlKey: true, shiftKey: true }), true, false)).toEqual({ t: 'navForward' })
    expect(workspaceAction(key('ArrowLeft', { altKey: true }), false, true)).toEqual({ t: 'focus', dir: 'left' })
  })

  it('Ctrl+Alt+N (⌃⌥N on macOS) opens project notes, not AltGr+N', () => {
    expect(workspaceAction(key('KeyN', { ctrlKey: true, altKey: true }), false, false)).toEqual({ t: 'notes' })
    expect(workspaceAction(key('KeyN', { ctrlKey: true, altKey: true }), true, false)).toEqual({ t: 'notes' })
    expect(workspaceAction(key('KeyN', { ctrlKey: true, altKey: true }, true), false, false)).toBeNull()
    expect(workspaceAction(key('KeyN', { ctrlKey: true, altKey: true, shiftKey: true }), false, false)).toBeNull()
    expect(workspaceAction(key('KeyN', { metaKey: true, altKey: true, ctrlKey: true }), true, false)).toBeNull()
    expect(workspaceAction(key('KeyN', { ctrlKey: true }), false, false)).toBeNull()
  })

  it('Cmd+digit jumps to a tab on macOS', () => {
    expect(workspaceAction(key('Digit3', { metaKey: true }), true, false)).toEqual({ t: 'tab', index: 2 })
  })

  it('Alt+arrow moves focus and Alt+Shift+arrow swaps panes, only with several panes', () => {
    expect(workspaceAction(key('ArrowLeft', { altKey: true }), false, true)).toEqual({ t: 'focus', dir: 'left' })
    expect(workspaceAction(key('ArrowLeft', { altKey: true, shiftKey: true }), false, true)).toEqual({ t: 'swap', dir: 'left' })
    expect(workspaceAction(key('ArrowUp', { altKey: true, metaKey: true, shiftKey: true }), true, true)).toEqual({ t: 'swap', dir: 'up' })
    expect(workspaceAction(key('ArrowLeft', { altKey: true, shiftKey: true }), false, false)).toBeNull()
  })
})
