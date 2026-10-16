import { describe, expect, it } from 'vitest'
import { newlineFor } from './termKeys'

const enter = (mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({ key: 'Enter', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods })

describe('newlineFor', () => {
  it('Shift+Enter and Ctrl+Enter break the line in agent prompts', () => {
    expect(newlineFor(enter({ shiftKey: true }), 'claude')).toBe('\n')
    expect(newlineFor(enter({ ctrlKey: true }), 'claude')).toBe('\n')
    expect(newlineFor(enter({ shiftKey: true }), 'codex')).toBe('\n')
  })

  it('plain Enter still submits', () => {
    expect(newlineFor(enter(), 'claude')).toBeNull()
  })

  it('leaves Ctrl+Shift+Enter to the zoom shortcut and Alt / Cmd chords to the terminal', () => {
    expect(newlineFor(enter({ shiftKey: true, ctrlKey: true }), 'claude')).toBeNull()
    expect(newlineFor(enter({ altKey: true }), 'claude')).toBeNull()
    expect(newlineFor(enter({ metaKey: true, shiftKey: true }), 'claude')).toBeNull()
  })

  it('shells keep their own Enter', () => {
    expect(newlineFor(enter({ shiftKey: true }), 'shell')).toBeNull()
    expect(newlineFor(enter({ ctrlKey: true }), 'shell')).toBeNull()
  })

  it('ignores other keys', () => {
    expect(newlineFor({ ...enter({ shiftKey: true }), key: 'a' }, 'claude')).toBeNull()
  })
})
