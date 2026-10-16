import { describe, expect, it } from 'vitest'
import { formatKeys, keyCombo, SHORTCUTS, shortcutText, viewShortcuts, workspaceShortcuts } from './shortcuts'

describe('shortcut labels', () => {
  it('Windows: Mod is Ctrl, modifiers Ctrl Alt Shift, joined with +', () => {
    expect(keyCombo(['Mod', 'C'], false)).toBe('Ctrl+C')
    expect(keyCombo(['Shift', 'Mod', 'T'], false)).toBe('Ctrl+Shift+T')
    expect(keyCombo(['Shift', 'Alt', 'D'], false)).toBe('Alt+Shift+D')
    expect(keyCombo(['Shift', 'Enter'], false)).toBe('Shift+Enter')
    expect(keyCombo(['Mod', 'Ctrl', 'K'], false)).toBe('Ctrl+K')
  })

  it('macOS: symbols in ⌃⌥⇧⌘ order, no separator; Ctrl stays the real Control key', () => {
    expect(keyCombo(['Mod', 'C'], true)).toBe('⌘C')
    expect(keyCombo(['Mod', 'Shift', 'D'], true)).toBe('⇧⌘D')
    expect(keyCombo(['Mod', 'Alt', 'D'], true)).toBe('⌥⌘D')
    expect(keyCombo(['Shift', 'Ctrl', 'Tab'], true)).toBe('⌃⇧Tab')
    expect(keyCombo(['Mod', 'Shift', 'Alt', 'Ctrl', 'X'], true)).toBe('⌃⌥⇧⌘X')
    expect(keyCombo(['Shift', 'Enter'], true)).toBe('⇧↩')
    expect(keyCombo(['Shift', 'F10'], true)).toBe('⇧F10')
  })

  it('sorts each modifier run on its own, so "F7 / Shift F7" keeps its shape', () => {
    expect(formatKeys(['F7', 'Shift', 'F7'], true)).toEqual(['F7', '⇧', 'F7'])
    expect(formatKeys(['Mod', 'Shift', '[', ']'], true)).toEqual(['⇧', '⌘', '[', ']'])
  })

  it('no list prints a raw Ctrl / Shift token on macOS', () => {
    const all = [...SHORTCUTS, ...workspaceShortcuts(true), ...viewShortcuts(true)]
    for (const s of all) for (const k of formatKeys(s.keys, true)) expect(['Ctrl', 'Alt', 'Shift', 'Mod']).not.toContain(k)
    expect(formatKeys(SHORTCUTS.find((s) => s.id === 'palette')!.keys, true)).toEqual(['⌘', 'K'])
    expect(formatKeys(SHORTCUTS.find((s) => s.id === 'palette')!.keys, false)).toEqual(['Ctrl', 'K'])
    expect(formatKeys(viewShortcuts(true).find((s) => s.id === 'zoomWheel')!.keys, true)).toEqual(['⌃', 'Scroll'])
  })

  it('workspace chords as text per platform', () => {
    expect(shortcutText('wsSplitDown', true)).toBe('⇧⌘D')
    expect(shortcutText('wsFocus', true)).toBe('⌥⌘←↑↓→')
    expect(shortcutText('wsNew', false)).toBe('Ctrl+Shift+T')
    expect(shortcutText('wsZoom', true)).toBe('⇧⌘↩')
    expect(shortcutText('wsZoom', false)).toBe('Ctrl+Shift+Enter')
    expect(shortcutText('wsReopen', true)).toBe('⇧⌘T')
    expect(shortcutText('wsReopen', false)).toBe('Ctrl+Shift+Z')
    expect(formatKeys(workspaceShortcuts(true).find((s) => s.id === 'wsMoveTab')!.keys, true)).toEqual(['⇧', '⌘', 'PgUp', 'PgDn'])
    expect(formatKeys(workspaceShortcuts(false).find((s) => s.id === 'wsMoveTab')!.keys, false)).toEqual(['Ctrl', 'Shift', 'PgUp', 'PgDn'])
  })
})
